<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Copy, Grid2X2, Video, X, RotateCw } from 'lucide-vue-next'
import QRCode from 'qrcode'
import { getLocalStream, stopLocalStream } from '../services/media'
import { useMeetingStore } from '../stores/meeting'
import { createRoom } from '../services/room'
import { api, attempt } from '../services/api'
import { inviteUrl as makeInviteUrl } from '../services/invite'
import MediaTile from '../components/MediaTile.vue'
import VideoCanvas from '../components/VideoCanvas.vue'
import ParticipantList from '../components/ParticipantList.vue'
import ToolBar from '../components/ToolBar.vue'
import ChatPanel from '../components/ChatPanel.vue'
const id = String(useRoute().params.meetingId), router = useRouter(), store = useMeetingStore(), room = createRoom()
const { participants, meeting, messages, remote, status, selfId, activeSpeaker, error, networkQuality } = room
const local = shallowRef(getLocalStream()), screen = shallowRef<MediaStream | null>(null)
const audioOff = ref(store.pendingJoin.audioOff), videoOff = ref(store.pendingJoin.videoOff)
const panels = ref({ people: false, chat: false }), input = ref(''), layout = ref<'gallery' | 'speaker'>('gallery'), qr = ref(''), inviteOpen = ref(false)
const elapsed = ref(0), started = Date.now(); let timer: ReturnType<typeof setInterval>, disposed = false
const isHost = computed(() => participants.value.find(p => p.userId === selfId.value)?.isHost)
const blockedAudio = ref(false), disconnected = ref(false)
const audioTiles = ref<InstanceType<typeof MediaTile>[]>([])
function enableAudio() { blockedAudio.value = false; audioTiles.value.forEach(tile => void tile.play()) }
const speaker = sessionStorage.getItem('shunhui.speaker') || ''
const inviteUrl = makeInviteUrl(id)
const share = computed(() => screen.value ? { stream: screen.value, userId: selfId.value } : [...remote.values()].find(m => m.source === 'screen'))
const networkSummary = computed(() => {
 const q = networkQuality.value
 const kbps = (value: number | null) => value === null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)} Mbps` : `${value} Kbps`
 return `RTT ${q.rttMs === null ? '—' : `${q.rttMs} ms`} · 上行丢包 ${q.sendLossPercent === null ? '—' : `${q.sendLossPercent}%`} · 下行丢包 ${q.receiveLossPercent === null ? '—' : `${q.receiveLossPercent}%`} · ↑ ${kbps(q.sendKbps)} · ↓ ${kbps(q.receiveKbps)}`
})
function media(uid: string, source: string) { return uid === selfId.value ? local.value : [...remote.values()].find(m => m.userId === uid && m.source === source)?.stream }
async function toggle(kind: 'audio' | 'video') {
 if (disconnected.value) return ElMessage.warning('会议连接已中断，请返回首页后重新加入。')
 await attempt(async () => {
  const off = kind === 'audio' ? audioOff : videoOff
  let track = local.value?.getTracks().find(t => t.kind === kind && t.readyState === 'live')
  if (off.value && !track) {
  if (!navigator.mediaDevices?.getUserMedia) throw Error('当前页面无法访问摄像头或麦克风，请使用安全连接后重试。')
   const acquired = await navigator.mediaDevices.getUserMedia({ audio: kind === 'audio', video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false })
   if (disposed) { acquired.getTracks().forEach(t => t.stop()); return }
   track = acquired.getTracks()[0]
   local.value = new MediaStream([...(local.value?.getTracks().filter(t => t.kind !== kind) || []), track!])
  }
  await room.setMedia(kind, !off.value, track); off.value = !off.value
  store.pendingJoin[kind === 'audio' ? 'audioOff' : 'videoOff'] = off.value
 })
}
async function stopShare() { screen.value?.getTracks().forEach(t => t.stop()); screen.value = null; await attempt(() => room.stopScreen()) }
async function shareScreen() {
 if (disconnected.value) return ElMessage.warning('会议连接已中断，请返回首页后重新加入。')
 if (screen.value) return stopShare()
 await attempt(async () => {
  if (share.value) throw Error('已有参会人正在共享屏幕')
  if (!navigator.mediaDevices?.getDisplayMedia) throw Error('当前设备暂不支持屏幕共享，请在电脑浏览器中使用此功能。')
  // Browser picker provides screen, window and tab choices; capture stays in the browser's native flow.
  // 优先排除当前会议标签页，避免“共享会议页面 → 页面显示共享画面”的镜中镜递归。
  // 新版 Chromium 支持这些提示；旧版会忽略未知约束，不影响正常选择窗口/屏幕。
  const next = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: false,
    selfBrowserSurface: 'exclude',
    preferCurrentTab: false,
    surfaceSwitching: 'include',
  } as DisplayMediaStreamOptions)
  if (disposed) { next.getTracks().forEach(t => t.stop()); return }
  next.getVideoTracks()[0].contentHint = 'detail'
  try { await room.publish('screen', next.getVideoTracks()[0]); screen.value = next; next.getVideoTracks()[0]?.addEventListener('ended', () => void stopShare(), { once: true }) } catch (e) { next.getTracks().forEach(t => t.stop()); throw e }
 })
}
async function control(type: string, payload: any) {
 if (type === 'meeting_ended' || type === 'kicked') { ElMessage.warning(type === 'kicked' ? '你已被主持人移出会议' : '会议已结束'); router.replace('/my-meetings') }
 if (type === 'initial_media') { audioOff.value = payload.audioOff; videoOff.value = payload.videoOff }
 if (type === 'host_media') {
  if (payload.mute) { const kind = payload.media as 'audio' | 'video'; const off = kind === 'audio' ? audioOff : videoOff; off.value = true; store.pendingJoin[kind === 'audio' ? 'audioOff' : 'videoOff'] = true; await room.setMedia(kind, true, local.value?.getTracks().find(t => t.kind === kind)); ElMessage.info(`主持人已关闭你的${kind === 'audio' ? '麦克风' : '摄像头'}`) }
  else ElMessage.info(`主持人邀请你开启${payload.media === 'audio' ? '麦克风' : '摄像头'}，请点击底部按钮`)
 }
 if (type === 'reconnecting') { screen.value?.getTracks().forEach(t => t.stop()); screen.value = null }
 // 超出自动恢复范围后停止采集，用户返回入口重新入会。
 if (type === 'disconnected') { disconnected.value = true; screen.value?.getTracks().forEach(t => t.stop()); screen.value = null; local.value?.getTracks().forEach(t => t.stop()); stopLocalStream(); local.value = null; audioOff.value = true; videoOff.value = true; if (!payload?.skipLeave) void room.leave() }
 if (type === 'switch_layout') layout.value = payload.layout
}
async function leave(end = false) {
 if (end) {
  try {
   await ElMessageBox.confirm('结束会议后，所有参会人都会立即离开。确定结束吗？', '结束本场会议', {
    confirmButtonText: '结束会议', cancelButtonText: '继续会议', type: 'warning', distinguishCancelAndClose: true,
   })
  } catch { return }
  if (!await attempt(async () => { await api(`/meetings/${id}/end`, 'PUT'); return true })) return
 }
 await room.leave(); router.push('/my-meetings')
}
async function hostMute(userId: string, kind = 'audio', mute = true) {
 const ok = await attempt(async () => { await api(`/meetings/${id}/participant/mute`, 'PUT', { targetUserId: userId, media: kind, mute }); return true })
 if (ok) ElMessage.success(userId === 'all' ? '已向全体参会人发送静音指令。' : (mute ? '已关闭该参会人的媒体。' : '已向对方发送开启媒体邀请。'))
}
async function transferHost(userId: string) {
 const target = participants.value.find(p => p.userId === userId)?.nickname || '该参会人'
 try { await ElMessageBox.confirm(`转让后，“${target}”将成为主持人，你将失去主持人权限。确定转让吗？`, '转让主持人', { confirmButtonText: '确认转让', cancelButtonText: '暂不转让', type: 'warning' }) } catch { return }
 const ok = await attempt(async () => { await api(`/meetings/${id}/host`, 'PUT', { userId }); return true })
 if (ok) ElMessage.success(`已将主持人转让给“${target}”。`)
}
async function kick(userId: string) {
 const target = participants.value.find(p => p.userId === userId)?.nickname || '该参会人'
 try {
  await ElMessageBox.confirm(`移出后，对方将无法继续参加本场会议。确定移出“${target}”吗？`, '移出参会人', {
   confirmButtonText: '确认移出', cancelButtonText: '暂不移出', type: 'warning',
  })
 } catch { return }
 const ok = await attempt(async () => { await api(`/meetings/${id}/participant/${userId}`, 'DELETE'); return true })
 if (ok) ElMessage.success(`已将“${target}”移出会议。`)
}
async function setting(field: 'locked' | 'chatClosed', value: boolean) {
 const ok = await attempt(async () => { await api(`/meetings/${id}/${field === 'locked' ? 'lock' : 'chat'}`, 'PUT', { [field]: value }); return true })
 if (ok) ElMessage.success(field === 'locked' ? (value ? '会议已锁定，新参会人暂时无法加入。' : '会议已解除锁定。') : (value ? '已关闭全员聊天。' : '已重新开启全员聊天。'))
}
async function togglePanel(which: 'people' | 'chat') {
 const open = which === 'people' ? panels.value.people : panels.value.chat
 const next = !open
 if (window.matchMedia('(max-width: 900px)').matches) panels.value = { people: false, chat: false }
 panels.value[which] = next
}
async function send() { const content = input.value.trim(); if (!content) return; const ok = await attempt(async () => { await room.send(content); return true }); if (ok) input.value = '' }
async function changeLayout() {
 const next = layout.value === 'gallery' ? 'speaker' : 'gallery'
 layout.value = next
}
async function invite() { inviteOpen.value = true; qr.value = await QRCode.toDataURL(inviteUrl, { width: 240, margin: 2 }) }
async function copy() { try { await navigator.clipboard.writeText(inviteUrl); ElMessage.success('邀请链接已复制，可以发送给参会人。') } catch { ElMessage.warning('复制失败，请手动复制下方邀请链接。') } }
onMounted(async () => { timer = setInterval(() => { elapsed.value = Math.floor((Date.now()-started)/1000) }, 1000); await attempt(() => room.connect(store.pendingJoin, local.value, control)) })
onUnmounted(() => { disposed = true; clearInterval(timer); screen.value?.getTracks().forEach(t => t.stop()); local.value?.getTracks().forEach(t => t.stop()); stopLocalStream(); void room.leave() })
</script>
<template>
 <div class="meeting-page"><header class="meeting-header"><div class="meeting-brand"><span class="brand"><Video :size="20" />瞬会</span><div class="meeting-title"><b>{{ meeting?.title || '正在加入会议' }}</b><button @click="invite">会议号 {{ id }} <Copy :size="12" /></button></div></div><div class="meeting-header-right"><span class="meeting-clock">{{ Math.floor(elapsed/60).toString().padStart(2,'0') }}:{{ (elapsed%60).toString().padStart(2,'0') }}</span><span class="network-indicator" :class="{ weak: networkQuality.weak }" :title="networkSummary"><span class="network-dot"></span>{{ networkQuality.weak ? '网络较弱' : '网络正常' }}<small>{{ networkSummary }}</small></span><span class="connection-pill">{{ status }}</span><button class="leave-top" @click="leave()">离开会议</button></div></header>
 <main class="meeting-workspace" :class="{ 'people-open': panels.people, 'chat-open': panels.chat }"><div v-if="panels.people || panels.chat" class="panel-scrim" aria-hidden="true" @click="panels = { people: false, chat: false }"></div><aside v-if="panels.people" class="meeting-panel people-panel"><div class="panel-head"><h2>参会人（{{ participants.length }}）</h2><button class="plain-icon-button" aria-label="关闭参会人列表" @click="panels.people=false"><X :size="18" /></button></div>
 <div v-if="isHost" class="host-controls"><button @click="hostMute('all')">全员静音</button><button @click="setting('locked', !meeting?.locked)">{{ meeting?.locked ? '解除锁定' : '锁定会议' }}</button><button @click="setting('chatClosed', !meeting?.chatClosed)">{{ meeting?.chatClosed ? '开启聊天' : '关闭聊天' }}</button></div><ParticipantList :participants="participants" :is-host="Boolean(isHost)" :self-id="selfId" @mute="hostMute" @kick="kick" @transfer="transferHost" /><div class="panel-bottom"><button class="invite-button" @click="invite">邀请参会</button></div></aside>
 <section class="meeting-stage"><div v-if="disconnected" class="meeting-recovery" role="alert"><b>会议连接已中断</b><span>为保护设备隐私，摄像头、麦克风和屏幕共享已停止。</span><button class="secondary-button" @click="router.push('/precheck')">重新加入会议</button></div><div class="stage-toolbar"><b>{{ participants.length }} 人在会中</b><button v-if="!share" class="layout-button" @click="changeLayout"><Grid2X2 :size="15" />{{ layout === 'gallery' ? '切换演讲者视图' : '切换画廊视图' }}</button></div><p v-if="error && !disconnected" class="permission-note" role="alert">{{ error }}</p>
 <div class="video-stage" :class="{ 'share-layout': share }"><div v-if="networkQuality.weak || status.includes('断开')" class="network-recovery"><span>{{ status.includes('断开') ? '会议连接已中断' : '网络质量较弱' }}</span><button class="secondary-button" @click="status.includes('断开') ? router.push('/precheck') : room.reconnectMedia().catch(e => ElMessage.error(e instanceof Error ? e.message : '重连失败'))"><RotateCw :size="14" />{{ status.includes('断开') ? '重新加入' : '重连媒体' }}</button></div><VideoCanvas :local-screen="screen" :participants="participants" :remote="remote" :self-id="selfId" :layout="layout" :active-speaker="activeSpeaker" :speaker="speaker" :media="media" />
 </div><button v-if="blockedAudio" class="secondary-button" @click="enableAudio">点击开启会议声音</button><div class="remote-audio"><MediaTile ref="audioTiles" @blocked="value => { if (value) blockedAudio = true }" v-for="m in [...remote.values()].filter(v=>v.source==='audio')" :key="m.id" :stream="m.stream" :speaker="speaker" /></div><div class="stage-bottom-note">{{ status }}</div></section>
 <aside v-if="panels.chat" class="meeting-panel chat-panel"><div class="panel-head"><h2>会议聊天</h2><button class="plain-icon-button" aria-label="关闭聊天面板" @click="panels.chat=false"><X :size="18" /></button></div><ChatPanel v-model="input" :messages="messages" :self-id="selfId" :closed="meeting?.chatClosed" @send="send" /></aside></main>
 <ToolBar :audio-off="audioOff" :video-off="videoOff" :sharing="Boolean(screen)" :is-host="Boolean(isHost)" :count="participants.length" :people-open="panels.people" :chat-open="panels.chat" @audio="toggle('audio')" @video="toggle('video')" @share="shareScreen" @people="togglePanel('people')" @chat="togglePanel('chat')" @mute-all="hostMute('all')" @leave="leave()" @end="leave(true)" @invite="invite" />
 <div v-if="inviteOpen" class="dialog-backdrop" @click.self="inviteOpen=false"><section class="panel-card invite-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title"><button class="plain-icon-button" aria-label="关闭邀请窗口" @click="inviteOpen=false">×</button><h2 id="invite-title">邀请参会</h2><p class="invite-copy">将会议号或邀请链接发送给对方，对方即可加入。</p><img v-if="qr" :src="qr" alt="扫描二维码加入会议" /><div class="invite-detail"><span>会议号</span><b>{{ id }}</b></div><div class="invite-detail"><span>入会密码</span><b>请联系会议主持人获取</b></div><div v-if="meeting?.inviteExpiresAt" class="invite-detail"><span>链接有效期</span><b>截至 {{ new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(meeting.inviteExpiresAt)) }}</b></div><p class="invite-url">{{ inviteUrl }}</p><button class="primary-button" @click="copy">复制邀请链接</button></section></div></div>
</template>
