import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { existsSync, readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

const localCert = resolve('deploy/certs/lan-cert.pem')
const localKey = resolve('deploy/certs/lan-key.pem')
const certificate = process.env.HTTPS_CERT || (existsSync(localCert) ? localCert : undefined)
const privateKey = process.env.HTTPS_KEY || (existsSync(localKey) ? localKey : undefined)
// HTTP remains convenient for local development; dev:https opts into the
// bundled certificate for LAN devices and secure-context browser APIs.
const useHttps = process.env.VITE_HTTPS === '1'
if (useHttps && (!certificate || !privateKey)) {
  throw new Error('HTTPS requires HTTPS_CERT/HTTPS_KEY or deploy/certs/lan-cert.pem and lan-key.pem')
}
const https = useHttps && certificate && privateKey
  ? { cert: readFileSync(certificate), key: readFileSync(privateKey) }
  : undefined
const tls = https ? { https } : {}
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:33101'
const proxy = { '/api': proxyTarget, '/socket.io': { target: proxyTarget, ws: true } }
const port = Number(process.env.VITE_PORT || 5173)
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || 'localhost,127.0.0.1,fujian2.pineapple-pie.xyz')
  .split(',').map(value => value.trim()).filter(Boolean)
const privateIpv4 = (address: string) => address.startsWith('10.') || address.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
const lanCandidates = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses || []).filter(address => address.family === 'IPv4' && !address.internal && privateIpv4(address.address))
    .map(address => ({ name, address: address.address })),
).sort((a, b) => Number(b.name === 'en0') - Number(a.name === 'en0'))
const lanHost = process.env.VITE_LAN_HOST || lanCandidates[0]?.address || ''

export default defineConfig({
  plugins: [vue()],
  define: { 'import.meta.env.VITE_LAN_HOST': JSON.stringify(lanHost) },
  preview: { host: '0.0.0.0', port: Number(process.env.VITE_PREVIEW_PORT || 5443), ...tls, proxy },
  server: { host: '0.0.0.0', port, strictPort: true, allowedHosts, ...tls, proxy },
})
