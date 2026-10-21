import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { HttpError } from '../errors.js'

export function signToken(user) {
  return jwt.sign({ nickname: user.nickname }, config.jwtSecret, { subject: String(user.id), expiresIn: config.jwtExpiresIn, issuer: 'shunhui-api', audience: 'shunhui-client' })
}

export function verifyToken(token) {
  const payload = jwt.verify(token, config.jwtSecret, { issuer: 'shunhui-api', audience: 'shunhui-client', algorithms: ['HS256'] })
  if (!Number.isSafeInteger(Number(payload.sub)) || Number(payload.sub) <= 0 || !payload.exp) throw new Error('invalid JWT subject')
  return { id: Number(payload.sub), nickname: payload.nickname, exp: payload.exp, meetingId: payload.meetingId, role: payload.role }
}

export function authenticate(req, _res, next) {
  try {
    const header = req.get('authorization') || ''
    if (!header.startsWith('Bearer ')) throw new HttpError(401, '请先登录')
    req.user = verifyToken(header.slice(7))
    if (req.user.meetingId && req.user.meetingId !== req.params.meetingId) throw new HttpError(403, '会议令牌不能用于此资源')
    next()
  } catch (error) { next(error instanceof HttpError ? error : new HttpError(401, '登录已失效')) }
}

export function socketAuthenticate(socket, next) {
  try {
    const token = socket.handshake.auth?.token
    if (!token) throw new Error('missing token')
    socket.data.user = verifyToken(token)
    next()
  } catch { next(new Error('unauthorized')) }
}
