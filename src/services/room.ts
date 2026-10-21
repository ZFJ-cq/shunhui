import { Device, type types } from 'mediasoup-client'
import { io, type Socket } from 'socket.io-client'
import { shallowReactive, ref } from 'vue'
import { api } from './api'
import { logger } from './logger'
import { monitorNetwork, type NetworkQuality } from './network'

/** 业务会议会话与 mediasoup 适配边界。SDP offer/answer、ICE gathering
 * 由 mediasoup-client 的浏览器 handler 管理，信令只交换 RTP/ICE/DTLS 参数。
 * 不向 mediasoup 服务发送自定义 webrtc.offer，否则协议无法兼容。 */
import type { JoinOptions, MeetingRecord } from '../types'
export interface Participant { userId: string; nickname: string; isHost: boolean; audioOff: boolean; videoOff: boolean; screenShare: boolean }
export interface RemoteMedia { id: string; producerId: string; userId: string; source: string; stream: MediaStream }
interface ProducerInfo { id: string; userId: string; source: string; attempts?: number }
export function createRoom() {
  const participants = ref<Participant[]>([]), meeting = ref<MeetingRecord | null>(null)
  const messages = ref<any[]>([]), remote = shallowReactive(new Map<string, RemoteMedia>())
  const status = ref('正在连接'), activeSpeaker = ref(''), selfId = ref(''), error = ref('')
  const networkQuality = ref<NetworkQuality>({ rttMs: null, sendLossPercent: null, receiveLossPercent: null, sendKbps: null, receiveKbps: null, weak: false })
  let socket: Socket, device: Device, sendTransport: types.Transport | undefined, recvTransport: types.Transport | undefined
  let options: JoinOptions, stream: MediaStream | null, iceServers: RTCIceServer[] = [], closed = false, generation = 0
  const producers = new Map<string, types.Producer>(), consumers = new Map<string, types.Consumer>(), consuming = new Set<string>()
  const pendingProducers = new Map<string, ProducerInfo>(), closedProducers = new Set<string>()
  const consumerLayers = new Map<string, number>()
  const consumerCleanups = new Map<string, () => void>()
  const serverTransports = new Map<string, 'send' | 'recv'>()
  const recoveryTimers = new Set<ReturnType<typeof setInterval>>()
  let pendingRetryTimer: ReturnType<typeof setTimeout> | undefined
  let onControl: (type: string, payload: any) => void = () => {}
  // 只记录操作名与耗时；不打印鉴权、聊天正文、SDP/ICE 等原始载荷。
  function request<T = any>(type: string, payload: any = {}): Promise<T> {
    const operation = type === 'sfu' ? `sfu.${payload.method}` : type
    if (closed || !socket?.connected) {
      logger.warn(`信令请求未发送：${operation}，会议连接尚未就绪`)
      return Promise.reject(Error('会议连接尚未就绪'))
    }
    const started = performance.now()
    logger.info(`信令请求：${operation}`)
    return new Promise((resolve, reject) => socket.timeout(12000).emit('request', { type, payload }, (err: Error | null, result: any) => {
      if (err || !result || result.error) {
        const failure = Error(err?.message || result?.error || '信令服务未响应')
        logger.error(`信令请求失败：${operation}（${Math.round(performance.now() - started)} ms）`, failure)
        reject(failure)
      } else {
        logger.info(`信令请求成功：${operation}`, { elapsedMs: Math.round(performance.now() - started) })
        resolve(result.data)
      }
    }))
  }
  const rpc = <T = any>(method: string, data: any = {}) => request<T>('sfu', { method, data })
  let stopNetwork: (() => void) | undefined
  async function releaseServerTransport(id: string, direction: 'send' | 'recv') {
    if (!socket?.connected || closed) return false
    // closeTransport is idempotent on the server. Retry once in case the first
    // close succeeded but its acknowledgement was lost during a brief network flap.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await rpc('closeTransport', { transportId: id, direction })
        serverTransports.delete(id)
        return true
      } catch (error) {
        logger.warn('关闭服务端媒体传输失败，准备重试', { transportId: id, attempt: attempt + 1, error: error instanceof Error ? error.message : String(error) })
        if (attempt === 0 && socket.connected) await new Promise(resolve => setTimeout(resolve, 250))
      }
    }
    return false
  }
  async function releaseAllServerTransports() {
    await Promise.all([...serverTransports].map(([id, direction]) => releaseServerTransport(id, direction)))
  }
  function cleanup() {
    stopNetwork?.(); stopNetwork = undefined
    if (pendingRetryTimer) clearTimeout(pendingRetryTimer)
    pendingRetryTimer = undefined
    for (const timer of recoveryTimers) clearInterval(timer)
    recoveryTimers.clear(); consumerLayers.clear()
    networkQuality.value = { rttMs: null, sendLossPercent: null, receiveLossPercent: null, sendKbps: null, receiveKbps: null, weak: false }
    for (const p of producers.values()) p.close(); producers.clear()
    for (const c of consumers.values()) c.close(); consumers.clear()
    consumerCleanups.clear()
    remote.clear(); consuming.clear(); sendTransport?.close(); recvTransport?.close(); sendTransport = undefined; recvTransport = undefined
  }
  async function transport(direction: 'send' | 'recv') {
    const current = generation
    const params = await rpc('createTransport', { direction })
    // The server may have created its transport even if this build was superseded while
    // the acknowledgement was in flight. Retire that server-side transport before retrying.
    serverTransports.set(params.id, direction)
    if (closed || current !== generation) { await releaseServerTransport(params.id, direction); throw Error('媒体连接已失效') }
    let t: types.Transport
    try { t = direction === 'send' ? device.createSendTransport({ ...params, iceServers }) : device.createRecvTransport({ ...params, iceServers }) }
    catch (e) { await releaseServerTransport(params.id, direction); throw e }
    t.on('connect', ({ dtlsParameters }, done, fail) => { rpc('connectTransport', { transportId: t.id, dtlsParameters }).then(done).catch(fail) })
    if (direction === 'send') t.on('produce', ({ kind, rtpParameters, appData }, done, fail) => { rpc('produce', { transportId: t.id, kind, rtpParameters, source: appData.source }).then(done).catch(fail) })
    logger.info('已创建媒体传输', { direction, transportId: t.id })
    t.on('connectionstatechange', state => logger.info('媒体传输连接状态', { direction, transportId: t.id, state }))
    t.on('icegatheringstatechange', state => logger.info('ICE 候选收集状态', { direction, transportId: t.id, state }))
    return t
  }
  function queueProducerRetry(info: ProducerInfo) {
    if (closed || closedProducers.has(info.id)) return
    const attempts = (info.attempts || 0) + 1
    if (attempts > 6) { logger.error('媒体订阅已达到重试上限', Error(info.source)); return }
    logger.warn('准备重试媒体订阅', { source: info.source, producerId: info.id, attempts })
    pendingProducers.set(info.id, { ...info, attempts })
    if (pendingRetryTimer) return
    pendingRetryTimer = setTimeout(() => {
      pendingRetryTimer = undefined
      void drainPending()
    }, Math.min(1000 * 2 ** Math.min(attempts - 1, 3), 8000))
  }
  async function consume(info: ProducerInfo, required = false) {
    if (closedProducers.has(info.id)) return
    if (!recvTransport) { if (info.userId !== selfId.value) pendingProducers.set(info.id, info); return }
    if (consuming.has(info.id) || [...remote.values()].some(m => m.producerId === info.id)) return
    consuming.add(info.id)
    const current = generation, receiving = recvTransport
    try {
      const spatialLayer = info.source === 'video' ? cameraLayer(participants.value.length) : undefined
      const data = await rpc('consume', { transportId: recvTransport.id, producerId: info.id, rtpCapabilities: device.rtpCapabilities, spatialLayer })
      if (closed || closedProducers.has(info.id) || current !== generation || receiving.closed) return
      const consumer = await receiving.consume(data)
      if (closed || closedProducers.has(info.id) || current !== generation) { consumer.close(); return }
      consumers.set(consumer.id, consumer)
      if (info.source === 'video' && spatialLayer !== undefined) consumerLayers.set(consumer.id, spatialLayer)
      pendingProducers.delete(info.id)
      logger.info('远端媒体订阅成功', { source: info.source, producerId: info.id, consumerId: consumer.id })
      const media = new MediaStream([consumer.track])
      remote.set(consumer.id, { id: consumer.id, producerId: info.id, userId: data.userId, source: data.source, stream: media })
      const remove = () => {
        if (videoRecovery) { clearInterval(videoRecovery); recoveryTimers.delete(videoRecovery) }
        consumerCleanups.delete(consumer.id)
        consumers.delete(consumer.id)
        consumerLayers.delete(consumer.id)
        remote.delete(consumer.id)
      }
      let videoRecovery: ReturnType<typeof setInterval> | undefined
      consumerCleanups.set(consumer.id, remove)
      if (consumer.kind === 'video') {
        let previousBytes = -1, stalledSamples = 0, requesting = false
        videoRecovery = setInterval(async () => {
          if (closed || current !== generation || consumer.closed || consumer.track.readyState !== 'live' || requesting) return
          try {
            const stats = await consumer.getStats()
            const inbound = [...stats.values()].find((entry: any) => entry.type === 'inbound-rtp' && entry.kind === 'video') as any
            if (!inbound || typeof inbound.bytesReceived !== 'number') return
            const progress = inbound.framesDecoded ?? inbound.framesReceived ?? inbound.bytesReceived
            if (previousBytes >= 0 && progress === previousBytes) stalledSamples++
            else stalledSamples = 0
            previousBytes = progress
            if (stalledSamples >= 3) {
              logger.warn('远端视频停滞，正在请求关键帧', { consumerId: consumer.id, source: info.source })
              stalledSamples = 0
              requesting = true
              await rpc('refreshConsumer', { consumerId: consumer.id }).catch(() => {})
              requesting = false
            }
          } catch { requesting = false }
        }, 4000)
        recoveryTimers.add(videoRecovery)
      }
      consumer.track.addEventListener('ended', remove, { once: true })
      consumer.on('transportclose', remove)
      consumer.on('trackended', remove)
      try { await rpc('resumeConsumer', { consumerId: consumer.id }) } catch (e) { remove(); consumer.close(); throw e }
    } catch (e) {
      logger.error(`订阅媒体失败：${info.source}`, e)
      if (!closed && current === generation) {
        if (closedProducers.has(info.id)) pendingProducers.delete(info.id)
        else queueProducerRetry(info)
        error.value = e instanceof Error ? e.message : '订阅失败'
        if (required) throw e
      }
    } finally { if (current === generation) consuming.delete(info.id) }
  }
  async function drainPending() {
    const pending = [...pendingProducers.values()]
    for (const producer of pending) {
      if (closedProducers.has(producer.id)) { pendingProducers.delete(producer.id); continue }
      if ([...remote.values()].some(media => media.producerId === producer.id)) { pendingProducers.delete(producer.id); continue }
      if (consuming.has(producer.id)) continue
      pendingProducers.delete(producer.id)
      await consume(producer)
    }
  }
  function cameraLayer(count: number) { return count >= 10 ? 0 : count >= 5 ? 1 : 2 }
  async function adaptCameraLayers() {
    const spatialLayer = cameraLayer(participants.value.length)
    const updates = [...remote.values()].filter(media => media.source === 'video').flatMap(media => {
      if (consumerLayers.get(media.id) === spatialLayer) return []
      consumerLayers.set(media.id, spatialLayer)
      return [rpc('setConsumerLayer', { consumerId: media.id, spatialLayer }).catch(() => consumerLayers.delete(media.id))]
    })
    await Promise.all(updates)
  }
  async function publish(source: 'audio' | 'video' | 'screen', track: MediaStreamTrack) {
    if (!sendTransport) throw Error('媒体服务尚未就绪')
    const current = generation
    if (track.readyState !== 'live') throw Error('媒体轨道已结束')
    const previous = producers.get(source)
    if (previous) { await previous.replaceTrack({ track }); return }
    const producer = await sendTransport.produce({ track, stopTracks: false, appData: { source }, ...(source === 'video' ? { encodings: [{ maxBitrate: 180000, scaleResolutionDownBy: 4 }, { maxBitrate: 450000, scaleResolutionDownBy: 2 }, { maxBitrate: 1000000, scaleResolutionDownBy: 1 }], codecOptions: { videoGoogleStartBitrate: 600 } } : source === 'screen' ? { encodings: [{ maxBitrate: 1800000 }] } : {}) })
    if (closed || current !== generation) { producer.close(); return }
    producers.set(source, producer)
    logger.info('本地媒体发布成功', { source, producerId: producer.id })
    producer.on('trackended', () => {
      if (producers.get(source) !== producer || producer.closed) return
      producers.delete(source)
      void rpc('closeProducer', { producerId: producer.id, source }).catch(() => {})
    })
  }
  async function setMedia(kind: 'audio' | 'video', off: boolean, track?: MediaStreamTrack) {
    if (!off && (!track || track.readyState !== 'live')) throw Error('所选设备不可用，请重新获取权限')
    await request('media_state', { [kind + 'Off']: off })
    options[kind === 'audio' ? 'audioOff' : 'videoOff'] = off
    // 旁听入会后首次开启设备时也保存轨道，断线重建 transport 后才能恢复发布。
    if (track) {
      stream ||= new MediaStream()
      for (const old of stream.getTracks().filter(t => t.kind === kind && t !== track)) stream.removeTrack(old)
      if (!stream.getTracks().includes(track)) stream.addTrack(track)
    }
    if (track) track.enabled = !off
    if (!off && track) await publish(kind, track)
    const p = producers.get(kind); if (p) { if (off) p.pause(); else p.resume() }
  }
  async function stopScreen() { const p = producers.get('screen'); if (p) { await rpc('closeProducer', { producerId: p.id, source: 'screen' }); p.close(); producers.delete('screen') } }
  async function connect(o: JoinOptions, local: MediaStream | null, control: typeof onControl) {
    logger.info('开始加入会议', { meetingId: o.meetingId, hasLocalStream: Boolean(local) })
    options = o; stream = local; onControl = control
    const joined = await api(`/meetings/${o.meetingId}/join`, 'POST', o)
    if (closed) { await api(`/meetings/${o.meetingId}/leave`, 'POST').catch(() => {}); return }
    selfId.value = joined.participant.userId; meeting.value = joined.meeting; iceServers = joined.iceServers
    options.audioOff = joined.participant.audioOff; options.videoOff = joined.participant.videoOff
    stream?.getAudioTracks().forEach(t => { t.enabled = !options.audioOff }); stream?.getVideoTracks().forEach(t => { t.enabled = !options.videoOff })
    onControl('initial_media', { audioOff: options.audioOff, videoOff: options.videoOff })
    // Do not send the tunnel hostname as a mediasoup announced IP. A tunnel
    // only proxies HTTP/WebSocket; media must use a real public IP or TURN.
    const announcedIp = window.location.hostname
    socket = io({ auth: { token: joined.token, announcedIp: /^\d{1,3}(?:\.\d{1,3}){3}$/.test(announcedIp) ? announcedIp : undefined }, reconnection: true, reconnectionAttempts: 8, reconnectionDelay: 700, reconnectionDelayMax: 3000, timeout: 5000 })
    let retryUsed = false, retrying: Promise<void> | undefined, building = false, sessionReplaced = false
    let buildQueue: Promise<void> = Promise.resolve()
    let stableTimer: ReturnType<typeof setTimeout> | undefined
    function queueBuild(current: number) {
      const next = buildQueue.catch(() => {}).then(() => {
        if (closed || current !== generation) return
        return buildMedia(current)
      })
      buildQueue = next.catch(() => {})
      return next
    }
    queueReconnect = (current) => queueBuild(current)
    async function waitForTransport(t: types.Transport) {
      if (t.connectionState === 'connected') return
      if (t.connectionState === 'new' && t.iceGatheringState === 'complete') return
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(Error('媒体网络连接超时')), 10000)
        function finish(e?: Error) { clearTimeout(timer); t.off('connectionstatechange', changed); e ? reject(e) : resolve() }
        function changed(state: string) { if (state === 'connected') finish(); else if (state === 'failed' || state === 'closed') finish(Error('媒体网络连接失败')) }
        t.on('connectionstatechange', changed)
        changed(t.connectionState)
      })
    }
    async function buildMedia(current: number) {
      building = true
      try {
      const state = await request('state'); if (closed || current !== generation) return
      participants.value = state.participants; meeting.value = state.meeting; messages.value = state.messages
      const self = state.participants.find((p: Participant) => p.userId === selfId.value)
      if (self) {
        options.audioOff = self.audioOff; options.videoOff = self.videoOff
        stream?.getAudioTracks().forEach(t => { t.enabled = !self.audioOff }); stream?.getVideoTracks().forEach(t => { t.enabled = !self.videoOff })
        onControl('initial_media', { audioOff: self.audioOff, videoOff: self.videoOff })
      }
      device = new Device(); await device.load({ routerRtpCapabilities: await rpc('capabilities') }); if (closed || current !== generation) return
      sendTransport = await transport('send'); if (closed || current !== generation) return
      recvTransport = await transport('recv')
      for (const t of [sendTransport, recvTransport]) t.on('connectionstatechange', state => {
        if (state === 'failed' && !closed && !building && current === generation) void retryMedia('媒体网络连接失败')
      })
      if (closed || current !== generation) { cleanup(); return }
      for (const source of ['audio', 'video'] as const) { const track = source === 'audio' ? stream?.getAudioTracks()[0] : stream?.getVideoTracks()[0]; if (track && !options[source + 'Off' as 'audioOff' | 'videoOff']) await publish(source, track) }
      for (const p of await rpc('producers')) await consume(p, true)
      await drainPending()
      await adaptCameraLayers()
      // Incoming-only clients do not need a working send path, and muted
      // publishers do not need a working receive path to join. Requiring both
      // transports here turned one directional ICE issue into a full meeting
      // reset even when the camera transport was already connected.
      const requiredTransports = [
        ...(producers.size ? [sendTransport] : []),
        ...(consumers.size ? [recvTransport] : []),
      ].filter((transport): transport is types.Transport => Boolean(transport))
      await Promise.all(requiredTransports.map(waitForTransport))
      if (closed || current !== generation) return
      logger.info('会议媒体连接就绪')
      status.value = '已连接'; error.value = ''
      clearTimeout(stableTimer)
      stableTimer = setTimeout(() => { retryUsed = false }, 20000)
      stopNetwork = monitorNetwork(() => ({ send: sendTransport!, receive: recvTransport! }), () => [...producers.values()], quality => { networkQuality.value = quality; status.value = quality.weak ? '网络较弱，已降低摄像头画质' : '已连接' })
      } finally { building = false }
    }
    async function retryMedia(message: string) {
      if (closed || retrying) return retrying
      // A media transport can briefly enter `failed` while a new producer is
      // negotiated (especially for screen capture).  Do not tear down the
      // whole meeting or stop the user's devices for a media-only failure.
      // Socket.IO remains the authoritative meeting connection.
      if (retryUsed) {
        status.value = '媒体连接不稳定，正在保持会议连接'
        error.value = `${message}，媒体将继续后台恢复`
        return
      }
      logger.warn('正在自动重建媒体连接', { reason: message })
      retryUsed = true
      retrying = (async () => {
        const current = ++generation
        status.value = '正在重试媒体连接'; error.value = `${message}（自动重试一次）`
        onControl('reconnecting', {})
        clearTimeout(stableTimer)
        await releaseAllServerTransports()
        if (socket.connected && serverTransports.size) {
          status.value = '媒体连接不稳定，会议仍保持连接'
          error.value = '旧媒体连接暂时无法释放，请重新尝试共享或刷新页面恢复媒体'
          return
        }
        cleanup()
        await new Promise(resolve => setTimeout(resolve, 700))
        if (closed || current !== generation) return
        if (!socket.connected) { connectionFailed('会议信令连接已断开，请返回后重新加入会议'); return }
        try { await queueBuild(current) }
        catch (e) {
          if (closed || current !== generation) return
          await releaseAllServerTransports()
          if (socket.connected && serverTransports.size) {
            status.value = '媒体连接不稳定，会议仍保持连接'
            error.value = '旧媒体连接暂时无法释放，请重新尝试共享或刷新页面恢复媒体'
            return
          }
          cleanup()
          status.value = '媒体连接不稳定，正在保持会议连接'
          error.value = `${e instanceof Error ? e.message : '媒体连接失败'}，请稍后重试共享或开启设备`
        }
      })().finally(() => { retrying = undefined })
      return retrying
    }
    socket.on('connect', async () => {
      logger.info('Socket.IO 信令已连接')
      if (closed) return
      const current = ++generation
      // A fresh Socket.IO connection makes the server discard the previous SFU peer.
      serverTransports.clear()
      retryUsed = false
      cleanup(); status.value = '正在连接媒体'
      try { await queueBuild(current) }
      catch (e) { if (!closed && current === generation) await retryMedia(e instanceof Error ? e.message : '媒体连接失败') }
    })
    function connectionFailed(message: string) {
      if (closed) return
      logger.error('会议连接失败', Error(message))
      error.value = message; status.value = '连接已断开'; cleanup(); onControl('disconnected', {})
    }
    socket.on('disconnect', reason => {
      logger.warn('Socket.IO 信令断开', { reason })
      generation++
      if (closed) return
      cleanup()
      serverTransports.clear()
      pendingProducers.clear()
      if (sessionReplaced) {
        closed = true
        status.value = '会话已被其他设备接管'
        error.value = '此账号已在其他页面加入会议'
        cleanup()
        onControl('disconnected', { reason: 'session_replaced', skipLeave: true })
        return
      }
      // Socket.IO does not automatically reconnect after a server disconnect.
      // Reconnect unless the server explicitly identified this as replacement.
      if (reason === 'io server disconnect') {
        status.value = '信令断开，正在恢复连接'
        error.value = '正在恢复会议状态和媒体连接'
        onControl('reconnecting', {})
        socket.connect()
        return
      }
      if (reason === 'io client disconnect') return connectionFailed('会议连接已关闭，请重新加入会议')
      status.value = '信令断开，正在自动重连'
      error.value = '正在恢复会议状态和媒体连接'
      onControl('reconnecting', {})
    })
    socket.on('connect_error', e => {
      logger.error('Socket.IO 连接错误', e)
      if (socket.active) { status.value = '正在重新连接'; error.value = '暂时无法连接会议服务，正在重试'; return }
      connectionFailed(e.message)
    })
    socket.io.on('reconnect_failed', () => connectionFailed('信令重连失败，请返回后重新加入会议'))
    socket.io.on('reconnect_attempt', attempt => logger.info('信令正在重连', { attempt }))
    socket.on('session_replaced', () => { sessionReplaced = true })
    socket.on('signal', ({ type, payload }) => {
      if (type !== 'active_speaker') logger.info(`收到信令：${type}`)
      if (type === 'room_state') { meeting.value = payload.meeting; participants.value = payload.participants; void adaptCameraLayers() }
      else if (type === 'chat_message') { if (!messages.value.some(m => m.id === payload.id)) messages.value.push(payload) }
      else if (type === 'active_speaker') activeSpeaker.value = payload.userId || ''
      else if (type === 'new_producer' && payload.userId !== selfId.value) { closedProducers.delete(payload.id); pendingProducers.set(payload.id, { ...payload, attempts: 0 }); void drainPending() }
      else if (type === 'consumer_closed' || type === 'producer_closed') {
        pendingProducers.delete(payload.id)
        if (type === 'producer_closed') closedProducers.add(payload.id)
        for (const [id, m] of remote) if (id === payload.id || m.producerId === payload.id) {
          consumerCleanups.get(id)?.()
          consumers.get(id)?.close(); consumers.delete(id); remote.delete(id)
        }
      } else Promise.resolve(onControl(type, payload)).catch(e => { logger.error(`会议控制失败：${type}`, e); error.value = e instanceof Error ? e.message : '会议控制失败' })
    })
  }
  async function reconnectMedia() {
    if (closed || !socket?.connected) throw Error('会议信令已断开，请重新入会')
    const current = ++generation
    status.value = '正在重新连接媒体'; error.value = ''
    await releaseAllServerTransports()
    if (serverTransports.size) throw Error('旧媒体连接尚未释放，请稍后再试')
    cleanup()
    await queueReconnect(current)
  }
  let queueReconnect: (current: number) => Promise<void> = async () => { throw Error('会议尚未就绪') }
  async function leave() { if (closed) return; closed = true; generation++; socket?.disconnect(); cleanup(); try { if (options) await api(`/meetings/${options.meetingId}/leave`, 'POST') } catch { /* server removes disconnected members after grace period */ } }
  return { participants, meeting, messages, remote, status, activeSpeaker, selfId, error, networkQuality, connect, setMedia, publish, stopScreen, reconnectMedia, leave, send: (content: string) => request('chat', { content }) }
}
