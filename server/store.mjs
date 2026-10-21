import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// A single authoritative meeting process. Both adapters commit snapshots atomically.
export async function openStore() {
  let sqlite, pool;
  const tables = ['users', 'meetings', 'participants', 'chats', 'audit'];
  if (process.env.DATABASE_URL) {
    const mysql = await import('mysql2/promise');
    pool = mysql.createPool(process.env.DATABASE_URL);
    for (const t of tables) await pool.query(`CREATE TABLE IF NOT EXISTS ${t} (id VARCHAR(80) PRIMARY KEY, data JSON NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    const file = process.env.DB_FILE || resolve('data/meeting.sqlite');
    mkdirSync(dirname(file), { recursive: true });
    sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    for (const t of tables) sqlite.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }
  const state = {};
  for (const t of tables) {
    const rows = pool ? (await pool.query(`SELECT data FROM ${t}`))[0] : sqlite.prepare(`SELECT data FROM ${t}`).all();
    state[t] = rows.map(r => typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
  }
  const persisted = Object.fromEntries(tables.map(t => [t, new Set(state[t].map(row => row.id))]));
  let queue = Promise.resolve();
  function save() {
    const snapshot = structuredClone(state);
    const operation = queue.then(async () => {
      if (pool) {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          for (const t of tables) {
            const current = new Set(snapshot[t].map(row => row.id));
            for (const id of persisted[t]) if (!current.has(id)) await conn.query(`DELETE FROM ${t} WHERE id = ?`, [id]);
            for (const row of snapshot[t]) await conn.query(`INSERT INTO ${t} (id,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)`, [row.id, JSON.stringify(row)]);
          }
          await conn.commit();
        } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
      } else {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          for (const t of tables) {
            const current = new Set(snapshot[t].map(row => row.id));
            const remove = sqlite.prepare(`DELETE FROM ${t} WHERE id = ?`);
            for (const id of persisted[t]) if (!current.has(id)) remove.run(id);
            const upsert = sqlite.prepare(`INSERT INTO ${t} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
            for (const row of snapshot[t]) upsert.run(row.id, JSON.stringify(row));
          }
          sqlite.exec('COMMIT');
        } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
      }
      for (const t of tables) persisted[t] = new Set(snapshot[t].map(row => row.id));
    });
    queue = operation.catch(e => console.error('Persistence failed', e.message));
    return operation;
  }
  return { state, save, async close() { await queue; sqlite?.close(); await pool?.end(); } };
}
