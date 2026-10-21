import mysql from 'mysql2/promise'
import { config } from './config.js'

export const pool = mysql.createPool({ ...config.database, waitForConnections: true, connectionLimit: 10, timezone: 'Z', dateStrings: false })

export async function transaction(work) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await work(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally { connection.release() }
}
