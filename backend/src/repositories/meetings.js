import { pool, transaction } from '../db.js'
import { HttpError } from '../errors.js'

export async function getMeeting(id, db = pool, lock = false) {
  const [rows] = await db.execute(`SELECT * FROM meetings WHERE id=?${lock ? ' FOR UPDATE' : ''}`, [id])
  if (!rows[0]) throw new HttpError(404, '会议不存在')
  return rows[0]
}
function alive(m) { if (m.status === 'ended') throw new HttpError(409, '会议已结束') }
export function assertHost(m, id) { if (m.host_user_id !== id) throw new HttpError(403, '仅主持人可执行此操作') }
const appendLog = (db, id, userId, action, payload = null) => db.execute('INSERT INTO participant_logs (meeting_id,user_id,action,payload) VALUES (?,?,?,?)', [id, userId, action, payload ? JSON.stringify(payload) : null])
export async function participant(id, userId, db = pool) {
  const [rows] = await db.execute('SELECT * FROM participants WHERE meeting_id=? AND user_id=?', [id, userId])
  return rows[0]
}
function assertActive(p) { if (!p?.joined_at || p.left_at || p.kicked || p.waiting) throw new HttpError(403, '你不是当前会议的参会人') }
export async function activeParticipant(id, userId, db = pool) {
  alive(await getMeeting(id, db))
  const p = await participant(id, userId, db); assertActive(p); return p
}
async function checkCapacity(db, m) {
  const [rows] = await db.execute('SELECT COUNT(*) AS count FROM participants WHERE meeting_id=? AND joined_at IS NOT NULL AND left_at IS NULL AND waiting=FALSE', [m.id])
  if (Number(rows[0].count) >= m.max_participants) throw new HttpError(409, '会议人数已满')
}
export async function createMeeting(input, host) {
  return transaction(async (db) => {
    await db.execute(`INSERT INTO meetings
      (id,title,host_user_id,starts_at,duration_minutes,max_participants,password_hash,default_mute,open_waiting_room,join_before_host,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [input.id, input.title, host.id, input.startsAt, input.duration, input.maxParticipants,
      input.passwordHash, input.defaultMute, input.openWaitingRoom, input.joinBeforeHost, input.immediate ? 'ongoing' : 'scheduled'])
    await db.execute("INSERT INTO participants (meeting_id,user_id,nickname,role,joined_at) VALUES (?,?,?,'host',?)", [input.id, host.id, host.nickname, input.immediate ? new Date() : null])
    if (input.immediate) await appendLog(db, input.id, host.id, 'join')
  })
}
export async function getMeetingDetails(id) {
  const m = await getMeeting(id)
  return { meetingId: m.id, title: m.title, meetingPassword: '', maxParticipants: m.max_participants,
    meetingStatus: { scheduled: 0, ongoing: 1, ended: 2 }[m.status], defaultMute: !!m.default_mute }
}
export async function listMeetings(userId) {
  const [rows] = await pool.execute('SELECT id AS meetingId,title,starts_at AS startTime,duration_minutes AS duration,max_participants AS maxParticipants,status FROM meetings WHERE host_user_id=? ORDER BY starts_at DESC', [userId]); return rows
}
export async function joinMeeting(id, user) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); alive(m)
    const host = m.host_user_id === user.id
    if (m.locked && !host) throw new HttpError(423, '会议已锁定')
    const old = await participant(id, user.id, db)
    if (old?.kicked) throw new HttpError(403, '你已被移出会议')
    const role = host ? 'host' : 'participant'
    if (old?.joined_at && !old.left_at && !old.waiting) return { role, meeting: m }
    if (!host && m.status === 'scheduled' && !m.join_before_host) throw new HttpError(409, '请等待主持人开始会议')
    if (m.open_waiting_room && !host) {
      await db.execute(`INSERT INTO participants (meeting_id,user_id,nickname,role,waiting) VALUES (?,?,?,'participant',TRUE)
        ON DUPLICATE KEY UPDATE nickname=VALUES(nickname),waiting=TRUE,left_at=NULL,joined_at=NULL`, [id, user.id, user.nickname])
      return { role, waiting: true, meeting: m }
    }
    await checkCapacity(db, m)
    await db.execute(`INSERT INTO participants (meeting_id,user_id,nickname,role,joined_at,muted,audio_status)
      VALUES (?,?,?,?,UTC_TIMESTAMP(3),?,?) ON DUPLICATE KEY UPDATE nickname=VALUES(nickname),role=VALUES(role),joined_at=UTC_TIMESTAMP(3),
      left_at=NULL,waiting=FALSE,muted=VALUES(muted),audio_status=VALUES(audio_status),video_status=0,screen_share=0`,
      [id, user.id, user.nickname, role, !host && !!m.default_mute, !host && m.default_mute ? 0 : 1])
    await appendLog(db, id, user.id, 'join')
    // Host presence determines whether the meeting has officially started.
    if (host && m.status === 'scheduled') await db.execute("UPDATE meetings SET status='ongoing' WHERE id=?", [id])
    return { role, meeting: m }
  })
}
export async function admitParticipant(id, userId, hostId) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); alive(m); assertHost(m, hostId)
    await checkCapacity(db, m)
    const [r] = await db.execute('UPDATE participants SET waiting=FALSE,joined_at=UTC_TIMESTAMP(3),audio_status=?,muted=? WHERE meeting_id=? AND user_id=? AND waiting=TRUE AND kicked=FALSE', [m.default_mute ? 0 : 1, !!m.default_mute, id, userId])
    if (!r.affectedRows) throw new HttpError(404, '未找到候场参会人')
    await appendLog(db, id, userId, 'join')
  })
}
export async function waitingParticipants(id) {
  const [rows] = await pool.execute('SELECT user_id AS userId,nickname FROM participants WHERE meeting_id=? AND waiting=TRUE AND kicked=FALSE', [id]); return rows
}
export async function leaveMeeting(id, userId) {
  return transaction(async (db) => {
    await getMeeting(id, db, true)
    const [r] = await db.execute('UPDATE participants SET left_at=UTC_TIMESTAMP(3),audio_status=0,video_status=0,screen_share=0 WHERE meeting_id=? AND user_id=? AND joined_at IS NOT NULL AND left_at IS NULL', [id, userId])
    if (r.affectedRows) await appendLog(db, id, userId, 'leave')
    return r.affectedRows > 0
  })
}
export async function participants(id) {
  const [rows] = await pool.execute(`SELECT p.user_id AS userId,p.nickname,u.avatar,p.role,p.audio_status AS audioStatus,p.video_status AS videoStatus,p.screen_share AS screenShare
    FROM participants p JOIN users u ON u.id=p.user_id WHERE p.meeting_id=? AND p.joined_at IS NOT NULL AND p.left_at IS NULL AND p.waiting=FALSE`, [id])
  return rows.map(({ role, ...item }) => ({ ...item, isHost: role === 'host' }))
}
export async function setMeetingLock(id, locked, hostId) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); alive(m); assertHost(m, hostId)
    await db.execute('UPDATE meetings SET locked=? WHERE id=?', [locked, id])
  })
}
export async function muteAll(id, hostId) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); alive(m); assertHost(m, hostId)
    await db.execute("UPDATE participants SET muted=TRUE,audio_forced=TRUE,audio_status=0 WHERE meeting_id=? AND role='participant' AND joined_at IS NOT NULL AND left_at IS NULL", [id])
  })
}
export async function muteParticipant(id, userId, media, muted, hostId) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); alive(m); assertHost(m, hostId)
    const p = await participant(id, userId, db); assertActive(p)
    if (p.role === 'host') throw new HttpError(400, '不能控制主持人')
    const prefix = media === 'audio' ? 'audio' : 'video'
    // Unmute grants permission. It never turns on a remote device without user consent.
    await db.execute(`UPDATE participants SET ${prefix}_forced=?,${prefix}_status=IF(?,0,${prefix}_status) WHERE meeting_id=? AND user_id=?`, [muted, muted, id, userId])
  })
}
export async function kickParticipant(id, userId, hostId) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); alive(m); assertHost(m, hostId)
    const p = await participant(id, userId, db); assertActive(p)
    if (p.role === 'host') throw new HttpError(400, '主持人不能移除自己')
    await db.execute('UPDATE participants SET left_at=UTC_TIMESTAMP(3),kicked=TRUE,audio_status=0,video_status=0,screen_share=0 WHERE meeting_id=? AND user_id=?', [id, userId])
    await appendLog(db, id, userId, 'kick')
  })
}
export async function setParticipantStatus(id, userId, field, status) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); alive(m)
    const p = await participant(id, userId, db); assertActive(p)
    const columns = { audioStatus: 'audio_status', videoStatus: 'video_status', screenShare: 'screen_share' }
    const column = columns[field]
    if (!column) throw new HttpError(400, '无效状态')
    if (status && ((field === 'audioStatus' && p.audio_forced) || (field === 'videoStatus' && p.video_forced))) throw new HttpError(403, '主持人已禁用此媒体')
    await db.execute(`UPDATE participants SET ${column}=? WHERE meeting_id=? AND user_id=?`, [status, id, userId])
  })
}
export async function setChat(id, enable, hostId) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); alive(m); assertHost(m, hostId)
    await db.execute('UPDATE meetings SET chat_enabled=? WHERE id=?', [enable, id])
  })
}
export async function chat(id, userId, content) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); alive(m)
    await activeParticipant(id, userId, db)
    if (!m.chat_enabled) throw new HttpError(403, '主持人已关闭聊天')
    const [r] = await appendLog(db, id, userId, 'chat', { content })
    return r.insertId
  })
}
export async function endMeeting(id, hostId) {
  return transaction(async (db) => {
    const m = await getMeeting(id, db, true); assertHost(m, hostId)
    if (m.status === 'ended') return
    await db.execute("UPDATE meetings SET status='ended',ended_at=UTC_TIMESTAMP(3) WHERE id=?", [id])
    const [active] = await db.execute('SELECT user_id FROM participants WHERE meeting_id=? AND joined_at IS NOT NULL AND left_at IS NULL', [id])
    for (const p of active) await appendLog(db, id, p.user_id, 'leave')
    await db.execute('UPDATE participants SET left_at=UTC_TIMESTAMP(3),waiting=FALSE,audio_status=0,video_status=0,screen_share=0 WHERE meeting_id=? AND left_at IS NULL', [id])
  })
}
