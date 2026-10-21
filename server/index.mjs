import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { openStore } from './store.mjs';
import { createSfu } from './sfu.mjs';
import { createRemoteSfu } from './remote-sfu.mjs';

export async function startServer(port = Number(process.env.PORT || 33101), options = {}) {
  const db = await openStore(), s = db.state;
  for (const p of s.participants) if (!p.leaveTime) p.leaveTime = new Date().toISOString();
  const secret = process.env.JWT_SECRET || randomBytes(48).toString('hex');
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw Error('JWT_SECRET required');
  const hash = value => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`; };
  const verify = (value, encoded = '') => { const [salt, digest] = encoded.split(':'); if (!digest) return false; const a = scryptSync(value, salt, 64), b = Buffer.from(digest, 'hex'); return a.length === b.length && timingSafeEqual(a, b); };
  if (process.env.ADMIN_PHONE && process.env.ADMIN_PASSWORD && !s.users.some(u => u.phone === process.env.ADMIN_PHONE)) s.users.push({ id: randomUUID(), phone: process.env.ADMIN_PHONE, nickname: '平台管理员', password: hash(process.env.ADMIN_PASSWORD), role: 'admin', isGuest: false, createdAt: new Date().toISOString() });
  await db.save();
  const app = express(), http = createServer(app);
  const allowedOrigins = new Set([
    process.env.APP_ORIGIN || 'http://localhost:5173',
    ...(process.env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean),
    ...(process.env.NODE_ENV === 'production' ? [] : [
      'http://localhost:5173', 'https://localhost:5173',
      'http://127.0.0.1:5173', 'https://127.0.0.1:5173',
    ]),
  ]);
  const allowOrigin = (origin, callback) => callback(null, !origin || allowedOrigins.has(origin));
  const io = new Server(http, { maxHttpBufferSize: 100000, cors: { origin: allowOrigin, credentials: true } });
  const notify = (id, type, payload, target) => io.to(target ? `${id}:${target}` : id).emit('signal', { type, from: 'server', target: target || 'all', payload });
  const sfu = options.sfu || (process.env.SFU_URL ? await createRemoteSfu(notify) : await createSfu(notify));
  const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
  const text = (v, max = 100) => typeof v === 'string' && v.trim().length && v.trim().length <= max ? v.trim() : fail(400, '字段为空或超出长度');
  const userPublic = u => ({ id: u.id, nickname: u.nickname, isGuest: u.isGuest, role: u.role || 'user', disabled: !!u.disabled, createdAt: u.createdAt });
  const tokenFor = u => jwt.sign({ sub: u.id, scope: 'user' }, secret, { expiresIn: '7d' });
  const authUser = token => { let claim; try { claim = jwt.verify(token, secret); } catch { fail(401, '登录已过期'); } const u = s.users.find(u => u.id === claim.sub); if (!u || u.disabled || claim.scope !== 'user') fail(401, '账号不可用'); return u; };
  const meeting = id => s.meetings.find(m => m.id === id) || fail(404, '会议不存在');
  const online = id => s.participants.filter(p => p.meetingId === id && !p.leaveTime);
  const publicMeeting = m => { const { passwordHash, banned, ...safe } = m; return { ...safe, meetingId: m.id, joinUrl: `${process.env.APP_ORIGIN || 'http://localhost:5173'}/m/${m.id}`, hasPassword: !!passwordHash, participantCount: online(m.id).length }; };
  const iceConfig = uid => {
    const servers = JSON.parse(process.env.ICE_SERVERS || '[]');
    if (process.env.STUN_URLS) {
      servers.push({ urls: process.env.STUN_URLS.split(',').map(v => v.trim()).filter(Boolean) });
    }
    if (process.env.TURN_URLS && process.env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 86400}:${uid}`;
      servers.push({ urls: process.env.TURN_URLS.split(',').map(v => v.trim()), username, credential: createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64') });
    }
    return servers;
  };
  const host = (m, u) => { if (m.hostId !== u.id) fail(403, '仅主持人可以操作'); };
  const member = (id, u) => online(id).find(p => p.userId === u.id) || fail(403, '请先加入会议');
  const audit = (u, action, meetingId, detail = '') => s.audit.push({ id: randomUUID(), userId: u.id, action, meetingId, detail, time: new Date().toISOString() });
  const snapshot = id => notify(id, 'room_state', { meeting: publicMeeting(meeting(id)), participants: online(id) });
  async function leave(id, uid, reason = 'left') {
    const p = online(id).find(p => p.userId === uid); if (p) p.leaveTime = new Date().toISOString();
    await sfu.leave(id, uid); notify(id, 'participant_left', { userId: uid, reason });
    clearTimeout(timers.get(`${id}:${uid}`)); timers.delete(`${id}:${uid}`);
    for (const socket of await io.in(`${id}:${uid}`).fetchSockets()) { socket.data.leaving = true; socket.disconnect(true); }
    await db.save(); snapshot(id);
  }
  async function end(m, u) { m.status = 'ended'; m.endedAt = new Date().toISOString(); audit(u, 'end', m.id); notify(m.id, 'meeting_ended', {}); for (const p of [...online(m.id)]) await leave(m.id, p.userId, 'ended'); await db.save(); }
  async function mute(m, u, body) {
    host(m, u); if (!['audio', 'video'].includes(body.media) || typeof body.mute !== 'boolean') fail(400, '无效媒体状态');
    const targets = body.targetUserId === 'all' ? online(m.id).filter(p => p.userId !== u.id) : [member(m.id, { id: body.targetUserId })];
    for (const p of targets) {
      // Unmute is a request: browsers must retain the participant's consent.
      if (body.mute) { p[body.media + 'Off'] = true; await sfu.pause(m.id, p.userId, body.media); }
      notify(m.id, 'host_media', { media: body.media, mute: body.mute }, p.userId);
    }
    audit(u, 'mute', m.id, JSON.stringify(body)); await db.save(); snapshot(m.id);
  }
  const sendChat = async (id, u, content) => {
    const m = meeting(id), p = member(id, u); if (m.chatClosed) fail(403, '主持人已关闭聊天');
    const message = { id: randomUUID(), meetingId: id, senderId: u.id, sender: p.nickname, text: text(content, 2000), time: new Date().toISOString() };
    s.chats.push(message); await db.save(); notify(id, 'chat_message', message); return message;
  };
  app.use(helmet({ contentSecurityPolicy: false })); app.use(express.json({ limit: '32kb' }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 300 }));
  const wrap = fn => async (req, res, next) => { try { const task = () => fn(req); res.json({ code: 0, data: req.params.id && req.method !== 'GET' ? await runInRoom(req.params.id, task) : await task() }); } catch (e) { next(e); } };
  app.get('/health', (_, res) => res.json({ status: 'ok', sfu: true }));
  app.post('/api/user/guest-login', rateLimit({ windowMs: 60000, limit: 30 }), wrap(async req => { const u = { id: randomUUID(), nickname: text(req.body.nickname, 30), isGuest: true, createdAt: new Date().toISOString() }; s.users.push(u); await db.save(); return { user: userPublic(u), userId: u.id, token: tokenFor(u), isGuest: true }; }));
  app.post('/api/user/register', rateLimit({ windowMs: 60000, limit: 10 }), wrap(async req => {
    const phone = text(req.body.phone, 11), nickname = text(req.body.nickname, 30), password = text(req.body.password, 200);
    if (!/^\d{11}$/.test(phone) || password.length < 8) fail(400, '手机号应为11位数字，密码至少8位');
    if (s.users.some(u => u.phone === phone)) fail(409, '该手机号已注册');
    const u = { id: randomUUID(), phone, nickname, password: hash(password), isGuest: false, role: 'user', createdAt: new Date().toISOString() };
    s.users.push(u); await db.save(); return { user: userPublic(u), token: tokenFor(u) };
  }));
  app.post('/api/user/login', rateLimit({ windowMs: 60000, limit: 15 }), wrap(req => { if (typeof req.body.password !== 'string' || req.body.password.length > 200) fail(400, '密码长度无效'); const u = s.users.find(u => u.phone === req.body.phone && !u.disabled); if (!u || !verify(String(req.body.password || ''), u.password)) fail(401, '账号或密码错误'); return { user: userPublic(u), token: tokenFor(u) }; }));
  app.use('/api', (req, res, next) => { try { req.user = authUser(req.headers.authorization?.replace(/^Bearer /, '')); next(); } catch (e) { next(e); } });
  app.get('/api/user/me', wrap(req => userPublic(req.user)));
  app.get('/api/meetings', wrap(req => s.meetings.filter(m => m.hostId === req.user.id || s.participants.some(p => p.meetingId === m.id && p.userId === req.user.id)).map(publicMeeting)));
  for (const route of ['create', 'schedule']) app.post(`/api/meetings/${route}`, wrap(async req => {
    const b = { ...req.body };
    for (const [from, to] of Object.entries({ meeting_title: 'title', start_time: 'startTime', meeting_password: 'meetingPassword', max_participants: 'maxParticipants', default_mute: 'defaultMute', join_before_host: 'joinBeforeHost' })) if (b[from] !== undefined && b[to] === undefined) b[to] = b[from];
    if (b.open_waiting_room || b.openWaitingRoom) fail(400, '等候室不在一期范围');
    const password = b.password || b.meetingPassword || '';
    if (password && !/^\d{6}$/.test(password)) fail(400, '会议密码应为6位数字');
    const cap = Number(b.maxParticipants ?? 25), duration = Number(b.duration ?? 60), start = route === 'create' ? Date.now() : (typeof b.startTime === 'number' ? b.startTime : Date.parse(b.startTime));
    if (!Number.isInteger(cap) || cap < 2 || cap > 25 || !Number.isInteger(duration) || duration < 5 || duration > 1440 || !Number.isFinite(start) || route === 'schedule' && start <= Date.now()) fail(400, '人数、时长或开始时间无效');
    const inviteDays = Number(b.inviteDays ?? 7);
    if (![1, 7, 30].includes(inviteDays)) fail(400, '邀请链接有效期无效');
    const m = { id: `SH-${randomBytes(5).toString('hex').toUpperCase()}`, title: text(b.title), hostId: req.user.id, hostName: req.user.nickname, startTime: new Date(start).toISOString(), duration, status: 'scheduled', maxParticipants: cap, defaultMute: b.defaultMute !== false, joinBeforeHost: b.joinBeforeHost !== false, locked: false, chatClosed: false, inviteExpiresAt: new Date(Date.now() + inviteDays * 86400000).toISOString(), banned: [], passwordHash: password ? hash(password) : '' };
    s.meetings.push(m); audit(req.user, route, m.id); await db.save(); return publicMeeting(m);
  }));
  app.get('/api/meetings/:id', wrap(req => publicMeeting(meeting(req.params.id))));
  app.post('/api/meetings/:id/join', wrap(async req => {
    const m = meeting(req.params.id), u = req.user, existing = online(m.id).find(p => p.userId === u.id);
    if (m.status === 'ended') fail(409, '会议已结束');
    if (m.banned.includes(u.id)) fail(403, '你已被移出会议');
    if (!existing) {
      if (u.id !== m.hostId) { if (m.inviteExpiresAt && Date.now() > Date.parse(m.inviteExpiresAt)) fail(403, '邀请链接已过期，请联系主持人'); if (m.locked) fail(403, '会议已锁定'); if (m.passwordHash && !verify(String(req.body.password || ''), m.passwordHash)) fail(403, '会议密码错误'); if (!m.joinBeforeHost && !online(m.id).some(p => p.isHost)) fail(403, '请等待主持人入会'); }
      if (online(m.id).length >= m.maxParticipants) fail(409, '会议人数已满');
      s.participants.push({ id: randomUUID(), meetingId: m.id, userId: u.id, nickname: text(req.body.nickname || u.nickname, 30), isHost: u.id === m.hostId, audioOff: m.defaultMute || req.body.audioOff !== false, videoOff: req.body.videoOff !== false, screenShare: false, joinTime: new Date().toISOString(), leaveTime: null });
      m.status = 'ongoing';
      const key = `${m.id}:${u.id}`; clearTimeout(timers.get(key)); timers.set(key, setTimeout(() => { timers.delete(key); if (!io.sockets.adapter.rooms.get(key)?.size) void runInRoom(m.id, () => leave(m.id, u.id, 'no_socket')).catch(console.error); }, 30000));
      await db.save(); snapshot(m.id);
    }
    return { meeting: publicMeeting(m), participant: member(m.id, u), token: jwt.sign({ sub: u.id, scope: 'room', meetingId: m.id, membership: member(m.id, u).id }, secret, { expiresIn: '12h' }), iceServers: iceConfig(u.id), signalingUrl: process.env.APP_ORIGIN || 'http://localhost:5173', sfu: { protocol: 'mediasoup', signalingPath: '/socket.io' } };
  }));
  app.post('/api/meetings/:id/leave', wrap(async req => { member(req.params.id, req.user); await leave(req.params.id, req.user.id); return {}; }));
  app.put('/api/meetings/:id/end', wrap(async req => { const m = meeting(req.params.id); host(m, req.user); await end(m, req.user); return {}; }));
  app.delete('/api/meetings/:id', wrap(async req => { const m = meeting(req.params.id); host(m, req.user); if (m.status === 'ongoing') fail(409, '请先结束会议'); m.status = 'ended'; m.endedAt = new Date().toISOString(); audit(req.user, 'cancel', m.id); await db.save(); return {}; }));
  app.get('/api/meetings/:id/participants', wrap(req => { member(req.params.id, req.user); return online(req.params.id); }));
  app.put('/api/meetings/:id/participant/mute', wrap(async req => { await mute(meeting(req.params.id), req.user, req.body); return {}; }));
  app.put('/api/meetings/:id/host', wrap(async req => {
    const m = meeting(req.params.id); host(m, req.user);
    const target = online(m.id).find(p => p.userId === req.body.userId && p.userId !== req.user.id);
    if (!target) fail(400, '请选择当前在线的其他参会人');
    m.hostId = target.userId; m.hostName = target.nickname;
    for (const p of online(m.id)) p.isHost = p.userId === target.userId;
    audit(req.user, 'transfer_host', m.id, target.userId);
    await db.save(); snapshot(m.id);
    return publicMeeting(m);
  }));
  app.delete('/api/meetings/:id/participant/:userId', wrap(async req => { const m = meeting(req.params.id); host(m, req.user); if (req.params.userId === m.hostId) fail(400, '不能移除主持人'); m.banned.push(req.params.userId); audit(req.user, 'kick', m.id, req.params.userId); notify(m.id, 'kicked', {}, req.params.userId); await leave(m.id, req.params.userId, 'kicked'); return {}; }));
  for (const [route, field] of [['lock', 'locked'], ['chat', 'chatClosed']]) app.put(`/api/meetings/:id/${route}`, wrap(async req => { const m = meeting(req.params.id); host(m, req.user); if (typeof req.body[field] !== 'boolean') fail(400, '状态必须为布尔值'); m[field] = req.body[field]; audit(req.user, route, m.id, String(m[field])); await db.save(); snapshot(m.id); return publicMeeting(m); }));
  app.get('/api/meetings/:id/chat', wrap(req => { member(req.params.id, req.user); return s.chats.filter(c => c.meetingId === req.params.id).slice(-200); }));
  app.post('/api/meetings/:id/chat/send', wrap(req => sendChat(req.params.id, req.user, req.body.content)));
  app.use('/api/admin', (req, _, next) => { try { if (req.user.role !== 'admin') fail(403, '仅管理员可访问'); next(); } catch (e) { next(e); } });
  app.get('/api/admin/overview', wrap(() => ({ users: s.users.map(userPublic), meetings: s.meetings.map(publicMeeting), participants: s.participants, audit: s.audit.slice(-500).reverse(), concurrent: s.participants.filter(p => !p.leaveTime).length, sockets: io.engine.clientsCount })));
  app.post('/api/admin/users', wrap(async req => {
    const phone = text(req.body.phone, 30), nickname = text(req.body.nickname, 30), password = text(req.body.password, 200);
    if (!/^\d{11}$/.test(phone) || password.length < 8) fail(400, '手机号应为11位数字，密码至少8位');
    if (s.users.some(u => u.phone === phone)) fail(409, '手机号已存在');
    const u = { id: randomUUID(), phone, nickname, password: hash(password), isGuest: false, role: 'user', createdAt: new Date().toISOString() };
    s.users.push(u); audit(req.user, 'create_user', '', u.id); await db.save(); return userPublic(u);
  }));
  app.put('/api/admin/users/:id', wrap(async req => { const u = s.users.find(u => u.id === req.params.id); if (!u || u.role === 'admin') fail(400, '不能修改此用户'); u.disabled = !!req.body.disabled; if (u.disabled) for (const p of s.participants.filter(p => p.userId === u.id && !p.leaveTime)) await leave(p.meetingId, u.id, 'disabled'); audit(req.user, 'disable_user', '', u.id); await db.save(); return userPublic(u); }));
  app.put('/api/admin/meetings/:id/end', wrap(async req => { await end(meeting(req.params.id), req.user); return {}; }));
  const timers = new Map(); let shuttingDown = false;
  const roomQueues = new Map();
  function runInRoom(id, task) { const next = (roomQueues.get(id) || Promise.resolve()).catch(() => {}).then(task); roomQueues.set(id, next); void next.finally(() => { if (roomQueues.get(id) === next) roomQueues.delete(id); }).catch(() => {}); return next; }
  io.use((socket, next) => { try {
    const claim = jwt.verify(socket.handshake.auth.token, secret), u = s.users.find(u => u.id === claim.sub);
    if (claim.scope !== 'room' || !u || u.disabled) fail(401, '无效入会凭证');
    const p = member(claim.meetingId, u); if (p.id !== claim.membership || meeting(claim.meetingId).status === 'ended') fail(403, '入会凭证失效');
    socket.data = { user: u, meetingId: claim.meetingId }; next();
  } catch (e) { next(Error(e.message)); } });
  io.on('connection', socket => {
    const { user: u, meetingId: id } = socket.data, key = `${id}:${u.id}`;
    clearTimeout(timers.get(key)); timers.delete(key);
    const ready = runInRoom(id, async () => {
      const previousSockets = await io.in(key).fetchSockets();
      for (const previous of previousSockets) {
        previous.data.leaving = true;
        previous.emit('session_replaced');
        previous.disconnect(true);
      }
      console.info('signaling session connected', { meetingId: id, userId: u.id, socketId: socket.id, replacedSessions: previousSockets.length });
      await sfu.leave(id, u.id);
      if (!socket.connected) return;
      member(id, u).screenShare = false;
      socket.join(id); socket.join(key); snapshot(id);
    });
    void ready.catch(e => { console.error(e); socket.disconnect(true); });
    let count = 0, windowStart = Date.now();
    socket.on('request', async ({ type, payload = {} } = {}, ack = () => {}) => {
      if (Date.now() - windowStart > 10000) { count = 0; windowStart = Date.now(); }
      if (++count > 200) { ack({ error: '请求过于频繁' }); return; }
      await runInRoom(id, async () => {
      try {
        if (!socket.connected) fail(403, '连接已关闭');
        if (Date.now() - windowStart > 10000) { count = 0; windowStart = Date.now(); }

        const p = member(id, u), m = meeting(id); if (m.status === 'ended' || u.disabled) fail(403, '会议不可用');
        let data = {};
        if (type === 'sfu') {
          // SFU ICE candidates must advertise an address reachable from the
          // browser that opened this signaling connection. Localhost clients
          // cannot use the LAN address, while LAN clients cannot use 127.0.0.1.
          if (payload.method === 'createTransport') {
            const requested = String(socket.handshake.auth?.announcedIp || '').trim().split(':')[0].toLowerCase();
            const configured = String(process.env.RTC_ANNOUNCED_IP || '').trim();
            const validIp = value => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(part => Number(part) <= 255);
            // A reverse tunnel hostname cannot carry mediasoup UDP. Never
            // advertise it as an ICE address; use the configured public IP.
            const privateIp = value => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
            // A private client address is authoritative for LAN sessions. This
            // prevents a stale DHCP address in .env from breaking ICE after a
            // laptop changes networks. Keep a configured public address for
            // internet deployments where the browser cannot advertise it.
            const announcedIp = validIp(requested) && privateIp(requested)
              ? requested
              : (validIp(configured) ? configured : (validIp(requested) ? requested : '127.0.0.1'));
            if (!announcedIp) fail(503, '未配置 RTC_ANNOUNCED_IP；内网穿透需同时配置公网媒体地址或 TURN');
            payload.data = { ...payload.data, announcedIp };
          }
          if (payload.method === 'produce') {
            if ((payload.data.source === 'audio' && p.audioOff) || (payload.data.source === 'video' && p.videoOff)) fail(403, '请先开启媒体');
            if (payload.data.source === 'screen' && online(id).some(v => v.screenShare && v.userId !== u.id)) fail(409, '已有参会人共享屏幕');
          }
          data = await sfu.request(id, u.id, payload.method, payload.data);
          if (payload.method === 'produce' && ((payload.data.source === 'audio' && p.audioOff) || (payload.data.source === 'video' && p.videoOff))) await sfu.pause(id, u.id, payload.data.source);
          if (payload.method === 'produce' && payload.data.source === 'screen') { p.screenShare = true; snapshot(id); }
          if (payload.method === 'closeProducer' && data.source === 'screen') { p.screenShare = false; snapshot(id); }
          if (payload.method === 'closeTransport' && payload.data.direction === 'send' && p.screenShare) { p.screenShare = false; await db.save(); snapshot(id); }
        } else if (type === 'media_state') {
          for (const kind of ['audio', 'video']) if (typeof payload[kind + 'Off'] === 'boolean') { p[kind + 'Off'] = payload[kind + 'Off']; await sfu[p[kind + 'Off'] ? 'pause' : 'resume'](id, u.id, kind); }
          snapshot(id);
        } else if (type === 'chat') data = await sendChat(id, u, payload.content);
        else if (type === 'state') data = { meeting: publicMeeting(m), participants: online(id), messages: s.chats.filter(c => c.meetingId === id).slice(-200) };
        else if (type === 'switch_layout') { if (!['gallery', 'speaker'].includes(payload.layout)) fail(400, '布局无效'); data = { layout: payload.layout }; }
        else fail(400, '未知信令');
        ack({ data });
      } catch (e) { ack({ error: e.message }); }
      });
    });
    socket.on('disconnect', reason => {
      console.info('signaling session disconnected', { meetingId: id, userId: u.id, socketId: socket.id, reason, replaced: !!socket.data.leaving });
      if (shuttingDown || socket.data.leaving) return;
      if (io.sockets.adapter.rooms.get(key)?.size) return;
      timers.set(key, setTimeout(() => { timers.delete(key); void runInRoom(id, () => leave(id, u.id, 'timeout')).catch(console.error); }, 30000));
    });
  });
  app.use('/api', (_, res) => res.status(404).json({ message: '接口不存在' }));
  app.use(express.static(resolve('dist'))); app.get('/{*path}', (_, res) => res.sendFile(resolve('dist/index.html')));
  app.use((e, _, res, __) => { if (!e.status) console.error(e); res.status(e.status || 500).json({ code: e.status || 500, message: e.status ? e.message : '服务暂时不可用' }); });
  await new Promise((resolve,reject) => { http.once('error',reject); http.listen(port, '0.0.0.0', resolve); });
  const address = http.address(); console.log(`Meeting API + signaling + SFU: http://localhost:${address.port}`);
  return { port: address.port, async close() { shuttingDown = true; for (const t of timers.values()) clearTimeout(t); sfu.close(); await new Promise(r => io.close(r)); await db.close(); } };
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) startServer().catch(e => { console.error(e); process.exit(1); });
