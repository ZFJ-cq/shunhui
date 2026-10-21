/** Build a link that recipients can open from another device on the network. */
export function inviteUrl(meetingId: string): string {
  const configuredOrigin = import.meta.env.VITE_PUBLIC_ORIGIN?.trim()
  const hostname = window.location.hostname
  const origin = configuredOrigin
    ? configuredOrigin.replace(/\/$/, '')
    : ['localhost', '127.0.0.1', '::1'].includes(hostname) && import.meta.env.VITE_LAN_HOST
      ? `${window.location.protocol}//${import.meta.env.VITE_LAN_HOST}${window.location.port ? `:${window.location.port}` : ''}`
      : window.location.origin
  return `${origin}/m/${encodeURIComponent(meetingId)}`
}
