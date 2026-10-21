import { createServer } from 'node:http'
import { app } from './app.js'
import { config } from './config.js'
import { pool } from './db.js'
import { attachSignaling } from './signaling.js'
import { log } from './logger.js'

const httpServer = createServer(app)
const io = attachSignaling(httpServer)
app.set('io', io)

try {
  await pool.query('SELECT 1')
  httpServer.listen(config.port, '0.0.0.0', () => log('info', 'server listening', { port: config.port }))
} catch (error) {
  log('error', 'database connection failed', { error: error.message })
  process.exit(1)
}

async function shutdown(signal) {
  log('info', 'server shutting down', { signal })
  io.close()
  httpServer.close(async () => { await pool.end(); process.exit(0) })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
