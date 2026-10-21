import { randomInt } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import * as repo from '../repositories/meetings.js'
import { HttpError } from '../errors.js'
import { hashPassword, verifyPassword } from './passwords.js'

export function signMeetingToken(id, user, role) {
  return jwt.sign({ nickname: user.nickname, meetingId: id, role }, config.jwtSecret, {
    subject: String(user.id), expiresIn: '2h', issuer: 'shunhui-api', audience: 'shunhui-client',
  })
}

export async function create(input, user) {
  const passwordHash = input.password ? await hashPassword(input.password) : null
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = `SH-${randomInt(100000, 1000000)}`
    try {
      await repo.createMeeting({ ...input, id, passwordHash }, user)
      return { meetingId: id, joinUrl: `${config.publicApiUrl}/?meeting=${id}`, token: signMeetingToken(id, user, 'host'),
        meetingInfo: { title: input.title, meetingPassword: input.password, maxParticipants: input.maxParticipants } }
    } catch (error) { if (error.code !== 'ER_DUP_ENTRY' || attempt === 4) throw error }
  }
}

export async function join(id, user, password) {
  if (!/^SH-\d{6}$/.test(id)) throw new HttpError(400, 'meetingId格式不正确')
  const meeting = await repo.getMeeting(id)
  if (meeting.password_hash && Number(meeting.host_user_id) !== Number(user.id) && !await verifyPassword(password, meeting.password_hash)) throw new HttpError(403, '会议密码错误')
  const result = await repo.joinMeeting(id, user)
  if (result.waiting) throw new HttpError(409, '已进入候场室，请等待主持人准入后重试加入')
  const meetingToken = signMeetingToken(id, user, result.role)
  return { meetingToken, wsSignalingUrl: `${config.wsPublicUrl}/ws/signaling/${id}?token=${encodeURIComponent(meetingToken)}`,
    sfuUrl: config.livekit.url || '', meetingInfo: await repo.getMeetingDetails(id),
    participantInfo: { userId: user.id, nickname: user.nickname, isHost: result.role === 'host' } }
}

export async function requireHost(id, userId) {
  const meeting = await repo.getMeeting(id)
  if (meeting.host_user_id !== userId) throw new HttpError(403, '仅主持人可执行此操作')
  if (meeting.status === 'ended') throw new HttpError(409, '会议已结束')
  return meeting
}

export async function activeMember(id, userId) {
  const meeting = await repo.getMeeting(id)
  const member = await repo.participant(id, userId)
  if (meeting.status === 'ended' || !member?.joined_at || member.left_at || member.kicked || member.waiting) throw new HttpError(403, '你不是当前会议的参会人')
  return member
}

export { sfuToken } from './sfu.js'
