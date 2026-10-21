import type { types } from 'mediasoup-client'
import { logger } from './logger'

type QualitySample = { lost: number; received: number; bytes: number; packets: number }
export interface NetworkQuality { rttMs: number | null; sendLossPercent: number | null; receiveLossPercent: number | null; sendKbps: number | null; receiveKbps: number | null; weak: boolean }

/** Samples per-direction WebRTC counters and caps camera simulcast on weak links. */
export function monitorNetwork(
  getTransports: () => { send?: types.Transport; receive?: types.Transport },
  getVideos: () => types.Producer[],
  report: (quality: NetworkQuality) => void,
) {
  let stopped = false, busy = false, previousSampleAt = 0
  const previous = new Map<string, QualitySample>()
  const timer = setInterval(async () => {
    if (stopped || busy) return
    const { send, receive } = getTransports()
    const active = [send, receive].filter((t): t is types.Transport => !!t && !t.closed && t.connectionState === 'connected')
    if (!active.length) return
    busy = true
    try {
      const sampledAt = performance.now()
      const elapsed = previousSampleAt ? Math.max(1, (sampledAt - previousSampleAt) / 1000) : 0
      let sendLost = 0, sendPackets = 0, sendFractionSum = 0, sendFractionCount = 0
      let receiveLost = 0, receivePackets = 0, rtt = 0, sentBytes = 0, receivedBytes = 0
      let hasSendLoss = false, hasSendRate = false, hasReceiveLoss = false, hasReceiveRate = false
      for (const transport of active) {
        const stats = await transport.getStats()
        const entries = [...stats.values()] as any[]
        const sentPacketsById = new Map<string, number>()
        if (transport === send) for (const entry of entries) {
          if (entry.type !== 'outbound-rtp' || entry.isRemote) continue
          const key = `send:${entry.id}`, old = previous.get(key)
          if (old && elapsed) { sentBytes += Math.max(0, (entry.bytesSent || 0) - old.bytes); sentPacketsById.set(entry.id, Math.max(0, (entry.packetsSent || 0) - old.packets)) }
          previous.set(key, { lost: 0, received: 0, bytes: entry.bytesSent || 0, packets: entry.packetsSent || 0 })
          hasSendRate = true
        }
        for (const entry of entries) {
          if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && Number.isFinite(entry.currentRoundTripTime)) rtt = Math.max(rtt, entry.currentRoundTripTime)
          if (transport === receive && entry.type === 'inbound-rtp' && !entry.isRemote) {
            const old = previous.get(`receive:${entry.id}`)
            if (old) {
              receiveLost += Math.max(0, (entry.packetsLost || 0) - old.lost)
              receivePackets += Math.max(0, (entry.packetsReceived || 0) - old.received)
              receivedBytes += Math.max(0, (entry.bytesReceived || 0) - old.bytes)
              hasReceiveLoss = true
              hasReceiveRate = true
            }
            previous.set(`receive:${entry.id}`, { lost: entry.packetsLost || 0, received: entry.packetsReceived || 0, bytes: entry.bytesReceived || 0, packets: 0 })
          }
          if (transport === send && entry.type === 'remote-inbound-rtp' && entry.localId) {
            const key = `loss:${entry.id}`
            const old = previous.get(key)
            if (Number.isFinite(entry.fractionLost)) {
              sendFractionSum += Math.max(0, Math.min(255, entry.fractionLost)) / 256 * 100
              sendFractionCount++
              hasSendLoss = true
            } else if (old) {
              const lostDelta = Math.max(0, (entry.packetsLost || 0) - old.lost)
              const sentDelta = sentPacketsById.get(entry.localId) || 0
              if (sentDelta) { sendLost += lostDelta; sendPackets += sentDelta; hasSendLoss = true }
            }
            previous.set(key, { lost: entry.packetsLost || 0, received: 0, bytes: 0, packets: 0 })
            if (Number.isFinite(entry.roundTripTime)) rtt = Math.max(rtt, entry.roundTripTime)
          }
        }
      }
      previousSampleAt = sampledAt
      const receiveTotal = receiveLost + receivePackets
      const sendLossPercent = !hasSendLoss ? null : sendFractionCount ? sendFractionSum / sendFractionCount : (sendPackets ? sendLost / sendPackets * 100 : null)
      const receiveLossPercent = hasReceiveLoss ? (receiveTotal ? receiveLost / receiveTotal * 100 : 0) : null
      const rttMs = rtt > 0 ? Math.round(rtt * 1000) : null
      const weak = (rttMs !== null && rttMs > 500) || (sendLossPercent !== null && sendLossPercent > 8) || (receiveLossPercent !== null && receiveLossPercent > 8)
      const producer = getVideos().find(p => !p.closed && p.appData.source === 'video')
      const layers = producer?.rtpParameters.encodings?.length || 1
      if (producer && layers > 1) await producer.setMaxSpatialLayer(weak ? 0 : layers - 1).catch(error => logger.warn('调整摄像头清晰度失败', error))
      if (!stopped) report({
        rttMs,
        sendLossPercent: sendLossPercent === null ? null : Math.round(sendLossPercent * 10) / 10,
        receiveLossPercent: receiveLossPercent === null ? null : Math.round(receiveLossPercent * 10) / 10,
        sendKbps: hasSendRate && elapsed ? Math.round(sentBytes * 8 / elapsed / 1000) : null,
        receiveKbps: hasReceiveRate && elapsed ? Math.round(receivedBytes * 8 / elapsed / 1000) : null,
        weak,
      })
    } catch (error) { logger.warn('读取网络质量统计失败，继续保持当前媒体连接', error) }
    finally { busy = false }
  }, 4000)
  return () => { stopped = true; clearInterval(timer) }
}
