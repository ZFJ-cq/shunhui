import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk'
import { config } from '../config.js'
import { HttpError } from '../errors.js'
import { log } from '../logger.js'
import { participant } from '../repositories/meetings.js'

const enabled = () => !!(config.livekit.url && config.livekit.key && config.livekit.secret)
const client = () => new RoomServiceClient(config.livekit.url.replace(/^ws/, 'http'), config.livekit.key, config.livekit.secret)
const allowedSources = (p) => [!p.audio_forced && TrackSource.MICROPHONE, !p.video_forced && TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO].filter((x) => x !== false)

export async function sfuToken(id, user) {
  if (!enabled()) throw new HttpError(503, 'SFU 服务尚未配置')
  const p = await participant(id, user.id)
  if (!p?.joined_at || p.left_at || p.kicked || p.waiting) throw new HttpError(403, '请先入会')
  const token = new AccessToken(config.livekit.key, config.livekit.secret, { identity: String(user.id), name: p.nickname, ttl: '60s' })
  token.addGrant({ roomJoin: true, room: id, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: allowedSources(p) })
  return { sfuUrl: config.livekit.url, sfuToken: await token.toJwt(), expiresIn: 60 }
}
// DB remains the source of truth. Failed media commands surface as 503 and can be retried.
async function command(action) {
  if (!enabled()) return
  try { return await action(client()) }
  catch (error) {
    if (error.code === 'not_found' || error.status === 404) return
    log('error', 'SFU command failed', { error: error.message })
    throw new HttpError(503, 'SFU 控制失败，请重试')
  }
}
export async function enforceMedia(id) {
  return command(async (api) => {
    const connected = await api.listParticipants(id)
    for (const remote of connected) {
      const local = await participant(id, Number(remote.identity))
      if (!local || local.left_at || local.kicked) { await api.removeParticipant(id, remote.identity); continue }
      await api.updateParticipant(id, remote.identity, { permission: { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: allowedSources(local) } })
      for (const track of remote.tracks || []) {
        if ((track.source === TrackSource.MICROPHONE && local.audio_forced) || (track.source === TrackSource.CAMERA && local.video_forced)) await api.mutePublishedTrack(id, remote.identity, track.sid, true)
      }
    }
  })
}
export async function removeMediaParticipant(id, userId) { return command((api) => api.removeParticipant(id, String(userId))) }
export async function deleteMediaRoom(id) { return command((api) => api.deleteRoom(id)) }
