import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { createSfu } from '../server/sfu.mjs';
import { startServer } from '../server/index.mjs';
import { MAX_PARTICIPANTS, MAX_ROOM_MEDIA_STREAMS } from '../shared/meeting-limits.js';

function createFakeMediasoup() {
  let nextTransport = 0, nextProducer = 0;
  const worker = new EventEmitter();
  worker.close = () => {};
  worker.createRouter = async () => {
    const router = {
      rtpCapabilities: { codecs: [] },
      createAudioLevelObserver: async () => Object.assign(new EventEmitter(), { addProducer: async () => {} }),
      createWebRtcTransport: async ({ appData }) => {
        const observer = new EventEmitter(), events = new EventEmitter();
        return Object.assign(events, {
          id: `transport-${++nextTransport}`,
          appData,
          observer,
          iceParameters: {},
          iceCandidates: [],
          dtlsParameters: {},
          setMaxIncomingBitrate: async () => {},
          setMaxOutgoingBitrate: async () => {},
          produce: async ({ kind, appData: producerData }) => Object.assign(new EventEmitter(), {
            id: `producer-${++nextProducer}`,
            kind,
            appData: producerData,
            rtpParameters: { encodings: [] },
            close() {},
            pause: async () => {},
            resume: async () => {},
          }),
          close() { observer.emit('close'); events.emit('close'); },
        });
      },
      canConsume: () => true,
      close() {},
    };
    return router;
  };
  return { createWorker: async () => worker };
}

test('25 participants can publish audio, camera, and screen simultaneously', async () => {
  const previous = process.env.ROOM_MAX_MEDIA_STREAMS;
  process.env.ROOM_MAX_MEDIA_STREAMS = String(MAX_ROOM_MEDIA_STREAMS);
  const sfu = await createSfu(() => {}, { mediasoupImpl: createFakeMediasoup() });
  const meetingId = 'capacity-room';
  const users = Array.from({ length: MAX_PARTICIPANTS }, (_, index) => `user-${index + 1}`);
  const sources = [
    { source: 'audio', kind: 'audio' },
    { source: 'video', kind: 'video' },
    { source: 'screen', kind: 'video' },
  ];
  try {
    const transports = await Promise.all(users.map(async userId => ({
      userId,
      ...(await sfu.request(meetingId, userId, 'createTransport', { direction: 'send' })),
    })));
    const published = await Promise.all(transports.flatMap(({ userId, id: transportId }) => sources.map(async media => ({
      userId,
      ...media,
      ...(await sfu.request(meetingId, userId, 'produce', { transportId, ...media, rtpParameters: {} })),
    }))));
    assert.equal(published.length, MAX_ROOM_MEDIA_STREAMS);

    const overflowUser = 'user-overflow';
    const overflowTransport = await sfu.request(meetingId, overflowUser, 'createTransport', { direction: 'send' });
    await assert.rejects(
      sfu.request(meetingId, overflowUser, 'produce', { transportId: overflowTransport.id, ...sources[0], rtpParameters: {} }),
      /房间已达到媒体流上限/,
    );

    await sfu.request(meetingId, users[0], 'closeProducer', { producerId: published.find(item => item.userId === users[0] && item.source === 'screen').id });
    await sfu.request(meetingId, overflowUser, 'produce', { transportId: overflowTransport.id, ...sources[0], rtpParameters: {} });
  } finally {
    sfu.close();
    if (previous === undefined) delete process.env.ROOM_MAX_MEDIA_STREAMS;
    else process.env.ROOM_MAX_MEDIA_STREAMS = previous;
  }
});

test('SFU refuses a configured media stream ceiling below the 25-person requirement', async () => {
  const previous = process.env.ROOM_MAX_MEDIA_STREAMS;
  process.env.ROOM_MAX_MEDIA_STREAMS = String(MAX_ROOM_MEDIA_STREAMS - 1);
  try {
    await assert.rejects(createSfu(() => {}, { mediasoupImpl: createFakeMediasoup() }), /at least 75/);
  } finally {
    if (previous === undefined) delete process.env.ROOM_MAX_MEDIA_STREAMS;
    else process.env.ROOM_MAX_MEDIA_STREAMS = previous;
  }
});

test('25 account logins, 25 guest joins, and a same-room API burst fit within limits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shunhui-capacity-'));
  const keys = ['DB_FILE', 'DATABASE_URL', 'TRUST_PROXY_HOPS', 'ADMIN_PHONE', 'ADMIN_PASSWORD', 'TURN_ENABLED', 'TURN_URLS', 'TURN_TCP_URL', 'TURN_SECRET', 'STUN_URLS', 'ICE_SERVERS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DB_FILE = join(dir, 'db.sqlite');
  delete process.env.DATABASE_URL;
  process.env.TRUST_PROXY_HOPS = '1';
  process.env.ADMIN_PHONE = '13800138000';
  process.env.ADMIN_PASSWORD = 'test-admin-password-123';
  process.env.TURN_ENABLED = 'false';
  process.env.TURN_URLS = '';
  process.env.TURN_TCP_URL = '';
  process.env.TURN_SECRET = '';
  process.env.STUN_URLS = '';
  process.env.ICE_SERVERS = '[]';
  const fakeSfu = {
    request: async (_meetingId, _userId, method, data) => method === 'closeProducer' ? { source: data.source } : {},
    leave: async () => {}, pause: async () => {}, resume: async () => {}, close: () => {},
  };
  let server;
  const sockets = [];
  try {
    server = await startServer(0, { sfu: fakeSfu });
    const base = `http://127.0.0.1:${server.port}`;
    const call = async (path, token, method = 'GET', body, forwardedFor = '198.51.100.25') => {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`,
          'X-Forwarded-For': forwardedFor,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, ...(await response.json()) };
    };

    const admin = await call('/user/login', '', 'POST', { phone: process.env.ADMIN_PHONE, password: process.env.ADMIN_PASSWORD });
    assert.equal(admin.status, 200);
    const accounts = [];
    for (let index = 0; index < MAX_PARTICIPANTS; index++) {
      const phone = `1390000${String(index).padStart(4, '0')}`;
      const result = await call('/admin/users', admin.data.token, 'POST', { phone, nickname: `账号${index + 1}`, password: 'test-user-password-123' });
      assert.equal(result.status, 200);
      accounts.push({ phone, password: 'test-user-password-123' });
    }
    const accountLogins = await Promise.all(accounts.map(account => call('/user/login', '', 'POST', account)));
    assert.ok(accountLogins.every(result => result.status === 200), `login statuses: ${accountLogins.map(result => result.status).join(',')}`);

    const guests = await Promise.all(Array.from({ length: MAX_PARTICIPANTS }, (_, index) => call('/user/guest-login', '', 'POST', { nickname: `游客${index + 1}` })));
    assert.ok(guests.every(result => result.status === 200), `guest login statuses: ${guests.map(result => result.status).join(',')}`);
    const hostToken = guests[0].data.token;
    const meeting = await call('/meetings/create', hostToken, 'POST', { title: '25人并发入会验收', maxParticipants: MAX_PARTICIPANTS, defaultMute: false });
    assert.equal(meeting.status, 200);
    const joins = await Promise.all(guests.map(guest => call(`/meetings/${meeting.data.id}/join`, guest.data.token, 'POST', { nickname: guest.data.user.nickname, audioOff: false, videoOff: false })));
    assert.ok(joins.every(result => result.status === 200), `join statuses: ${joins.map(result => result.status).join(',')}`);
    assert.equal((await call(`/meetings/${meeting.data.id}/participants`, hostToken)).data.length, MAX_PARTICIPANTS);

    const connect = token => new Promise((resolve, reject) => {
      const socket = io(base, { auth: { token }, reconnection: false });
      sockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
    const clients = await Promise.all(joins.map(join => connect(join.data.token)));
    const signal = (socket, source, kind) => new Promise(resolve => {
      socket.emit('request', { type: 'sfu', payload: { method: 'produce', data: { source, kind, rtpParameters: {} } } }, resolve);
    });
    const audioVideo = await Promise.all(clients.flatMap(socket => [signal(socket, 'audio', 'audio'), signal(socket, 'video', 'video')]));
    assert.ok(audioVideo.every(result => !result.error), 'all 25 users should publish audio and video');
    const shares = await Promise.all(clients.map(socket => signal(socket, 'screen', 'video')));
    assert.equal(shares.filter(result => !result.error).length, 1, 'one room-wide screen share is allowed at a time');
    assert.equal(shares.filter(result => result.error).length, MAX_PARTICIPANTS - 1);

    const extraGuest = await call('/user/guest-login', '', 'POST', { nickname: '第26人' });
    assert.equal(extraGuest.status, 200);
    assert.equal((await call(`/meetings/${meeting.data.id}/join`, extraGuest.data.token, 'POST', { nickname: '第26人' })).status, 409);
    const burst = await Promise.all(Array.from({ length: 100 }, () => call(`/meetings/${meeting.data.id}`, hostToken)));
    assert.ok(burst.every(result => result.status === 200), `API burst statuses: ${burst.map(result => result.status).join(',')}`);
  } finally {
    sockets.forEach(socket => socket.disconnect());
    await server?.close();
    await rm(dir, { recursive: true, force: true });
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('login rate limit uses the configured trusted proxy client address', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shunhui-proxy-limit-'));
  const keys = ['DB_FILE', 'DATABASE_URL', 'TRUST_PROXY_HOPS', 'TURN_ENABLED', 'TURN_URLS', 'TURN_TCP_URL', 'TURN_SECRET', 'STUN_URLS', 'ICE_SERVERS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DB_FILE = join(dir, 'db.sqlite');
  delete process.env.DATABASE_URL;
  process.env.TRUST_PROXY_HOPS = '1';
  process.env.TURN_ENABLED = 'false';
  process.env.TURN_URLS = '';
  process.env.TURN_TCP_URL = '';
  process.env.TURN_SECRET = '';
  process.env.STUN_URLS = '';
  process.env.ICE_SERVERS = '[]';
  const fakeSfu = { request: async () => ({}), leave: async () => {}, pause: async () => {}, resume: async () => {}, close: () => {} };
  let server;
  try {
    server = await startServer(0, { sfu: fakeSfu });
    const base = `http://127.0.0.1:${server.port}`;
    const results = await Promise.all(Array.from({ length: 121 }, (_, index) => fetch(base + '/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${index + 1}` },
      body: JSON.stringify({ phone: `1390000${String(index).padStart(4, '0')}`, password: 'invalid-password' }),
    })));
    assert.ok(results.every(response => response.status === 401), `login statuses: ${results.map(response => response.status).join(',')}`);
  } finally {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
