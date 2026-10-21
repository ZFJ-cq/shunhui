import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import 'dotenv/config'
import { config } from '../config.js'

const connection = await mysql.createConnection({ host: config.database.host, port: config.database.port, user: config.database.user, password: config.database.password, multipleStatements: true })
try {
  if (!/^[a-zA-Z0-9_]+$/.test(config.database.database)) throw new Error('Invalid MYSQL_DATABASE identifier')
  const sql = (await readFile(new URL('../../sql/schema.sql', import.meta.url), 'utf8')).replaceAll('shunhui', config.database.database)
  await connection.query(sql)
  console.log('Database schema initialized')
} finally { await connection.end() }
