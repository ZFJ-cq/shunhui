import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { config } from './config.js'
import { router } from './routes.js'
import { errorHandler, notFound } from './errors.js'
import { log } from './logger.js'

export const app = express()
app.disable('x-powered-by')
app.use(helmet())
app.use((req, res, next) => {
  const origin = req.get('origin')
  if (origin && origin !== config.origin) return res.status(403).json({ code: 403, msg: '来源不允许', data: null })
  if (origin) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS') }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.json({ limit: '64kb' }))
app.use((req, res, next) => {
  const started = Date.now()
  res.on('finish', () => log('info', 'http request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }))
  next()
})
const rateLimitOptions = { windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ code: 429, msg: '请求过于频繁，请稍后重试', data: null }) }
app.use('/api', rateLimit(rateLimitOptions))
app.use('/api/user', rateLimit({ ...rateLimitOptions, limit: 20 }))
app.get('/health', (_req, res) => res.json({ code: 0, msg: 'ok', data: { status: 'ok' } }))
app.use('/api', (req, _res, next) => { req.io = app.get('io'); next() }, router)
app.use(notFound)
app.use(errorHandler)
