import { Server } from 'socket.io'
import { WebSocketServer, WebSocket } from 'ws'
import { config } from './config.js'
import { verifyToken } from './middleware/auth.js'
import * as repo from './repositories/meetings.js'
import { activeMember, requireHost } from './services/meetingService.js'
import { log } from './logger.js'
import { enforceMedia, removeMediaParticipant, deleteMediaRoom } from './services/sfu.js'
import { integer, text } from './validation.js'

const room = (id) => `meeting:${id}`
const sessions = new Map()
const hostCommands = new Set(['host_mute_all', 'kick_user', 'close_chat'])
const validId = (id) => typeof id === 'string' && /^SH-\d{6}$/.test(id)
const envelope = (type, from, target, payload) => ({ type, from, target, payload })

export function broadcast(id, message, exclude) {
  for (const session of sessions.values()) {
    if (session.meetingId !== id || session === exclude) continue
    if (message.target !== 'all' && message.target !== session.user.id) continue
    session.send(message)
  }
}
export function disconnectUser(id, userId) {
  for (const s of sessions.values()) if (s.meetingId === id && s.user.id === userId) s.close()
}
export function disconnectMeeting(id) {
  for (const s of sessions.values()) if (s.meetingId === id) s.close()
}

async function handleMessage(s, message) {
  if (!message || Array.isArray(message) || typeof message !== 'object') throw new Error('消息必须为JSON对象')
  const { type, target, payload = {} } = message
  await activeMember(s.meetingId, s.user.id)
  if (s.exp * 1000 <= Date.now()) { s.close(); throw new Error('令牌已过期') }
  if (message.from !== undefined && message.from !== s.user.id) throw new Error('不能伪造from')
  if (target !== 'all' && (!Number.isSafeInteger(target) || target <= 0)) throw new Error('target必须是数字userId或all')
  if (target !== 'all') await activeMember(s.meetingId, target)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload必须为对象')
  let output
  if (hostCommands.has(type)) await requireHost(s.meetingId, s.user.id)
  switch (type) {
    case 'offer': case 'answer':
      output = { sdp: text(payload.sdp, 'sdp', 100000) }; break
    case 'ice_candidate':
      output = { candidate: text(payload.candidate, 'candidate', 8192), sdpMid: typeof payload.sdpMid === 'string' ? payload.sdpMid : null,
        sdpMLineIndex: payload.sdpMLineIndex === null ? null : integer(payload.sdpMLineIndex, 'sdpMLineIndex', 0, 65535) }; break
    case 'toggle_audio': case 'toggle_video': {
      if (payload.userId !== s.user.id) throw new Error('只能改变自己的媒体状态')
      const status = integer(payload.status, 'status', 0, 1)
      await repo.setParticipantStatus(s.meetingId, s.user.id, type === 'toggle_audio' ? 'audioStatus' : 'videoStatus', status)
      output = { userId: s.user.id, status }; break
    }
    case 'screen_share_start': case 'screen_share_stop':
      if (payload.userId !== s.user.id) throw new Error('只能改变自己的共享状态')
      await repo.setParticipantStatus(s.meetingId, s.user.id, 'screenShare', type === 'screen_share_start' ? 1 : 0)
      output = { userId: s.user.id }; break
    case 'host_mute_all':
      await repo.muteAll(s.meetingId, s.user.id); await enforceMedia(s.meetingId); output = {}; break
    case 'kick_user': {
      const userId = integer(payload.targetUserId, 'targetUserId', 1, Number.MAX_SAFE_INTEGER)
      if (userId === s.user.id) throw new Error('主持人不能移除自己')
      await repo.kickParticipant(s.meetingId, userId, s.user.id)
      broadcast(s.meetingId, envelope(type, s.user.id, 'all', { targetUserId: userId }))
      disconnectUser(s.meetingId, userId)
      await removeMediaParticipant(s.meetingId, userId)
      return
    }
    case 'close_chat':
      if (typeof payload.enable !== 'boolean') throw new Error('enable必须为布尔值')
      await repo.setChat(s.meetingId, payload.enable, s.user.id)
      output = { enable: payload.enable }; break
    case 'active_speaker': {
      await requireHost(s.meetingId, s.user.id)
      const activeUserId = integer(payload.activeUserId, 'activeUserId', 1, Number.MAX_SAFE_INTEGER)
      await activeMember(s.meetingId, activeUserId)
      output = { activeUserId }; break
    }
    case 'switch_layout':
      await requireHost(s.meetingId, s.user.id)
      if (!['gallery', 'speaker'].includes(payload.layout)) throw new Error('layout格式不正确')
      output = { layout: payload.layout }; break
    default: throw new Error('不支持的消息类型')
  }
  // Control and state changes always reach the entire meeting; SDP/ICE honor target.
  const destination = ['offer', 'answer', 'ice_candidate'].includes(type) ? target : 'all'
  broadcast(s.meetingId, envelope(type, s.user.id, destination, output), s)
}

export function attachSignaling(server) {
  const io = new Server(server, { destroyUpgrade: false, path: '/socket.io', cors: { origin: config.origin }, maxHttpBufferSize: 128 * 1024, transports: ['polling', 'websocket'] })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 })
  async function authorize(token, meetingId) {
    if (!validId(meetingId) || !token) throw new Error('无效会议或令牌')
    const user = verifyToken(token)
    if (user.meetingId && user.meetingId !== meetingId) throw new Error('令牌不属于当前会议')
    await activeMember(meetingId, user.id)
    return user
  }
  function register(key, transport, user, meetingId, isSocketIo) {
    const session = { key, user, meetingId, exp: user.exp,
      send: (message) => { if (isSocketIo) transport.emit('message', message); else if (transport.readyState === WebSocket.OPEN) transport.send(JSON.stringify(message)) },
      close: () => isSocketIo ? transport.disconnect(true) : transport.close(1000, 'meeting session closed'),
    }
    for (const old of sessions.values()) {
      if (old.meetingId === meetingId && old.user.id === user.id) old.close()
    }
    sessions.set(key, session)
    let count = 0, windowStarted = Date.now(), pending = 0
    let queue = Promise.resolve()
    const expiry = user.exp ? setTimeout(() => session.close(), Math.max(0, user.exp * 1000 - Date.now())) : null
    expiry?.unref()
    const onMessage = (raw, ack) => {
      if (Date.now() - windowStarted >= 10_000) { count = 0; windowStarted = Date.now() }
      if (++count > 100 || pending > 20) { session.send(envelope('error', 0, user.id, { code: 429, msg: '消息发送过于频繁' })); return }
      pending++
      queue = queue.then(async () => {
        try {
          const message = isSocketIo ? raw : JSON.parse(raw.toString())
          await handleMessage(session, message)
          if (typeof ack === 'function') ack({ code: 0, msg: 'ok', data: null })
        } catch (error) {
          const body = { code: error.status || 400, msg: error.status >= 500 ? '信令处理失败' : error.message }
          session.send(envelope('error', 0, user.id, body))
          if (typeof ack === 'function') ack({ ...body, data: null })
        } finally { pending-- }
      })
    }
    transport.on('message', onMessage)
    const onClose = async () => {
      await queue
      if (expiry) clearTimeout(expiry)
      sessions.delete(key)
      // Only the last transport for the user leaving this meeting closes membership.
      if ([...sessions.values()].some((other) => other.meetingId === meetingId && other.user.id === user.id)) return
      try {
        const left = await repo.leaveMeeting(meetingId, user.id)
        if (!left) return
        await removeMediaParticipant(meetingId, user.id)
        broadcast(meetingId, envelope('participant_left', user.id, 'all', { userId: user.id }))
      } catch (error) { log('error', 'disconnect cleanup failed', { userId: user.id, meetingId, error: error.message }) }
    }
    transport.on(isSocketIo ? 'disconnect' : 'close', onClose)
    transport.on('error', (error) => log('error', 'transport error', { error: error.message, meetingId }))
    repo.participants(meetingId).then((members) => {
      const participant = members.find((m) => m.userId === user.id)
      if (participant) broadcast(meetingId, envelope('participant_joined', user.id, 'all', { participant }), session)
    }).catch((error) => log('error', 'participant broadcast failed', { error: error.message }))
  }
  io.use(async (socket, next) => {
    try {
      const meetingId = socket.handshake.auth.meetingId || socket.handshake.query.meetingId
      const token = socket.handshake.auth.token || socket.handshake.query.token
      socket.data.user = await authorize(token, meetingId)
      socket.data.meetingId = meetingId
      next()
    } catch { next(new Error('unauthorized')) }
  })
  io.on('connection', (socket) => {
    const id = socket.data.meetingId
    socket.join(room(id))
    register(socket.id, socket, socket.data.user, id, true)
  })
  server.on('upgrade', async (req, socket, head) => {
    if (!req.url.startsWith('/ws/signaling/')) return
    try {
      const url = new URL(req.url, 'http://localhost')
      const meetingId = url.pathname.split('/')[3]
      if (url.pathname !== `/ws/signaling/${meetingId}`) throw new Error('bad path')
      if (req.headers.origin && req.headers.origin !== config.origin) throw new Error('bad origin')
      const user = await authorize(url.searchParams.get('token'), meetingId)
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
        register(Symbol(), ws, user, meetingId, false)
      })
    } catch { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy() }
  })
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.alive === false) { ws.terminate(); continue }
      ws.alive = false; ws.ping()
    }
  }, 30_000)
  ping.unref()
  wss.on('connection', (ws) => { ws.alive = true; ws.on('pong', () => { ws.alive = true }) })
  // handleUpgrade's callback must emit connection to enable heartbeat hooks.
  wss.on('close', () => clearInterval(ping))
  io.rawWebSockets = wss
  return io
}
