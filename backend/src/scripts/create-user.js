import { pool } from '../db.js'
import { hashPassword } from '../services/passwords.js'
import { text } from '../validation.js'

const [phone, password, nickname, avatar = ''] = process.argv.slice(2)
if (!phone || !password || !nickname) {
  console.error('Usage: npm run user:create -- <phone> <password> <nickname> [avatarUrl]')
  process.exit(2)
}
try {
  const hash = await hashPassword(text(password, 'password', 200))
  const [result] = await pool.execute('INSERT INTO users (phone,password_hash,nickname,avatar,is_guest) VALUES (?,?,?,?,FALSE)', [text(phone, 'phone', 24), hash, text(nickname, 'nickname', 40), avatar])
  console.log(`Created account userId=${result.insertId}`)
} finally { await pool.end() }
