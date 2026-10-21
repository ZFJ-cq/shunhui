import { log } from './logger.js'

export class HttpError extends Error {
  constructor(status, message, code = status) { super(message); this.status = status; this.code = code }
}

export function errorHandler(error, req, res, _next) {
  const status = error.status || 500
  const code = typeof error.code === 'number' ? error.code : status
  if (status >= 500) log('error', 'request failed', { path: req.path, error: error.message, stack: error.stack })
  res.status(status).json({ code, msg: status === 500 ? '服务器内部错误' : error.message, data: null })
}

export function notFound(_req, _res, next) { next(new HttpError(404, '接口不存在')) }
