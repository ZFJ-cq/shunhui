const number = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value
}
export const config = {
  port: number('SFU_PORT', 3001),
  origins: (process.env.ALLOWED_ORIGINS || 'https://localhost:5173,https://127.0.0.1:5173').split(','),
  listenIp: process.env.SFU_LISTEN_IP || '0.0.0.0',
  announcedAddress: process.env.SFU_ANNOUNCED_ADDRESS || '127.0.0.1',
  minPort: number('SFU_MIN_PORT', 40000), maxPort: number('SFU_MAX_PORT', 40199),
  maxStreams: number('ROOM_MAX_STREAMS', 25), maxPeers: number('ROOM_MAX_PEERS', 25),
  maxRooms: number('SFU_MAX_ROOMS', 100),
  incoming: number('PEER_MAX_INCOMING_BITRATE', 1800000),
  outgoing: number('PEER_MAX_OUTGOING_BITRATE', 4000000),
  codecs: [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 600 } },
  ],
}
if (config.maxPort < config.minPort) throw new Error('Invalid media port range')
