import test from 'node:test'
import assert from 'node:assert/strict'
import { io as makeSocket } from 'socket.io-client'
import WebSocket from 'ws'

const base = process.env.TEST_API || 'http://127.0.0.1:3101/api'
async function api(path, method = 'GET', body, token) {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await response.json()
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(json)}`)
  return json.data
}
function socket(join) {
  return new Promise((resolve, reject) => {
    const client = makeSocket(new URL(base).origin, { path: '/socket.io', transports: ['websocket'], auth: { meetingId: join.meetingInfo.meetingId, token: join.meetingToken }, reconnection: false })
    client.once('connect', () => resolve(client)); client.once('connect_error', reject)
  })
}
function waitMessage(client, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), 2000)
    const listener = (message) => { if (predicate(message)) { clearTimeout(timer); client.off('message', listener); resolve(message) } }
    client.on('message', listener)
  })
}

test('REST authentication, meeting isolation, moderator controls, and both signalling transports', { skip: !process.env.TEST_API }, async () => {
  const host = await api('/user/guest-login', 'POST', { nickname: 'test host' })
  const guest = await api('/user/guest-login', 'POST', { nickname: 'test guest' })
  const unrelated = await api('/user/guest-login', 'POST', { nickname: 'test unrelated' })
  const meeting = await api('/meetings/create', 'POST', { title: 'integration', hostId: host.userId, meetingPassword: '', maxParticipants: 5, defaultMute: false }, host.token)
  const otherMeeting = await api('/meetings/create', 'POST', { title: 'isolation', hostId: unrelated.userId, maxParticipants: 5 }, unrelated.token)
  const hostJoin = await api(`/meetings/${meeting.meetingId}/join`, 'POST', { userId: host.userId, nickname: host.userId.toString() }, host.token)
  const guestJoin = await api(`/meetings/${meeting.meetingId}/join`, 'POST', { userId: guest.userId, nickname: 'guest' }, guest.token)
  const unrelatedJoin = await api(`/meetings/${otherMeeting.meetingId}/join`, 'POST', { userId: unrelated.userId, nickname: 'unrelated' }, unrelated.token)
  const [hostSocket, guestSocket, otherSocket] = await Promise.all([socket(hostJoin), socket(guestJoin), socket(unrelatedJoin)])
  try {
    const direct = waitMessage(guestSocket, (m) => m.type === 'offer')
    const ack = await new Promise((resolve) => hostSocket.emit('message', { type: 'offer', from: host.userId, target: guest.userId, payload: { sdp: 'offer-sdp' } }, resolve))
    assert.equal(ack.code, 0)
    assert.deepEqual(await direct, { type: 'offer', from: host.userId, target: guest.userId, payload: { sdp: 'offer-sdp' } })

    const crossMeeting = waitMessage(otherSocket, (m) => m.type === 'answer').then(() => false, () => true)
    hostSocket.emit('message', { type: 'answer', target: 'all', payload: { sdp: 'private' } })
    assert.equal(await crossMeeting, true)

    const forged = await new Promise((resolve) => hostSocket.emit('message', { type: 'offer', from: unrelated.userId, target: guest.userId, payload: { sdp: 'forged' } }, resolve))
    assert.equal(forged.code, 400)

    const kicked = await api(`/meetings/${meeting.meetingId}/participant/${guest.userId}`, 'DELETE', { hostId: host.userId }, host.token)
    assert.equal(kicked, null)
    const response = await fetch(base + `/meetings/${meeting.meetingId}/participants`, { headers: { authorization: `Bearer ${guest.token}` } })
    assert.equal(response.status, 403)
    await assert.rejects(api(`/meetings/${meeting.meetingId}/end`, 'PUT', { hostId: guest.userId }, guest.token))

    const rawGuest = await api('/user/guest-login', 'POST', { nickname: 'raw ws' })
    // Use the live service instance's existing room protocol for native WebSocket verification.
    const rawJoin = await api(`/meetings/${meeting.meetingId}/join`, 'POST', { userId: rawGuest.userId, nickname: 'raw ws' }, rawGuest.token)
    const rawUrl = new URL(rawJoin.wsSignalingUrl)
    rawUrl.host = new URL(base).host
    const address = rawUrl.toString()
    const native = new WebSocket(address)
    await new Promise((resolve, reject) => { native.once('open', resolve); native.once('error', reject) })
    const relayed = waitMessage(hostSocket, (m) => m.type === 'offer' && m.payload.sdp === 'native-ws-sdp')
    native.send(JSON.stringify({ type: 'offer', from: rawGuest.userId, target: host.userId, payload: { sdp: 'native-ws-sdp' } }))
    assert.equal((await relayed).from, rawGuest.userId)
    native.close()
  } finally { hostSocket.disconnect(); guestSocket.disconnect(); otherSocket.disconnect() }
})
