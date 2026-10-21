import { Router } from 'express'
import { HttpError } from './errors.js'
import { authenticate, signToken } from './middleware/auth.js'
import { activeMember, create, join, requireHost, sfuToken } from './services/meetingService.js'
import { verifyPassword } from './services/passwords.js'
import * as repo from './repositories/meetings.js'
import { createUser, findAccountByPhone } from './repositories/users.js'
import { bool, integer, objectBody, text } from './validation.js'
import { enforceMedia, removeMediaParticipant, deleteMediaRoom } from './services/sfu.js'
import { broadcast, disconnectMeeting, disconnectUser } from './signaling.js'

export const router = Router()
const success = (res, data, status = 200) => res.status(status).json({ code: 0, msg: 'ok', data })
const meetingId = (req) => text(req.params.meetingId, 'meetingId', 20)
const assertIdentity = (body, key, userId, required = true) => {
  if (body[key] === undefined && !required) return
  if (Number(body[key]) !== Number(userId)) throw new HttpError(403, `${key}与当前登录用户不一致`)
}
function publish(req, id, type, payload) {
  const message = { type, from: req.user.id, target: 'all', payload }
  broadcast(id, message)
}

router.post('/user/guest-login', async (req, res) => {
  const nickname = text(objectBody(req.body).nickname, 'nickname', 40)
  const user = await createUser(nickname)
  return success(res, { userId: user.id, token: signToken(user), isGuest: true }, 201)
})

router.post('/user/login', async (req, res) => {
  const body = objectBody(req.body)
  const phone = text(body.phone, 'phone', 24)
  const password = text(body.password, 'password', 200)
  const user = await findAccountByPhone(phone)
  if (!user || !await verifyPassword(password, user.passwordHash)) throw new HttpError(401, '手机号或密码错误')
  return success(res, { userId: user.id, nickname: user.nickname, avatar: user.avatar, token: signToken(user) })
})

async function createMeeting(req, res, immediate) {
  const body = objectBody(req.body)
  assertIdentity(body, 'hostId', req.user.id, immediate)
  if (!immediate && (!Number.isSafeInteger(body.startTime) || body.startTime < 0)) throw new HttpError(400, 'startTime必须是毫秒时间戳')
  const startsAt = new Date(immediate ? Date.now() : body.startTime)
  if (Number.isNaN(startsAt.getTime())) throw new HttpError(400, 'startTime格式不正确')
  if (!immediate && startsAt.getTime() <= Date.now()) throw new HttpError(400, '预约时间必须晚于当前时间')
  const password = body.meetingPassword === undefined || body.meetingPassword === '' ? '' : text(body.meetingPassword, 'meetingPassword', 64)
  const data = await create({
    title: text(body.title, 'title'), startsAt: startsAt.toISOString().slice(0, 23).replace('T', ' '),
    duration: integer(body.duration ?? 60, 'duration', 1, 1440), maxParticipants: integer(body.maxParticipants ?? 25, 'maxParticipants', 2, 500),
    defaultMute: bool(body.defaultMute, 'defaultMute', true), password,
    openWaitingRoom: bool(body.openWaitingRoom, 'openWaitingRoom'), joinBeforeHost: bool(body.joinBeforeHost, 'joinBeforeHost', true), immediate,
  }, req.user)
  return success(res, data, 201)
}
router.post('/meetings/create', authenticate, (req, res) => createMeeting(req, res, true))
router.post('/meetings/schedule', authenticate, (req, res) => createMeeting(req, res, false))
router.get('/meetings/:meetingId', authenticate, async (req, res) => success(res, await repo.getMeetingDetails(meetingId(req))))

router.post('/meetings/:meetingId/join', authenticate, async (req, res) => {
  const body = objectBody(req.body)
  assertIdentity(body, 'userId', req.user.id)
  if (body.nickname) req.user.nickname = text(body.nickname, 'nickname', 40)
  const id = meetingId(req)
  const data = await join(id, req.user, body.password || '')
  return success(res, data)
})
router.get('/meetings/:meetingId/sfu-token', authenticate, async (req, res) => {
  const id = meetingId(req)
  await activeMember(id, req.user.id)
  return success(res, await sfuToken(id, req.user))
})

router.post('/meetings/:meetingId/leave', authenticate, async (req, res) => {
  const id = meetingId(req)
  assertIdentity(objectBody(req.body), 'userId', req.user.id)
  await activeMember(id, req.user.id)
  await repo.leaveMeeting(id, req.user.id)
  publish(req, id, 'participant_left', { userId: req.user.id })
  disconnectUser(id, req.user.id)
  await removeMediaParticipant(id, req.user.id)
  return success(res, null)
})

router.put('/meetings/:meetingId/end', authenticate, async (req, res) => {
  const id = meetingId(req)
  assertIdentity(objectBody(req.body), 'hostId', req.user.id)
  await requireHost(id, req.user.id)
  await repo.endMeeting(id, req.user.id)
  await deleteMediaRoom(id)
  publish(req, id, 'close_meeting', { meetingId: id })
  disconnectMeeting(id)
  return success(res, null)
})

router.get('/meetings/:meetingId/participants', authenticate, async (req, res) => {
  const id = meetingId(req)
  await activeMember(id, req.user.id)
  return success(res, await repo.participants(id))
})

router.get('/meetings/:meetingId/waiting-participants', authenticate, async (req, res) => {
  const id = meetingId(req)
  await requireHost(id, req.user.id)
  return success(res, await repo.waitingParticipants(id))
})
router.put('/meetings/:meetingId/participant/admit', authenticate, async (req, res) => {
  const id = meetingId(req), body = objectBody(req.body)
  assertIdentity(body, 'hostId', req.user.id)
  const target = integer(body.targetUserId, 'targetUserId', 1, Number.MAX_SAFE_INTEGER)
  await repo.admitParticipant(id, target, req.user.id)
  publish(req, id, 'participant_admitted', { userId: target })
  return success(res, null)
})

router.put('/meetings/:meetingId/participant/mute', authenticate, async (req, res) => {
  const id = meetingId(req), body = objectBody(req.body)
  const target = integer(body.targetUserId, 'targetUserId', 1, Number.MAX_SAFE_INTEGER)
  if (!['audio', 'video'].includes(body.media)) throw new HttpError(400, 'media必须是audio或video')
  const mute = bool(body.mute, 'mute')
  await repo.muteParticipant(id, target, body.media, mute, req.user.id)
  await enforceMedia(id)
  publish(req, id, body.media === 'audio' ? 'toggle_audio' : 'toggle_video', { userId: target, status: mute ? 0 : 1 })
  return success(res, null)
})
router.put('/meetings/:meetingId/mute-all', authenticate, async (req, res) => {
  const id = meetingId(req)
  await repo.muteAll(id, req.user.id)
  await enforceMedia(id)
  publish(req, id, 'host_mute_all', {})
  return success(res, null)
})

router.delete('/meetings/:meetingId/participant/:targetUserId', authenticate, async (req, res) => {
  const id = meetingId(req), body = objectBody(req.body)
  assertIdentity(body, 'hostId', req.user.id)
  const targetId = integer(req.params.targetUserId, 'targetUserId', 1, Number.MAX_SAFE_INTEGER)
  if (targetId === Number(req.user.id)) throw new HttpError(400, '主持人不能移除自己')
  await repo.kickParticipant(id, targetId, req.user.id)
  publish(req, id, 'kick_user', { targetUserId: targetId })
  disconnectUser(id, targetId)
  await removeMediaParticipant(id, targetId)
  return success(res, null)
})
router.put('/meetings/:meetingId/lock', authenticate, async (req, res) => {
  const id = meetingId(req), body = objectBody(req.body)
  assertIdentity(body, 'hostId', req.user.id)
  const locked = bool(body.lock, 'lock')
  await repo.setMeetingLock(id, locked, req.user.id)
  publish(req, id, 'meeting_locked', { lock: locked })
  return success(res, null)
})
router.put('/meetings/:meetingId/chat/close', authenticate, async (req, res) => {
  const id = meetingId(req), body = objectBody(req.body)
  assertIdentity(body, 'hostId', req.user.id)
  await repo.setChat(id, bool(body.enable, 'enable'), req.user.id)
  publish(req, id, 'close_chat', { enable: body.enable })
  return success(res, null)
})
router.post('/meetings/:meetingId/chat/send', authenticate, async (req, res) => {
  const id = meetingId(req), content = text(objectBody(req.body).content, 'content', 2000)
  await activeMember(id, req.user.id)
  await repo.chat(id, req.user.id, content)
  const message = { type: 'chat_message', from: req.user.id, target: 'all', payload: { userId: req.user.id, nickname: req.user.nickname, content, createdAt: new Date().toISOString() } }
  broadcast(id, message)
  return success(res, null)
})
