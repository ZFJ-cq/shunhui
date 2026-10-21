import { pool } from '../db.js'

export async function createUser(nickname) {
  const [result] = await pool.execute('INSERT INTO users (nickname,is_guest) VALUES (?,TRUE)', [nickname])
  return { id: result.insertId, nickname, avatar: '', isGuest: true }
}

export async function findAccountByPhone(phone) {
  const [rows] = await pool.execute('SELECT id,nickname,avatar,password_hash AS passwordHash FROM users WHERE phone=? AND is_guest=FALSE', [phone])
  const user = rows[0]
  return user ? { id: user.id, nickname: user.nickname, avatar: user.avatar, passwordHash: user.passwordHash, isGuest: false } : null
}
