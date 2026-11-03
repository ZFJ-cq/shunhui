import 'dotenv/config'

const required = ['JWT_SECRET', 'MYSQL_DATABASE', 'MYSQL_USER']
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`)
}
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters')

function booleanEnv(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') return fallback
  if (/^(1|true|yes|on)$/i.test(value.trim())) return true
  if (/^(0|false|no|off)$/i.test(value.trim())) return false
  throw new Error(`Invalid ${name}; use true or false`)
}

const turnEnabled = booleanEnv('TURN_ENABLED', false)
const turnUrls = [...new Set([...(process.env.TURN_URLS || '').split(','), process.env.TURN_TCP_URL || ''].map(value => value.trim()).filter(Boolean))]
const turnSecret = process.env.TURN_SECRET || ''
const turnTtlSeconds = Number(process.env.TURN_TTL_SECONDS || 86400)
if (turnUrls.some(value => !/^turns?:/i.test(value))) throw new Error('TURN_URLS and TURN_TCP_URL must contain turn: or turns: URLs')
if (!Number.isSafeInteger(turnTtlSeconds) || turnTtlSeconds < 60 || turnTtlSeconds > 7 * 24 * 60 * 60) throw new Error('TURN_TTL_SECONDS must be between 60 and 604800')
if (turnEnabled && (!turnUrls.length || turnSecret.length < 32)) throw new Error('TURN_ENABLED requires TURN_URLS (or TURN_TCP_URL) and a TURN_SECRET of at least 32 characters')

export const config = {
  port: Number(process.env.PORT || 3001),
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  publicApiUrl: process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3001}`,
  wsPublicUrl: process.env.WS_PUBLIC_URL || `ws://localhost:${process.env.PORT || 3001}`,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  database: {
    host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD || '', database: process.env.MYSQL_DATABASE,
  },
  stunUrls: (process.env.STUN_URLS || '').split(',').map(value => value.trim()).filter(Boolean),
  turn: { enabled: turnEnabled, urls: turnUrls, secret: turnSecret, ttlSeconds: turnTtlSeconds },
  livekit: { url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET },
}
