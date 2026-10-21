import 'dotenv/config'

const required = ['JWT_SECRET', 'MYSQL_DATABASE', 'MYSQL_USER']
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`)
}
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters')

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
  livekit: { url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET },
}
