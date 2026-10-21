import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt = promisify(scryptCallback)
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64)
  return `${salt}:${key.toString('hex')}`
}
export async function verifyPassword(password, stored) {
  const [salt, hex] = (stored || '').split(':')
  if (!salt || !hex || typeof password !== 'string') return false
  const key = await scrypt(password, salt, 64)
  const expected = Buffer.from(hex, 'hex')
  return key.length === expected.length && timingSafeEqual(key, expected)
}
