import { HttpError } from './errors.js'

export function objectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '请求体必须为 JSON 对象')
  return body
}
export function text(value, name, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(400, `${name}格式不正确`)
  return value.trim()
}
export function integer(value, name, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) throw new HttpError(400, `${name}超出范围`)
  return number
}
export function bool(value, name, fallback = false) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new HttpError(400, `${name}必须为布尔值`)
  return value
}
