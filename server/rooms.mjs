// All signaling operations are serialized per room, including disconnect cleanup.
export class Rooms {
  constructor(worker, config, broadcast) {
    this.worker = worker; this.config = config; this.broadcast = broadcast
    this.rooms = new Map(); this.queues = new Map()
  }
  run(id, task) {
    const next = (this.queues.get(id) || Promise.resolve()).catch(() => {}).then(task)
    this.queues.set(id, next)
    void next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id) }).catch(() => {})
    return next
  }
  async join(id, peerId, name) {
    let room = this.rooms.get(id)
    if (!room) {
      if (this.rooms.size >= this.config.maxRooms) throw new Error('服务器房间数已满')
      room = { router: await this.worker.createRouter({ mediaCodecs: this.config.codecs }), peers: new Map() }
      this.rooms.set(id, room)
    }
    if (room.peers.has(peerId)) throw new Error('请勿重复入会')
    if (room.peers.size >= this.config.maxPeers) throw new Error('房间人数已满')
    const peer = { id: peerId, name, transports: new Map(), producers: new Map(), consumers: new Map() }
    room.peers.set(peerId, peer)
    return { rtpCapabilities: room.router.rtpCapabilities, peers: [...room.peers.values()].map(p => ({ id: p.id, name: p.name })), producers: this.producers(room) }
  }
  producers(room) {
    return [...room.peers.values()].flatMap(p => [...p.producers.values()].map(v => ({ id: v.id, peerId: p.id, kind: v.kind })))
  }
  get(id, peerId) {
    const room = this.rooms.get(id), peer = room?.peers.get(peerId)
    if (!peer) throw new Error('尚未加入房间')
    return { room, peer }
  }
  async transport(id, peerId, direction) {
    const { room, peer } = this.get(id, peerId)
    if (!['send', 'recv'].includes(direction)) throw new Error('Invalid direction')
    if ([...peer.transports.values()].some(t => t.appData.direction === direction)) throw new Error('Transport already exists')
    const transport = await room.router.createWebRtcTransport({
      listenInfos: ['udp', 'tcp'].map(protocol => ({ protocol, ip: this.config.listenIp, announcedAddress: this.config.announcedAddress, portRange: { min: this.config.minPort, max: this.config.maxPort } })),
      enableUdp: true, enableTcp: true, preferUdp: true,
      initialAvailableOutgoingBitrate: Math.min(1000000, this.config.outgoing),
      appData: { direction },
    })
    try {
      await transport.setMaxIncomingBitrate(this.config.incoming)
      await transport.setMaxOutgoingBitrate(this.config.outgoing)
    } catch (e) { transport.close(); throw e }
    peer.transports.set(transport.id, transport)
    transport.on('dtlsstatechange', state => { if (state === 'closed') transport.close() })
    transport.observer.on('close', () => {
      peer.transports.delete(transport.id)
      this.broadcast(id, 'transportClosed', { peerId, transportId: transport.id })
    })
    return { id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters }
  }
  ownedTransport(peer, transportId, direction) {
    const t = peer.transports.get(transportId)
    if (!t || (direction && t.appData.direction !== direction)) throw new Error('Invalid transport')
    return t
  }
  async produce(id, peerId, data) {
    const { room, peer } = this.get(id, peerId)
    if (!['audio', 'video'].includes(data.kind)) throw new Error('Invalid media kind')
    if ([...peer.producers.values()].some(p => p.kind === data.kind)) throw new Error('每人仅允许一路同类型媒体')
    if (this.producers(room).length >= this.config.maxStreams) throw new Error('房间已达媒体流上限')
    const producer = await this.ownedTransport(peer, data.transportId, 'send').produce({ kind: data.kind, rtpParameters: data.rtpParameters })
    peer.producers.set(producer.id, producer)
    producer.on('transportclose', () => this.closeProducer(id, peer, producer.id))
    this.broadcast(id, 'newProducer', { id: producer.id, peerId, kind: producer.kind })
    return { id: producer.id }
  }
  closeProducer(id, peer, producerId) {
    const producer = peer.producers.get(producerId)
    if (!producer) return
    peer.producers.delete(producerId); producer.close()
    this.broadcast(id, 'producerClosed', { producerId, peerId: peer.id })
  }
  async consume(id, peerId, data) {
    const { room, peer } = this.get(id, peerId)
    const source = this.producers(room).find(p => p.id === data.producerId && p.peerId !== peerId)
    if (!source || !room.router.canConsume({ producerId: source.id, rtpCapabilities: data.rtpCapabilities })) throw new Error('媒体不存在或编解码不兼容')
    const existing = [...peer.consumers.values()].find(c => c.producerId === source.id)
    if (existing) throw new Error('Already consuming')
    const consumer = await this.ownedTransport(peer, data.transportId, 'recv').consume({ producerId: source.id, rtpCapabilities: data.rtpCapabilities, paused: true })
    peer.consumers.set(consumer.id, consumer)
    const remove = () => { peer.consumers.delete(consumer.id); consumer.close() }
    consumer.on('transportclose', remove); consumer.on('producerclose', remove)
    return { id: consumer.id, producerId: source.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters, peerId: source.peerId }
  }
  leave(id, peerId) {
    const room = this.rooms.get(id), peer = room?.peers.get(peerId)
    if (!peer) return
    for (const p of [...peer.producers.values()]) this.closeProducer(id, peer, p.id)
    for (const c of peer.consumers.values()) c.close()
    for (const t of peer.transports.values()) t.close()
    room.peers.delete(peerId)
    this.broadcast(id, 'peerLeft', { peerId })
    if (!room.peers.size) { room.router.close(); this.rooms.delete(id) }
  }
  close() { for (const [id, room] of this.rooms) for (const peer of [...room.peers.keys()]) this.leave(id, peer) }
}
