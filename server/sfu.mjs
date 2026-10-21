import * as mediasoup from 'mediasoup';

export async function createSfu(notify) {
  const maxRoomStreams = Number(process.env.ROOM_MAX_MEDIA_STREAMS || 25);
  const maxIncomingBitrate = Number(process.env.PEER_MAX_INCOMING_BITRATE || 6000000);
  const maxOutgoingBitrate = Number(process.env.PEER_MAX_OUTGOING_BITRATE || 8000000);
  const worker = await mediasoup.createWorker({ rtcMinPort: Number(process.env.RTC_MIN_PORT || 40000), rtcMaxPort: Number(process.env.RTC_MAX_PORT || 40100), logLevel: process.env.MEDIASOUP_LOG_LEVEL || 'warn' });
  worker.on('died', () => { console.error('SFU worker died'); process.exit(1); });
  const rooms = new Map();
  async function room(id) {
    if (!rooms.has(id)) rooms.set(id, (async () => {
      const router = await worker.createRouter({ mediaCodecs: [
        { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
        { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 600 } },
        { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
      ] });
      const observer = await router.createAudioLevelObserver({ maxEntries: 1, threshold: -65, interval: 800 });
      const data = { router, observer, peers: new Map(), producers: new Map(), streamCount: 0 };
      observer.on('volumes', entries => notify(id, 'active_speaker', { userId: entries[0]?.producer.appData.userId }));
      return data;
    })());
    return rooms.get(id);
  }
  async function request(meetingId, userId, method, data = {}) {
    const r = await room(meetingId);
    let peer = r.peers.get(userId);
    if (!peer) { peer = { transports: new Map(), producers: new Map(), consumers: new Map() }; r.peers.set(userId, peer); }
    if (method === 'capabilities') return r.router.rtpCapabilities;
    if (method === 'producers') return [...r.producers.values()].filter(p => p.appData.userId !== userId).map(p => ({ id: p.id, userId: p.appData.userId, source: p.appData.source }));
    if (method === 'createTransport') {
      for (const [id, existing] of peer.transports) if (existing.closed) peer.transports.delete(id);
      if (!['send','recv'].includes(data.direction) || [...peer.transports.values()].some(t => t.appData.direction === data.direction)) throw Error('无效或重复媒体连接');
      if (peer.transports.size >= 2) throw Error('媒体连接数超限');
      const announcedIp = data.announcedIp || process.env.RTC_ANNOUNCED_IP || '127.0.0.1';
      const transport = await r.router.createWebRtcTransport({
        listenIps: [{ ip: process.env.RTC_LISTEN_IP || '0.0.0.0', announcedIp }], enableUdp: true, enableTcp: true, preferUdp: true,
        initialAvailableOutgoingBitrate: 1200000, appData: { direction: data.direction },
      });
      // Camera simulcast (1.63 Mbps), screen (1.8 Mbps), audio and RTP
      // overhead share this transport. A 2 Mbps cap starves concurrent media.
      await transport.setMaxIncomingBitrate(maxIncomingBitrate);
      await transport.setMaxOutgoingBitrate(maxOutgoingBitrate);
      peer.transports.set(transport.id, transport);
      transport.observer.on('close', () => peer.transports.delete(transport.id));
      transport.on('dtlsstatechange', s => { if (s === 'closed') transport.close(); });
      transport.on('connectionstatechange', state => {
        if (state === 'failed' || state === 'closed') transport.close();
      });
      return { id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters };
    }
    const transport = peer.transports.get(data.transportId);
    if (method === 'closeTransport') {
      const old = peer.transports.get(data.transportId);
      if (old) { old.close(); peer.transports.delete(old.id); }
      return {};
    }
    if (method === 'connectTransport') { if (!transport) throw Error('连接不存在'); await transport.connect({ dtlsParameters: data.dtlsParameters }); return {}; }
    if (method === 'produce') {
      if (!transport || transport.appData.direction !== 'send') throw Error('无效发送连接');
      if (!['audio', 'video', 'screen'].includes(data.source) || peer.producers.size >= 3 || (data.source !== 'screen' && [...peer.producers.values()].some(p => p.appData.source === data.source))) throw Error('无效媒体源');
      if ((data.source === 'audio' && data.kind !== 'audio') || (data.source !== 'audio' && data.kind !== 'video')) throw Error('媒体类型不匹配');
      if (r.streamCount >= maxRoomStreams) throw Error('房间已达到媒体流上限');
      const producer = await transport.produce({ kind: data.kind, rtpParameters: data.rtpParameters, appData: { userId, source: data.source } });
      peer.producers.set(producer.id, producer); r.producers.set(producer.id, producer);
      r.streamCount++;
      producer.on('transportclose', () => removeProducer(r, peer, producer, meetingId));
      if (producer.kind === 'audio') await r.observer.addProducer({ producerId: producer.id });
      notify(meetingId, 'new_producer', { id: producer.id, userId, source: data.source });
      return { id: producer.id };
    }
    if (method === 'closeProducer') { const p = peer.producers.get(data.producerId); if (p) { const source = p.appData.source; p.close(); removeProducer(r, peer, p, meetingId); return { source }; } return {}; }
    if (method === 'consume') {
      const producer = r.producers.get(data.producerId);
      if (!transport || transport.appData.direction !== 'recv' || !producer || producer.appData.userId === userId || !r.router.canConsume({ producerId: producer.id, rtpCapabilities: data.rtpCapabilities })) throw Error('无法订阅媒体');
      if ([...peer.consumers.values()].some(c => c.producerId === producer.id)) throw Error('重复订阅');
      if (peer.consumers.size >= 75) throw Error('订阅数超限');
      const consumer = await transport.consume({ producerId: producer.id, rtpCapabilities: data.rtpCapabilities, paused: true });
      peer.consumers.set(consumer.id, consumer);
      consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
      consumer.on('producerclose', () => { peer.consumers.delete(consumer.id); notify(meetingId, 'consumer_closed', { id: consumer.id }, userId); });
      if (producer.appData.source === 'video') await setCameraLayer(consumer, producer, data.spatialLayer);
      return { id: consumer.id, producerId: producer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters, userId: producer.appData.userId, source: producer.appData.source };
    }
    if (method === 'setConsumerLayer') {
      const consumer = peer.consumers.get(data.consumerId);
      const producer = consumer && r.producers.get(consumer.producerId);
      if (!consumer || !producer || producer.appData.source !== 'video') throw Error('摄像头订阅不存在');
      await setCameraLayer(consumer, producer, data.spatialLayer);
      return {};
    }
    if (method === 'resumeConsumer') { const c = peer.consumers.get(data.consumerId); if (!c) throw Error('订阅不存在'); await c.resume(); if (c.kind === 'video') await c.requestKeyFrame(); return {}; }
    if (method === 'refreshConsumer') { const c = peer.consumers.get(data.consumerId); if (!c || c.kind !== 'video') throw Error('视频订阅不存在'); await c.requestKeyFrame(); return {}; }
    throw Error('未知媒体方法');
  }
  function removeProducer(r, peer, p, id) {
    // Producer close can be reached from the explicit RPC and transport
    // teardown paths. Notify exactly once so receivers do not retain stale
    // screen/video tracks or process duplicate cleanup events.
    if (!peer.producers.has(p.id) && !r.producers.has(p.id)) return;
    peer.producers.delete(p.id); r.producers.delete(p.id);
    r.streamCount = Math.max(0, r.streamCount - 1);
    notify(id, 'producer_closed', { id: p.id, userId: p.appData.userId, source: p.appData.source });
  }
  async function setCameraLayer(consumer, producer, requested) {
    const maximum = Math.max(0, (producer.rtpParameters.encodings?.length || 1) - 1);
    const spatialLayer = Number.isInteger(requested) ? Math.min(maximum, Math.max(0, requested)) : maximum;
    await consumer.setPreferredLayers({ spatialLayer, temporalLayer: 2 });
  }
  async function leave(id, userId) {
    if (!rooms.has(id)) return;
    const r = await rooms.get(id), peer = r.peers.get(userId);
    if (!peer) return;
    for (const p of [...peer.producers.values()]) { p.close(); removeProducer(r, peer, p, id); }
    for (const t of peer.transports.values()) t.close();
    r.peers.delete(userId);
    if (!r.peers.size) { r.router.close(); rooms.delete(id); }
  }
  async function pause(id, userId, source) { const r = rooms.has(id) && await rooms.get(id); if (r) for (const p of r.peers.get(userId)?.producers.values() || []) if (p.appData.source === source) await p.pause(); }
  async function resume(id, userId, source) { const r = rooms.has(id) && await rooms.get(id); if (r) for (const p of r.peers.get(userId)?.producers.values() || []) if (p.appData.source === source) await p.resume(); }
  return { request, leave, pause, resume, close() { worker.close(); } };
}
