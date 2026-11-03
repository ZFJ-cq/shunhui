<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { Maximize, Minimize, Minus, Plus, RotateCcw, Mic, MicOff, UsersRound, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import type { RemoteMedia, Participant } from '../services/room'
import MediaTile from './MediaTile.vue'
import { logger } from '../services/logger'
const props = defineProps<{ localScreen?: MediaStream | null; participants: Participant[]; remote: Map<string, RemoteMedia>; selfId: string; layout: string; activeSpeaker: string; speaker: string; media: (uid: string, source: string) => MediaStream | null | undefined }>()
const ordered = computed(() => [...props.participants].sort((a, b) => props.layout === 'speaker' ? Number(b.userId === props.activeSpeaker) - Number(a.userId === props.activeSpeaker) : 0))
const featured = computed(() => ordered.value[0])
const shared = computed(() => props.localScreen ? { stream: props.localScreen, userId: props.selfId } : [...props.remote.values()].find(item => item.source === 'screen'))
const isLocalShare = computed(() => Boolean(props.localScreen))
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const fullscreen = ref(false)
const shareViewport = ref<HTMLElement | null>(null)
const sharedScreen = ref<HTMLElement | null>(null)
const sharePeopleOpen = ref(false)
const isPanning = ref(false)
let resizeObserver: ResizeObserver | null = null
let observedVideo: HTMLVideoElement | null = null
let pointerDrag: { id: number; startX: number; startY: number; panX: number; panY: number } | null = null
function defaultShareZoom() {
  return !isLocalShare.value && window.matchMedia('(min-width: 1200px) and (min-height: 720px)').matches ? 1.2 : 1
}
function changeZoom(delta: number) { zoom.value = Math.min(2.5, Math.max(1, Number((zoom.value + delta).toFixed(1)))) }
function fitScreen() { zoom.value = 1; panX.value = 0; panY.value = 0 }
function clampPan(x: number, y: number) {
  const screen = sharedScreen.value
  const video = screen?.querySelector('video')
  if (!screen || !video?.videoWidth || !video.videoHeight) return { x: 0, y: 0 }

  const width = screen.clientWidth
  const height = screen.clientHeight
  const fitScale = Math.min(width / video.videoWidth, height / video.videoHeight)
  const maxX = Math.max(0, (video.videoWidth * fitScale * zoom.value - width) / 2)
  const maxY = Math.max(0, (video.videoHeight * fitScale * zoom.value - height) / 2)
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  }
}
function constrainPan() {
  const next = clampPan(panX.value, panY.value)
  panX.value = next.x
  panY.value = next.y
}
function syncSharedScreenObserver() {
  resizeObserver?.disconnect()
  observedVideo?.removeEventListener('loadedmetadata', constrainPan)
  observedVideo?.removeEventListener('resize', constrainPan)
  observedVideo = sharedScreen.value?.querySelector('video') ?? null
  if (sharedScreen.value) resizeObserver?.observe(sharedScreen.value)
  observedVideo?.addEventListener('loadedmetadata', constrainPan)
  observedVideo?.addEventListener('resize', constrainPan)
  constrainPan()
}
function startPan(event: PointerEvent) {
  if (zoom.value <= 1 || event.button !== 0) return
  if ((event.target as HTMLElement).closest('button, a, .share-label, .share-shortcut-hint, .landscape-hint')) return
  const target = event.currentTarget as HTMLElement
  pointerDrag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, panX: panX.value, panY: panY.value }
  isPanning.value = true
  target.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function movePan(event: PointerEvent) {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return
  const next = clampPan(pointerDrag.panX + event.clientX - pointerDrag.startX, pointerDrag.panY + event.clientY - pointerDrag.startY)
  panX.value = next.x
  panY.value = next.y
}
function endPan(event: PointerEvent) {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return
  pointerDrag = null
  isPanning.value = false
}
async function exitFullscreenIfOwned() {
  if (document.fullscreenElement && shareViewport.value?.contains(document.fullscreenElement)) {
    try { await document.exitFullscreen() } catch (error) { logger.warn('共享画面退出全屏失败', error) }
  }
}
async function toggleFullscreen() {
  if (!shareViewport.value) return
  if (isLocalShare.value) {
    logger.info('本地共享时跳过全屏，避免捕获当前会议窗口造成镜中镜递归')
    return
  }
  try {
    if (document.fullscreenElement === shareViewport.value) await document.exitFullscreen()
    else await shareViewport.value.requestFullscreen()
  } catch (error) { logger.warn('共享画面全屏操作失败，浏览器可能不允许全屏', error) }
}
function syncFullscreen() {
  fullscreen.value = Boolean(document.fullscreenElement && shareViewport.value?.contains(document.fullscreenElement))
}
function onShareKeydown(event: KeyboardEvent) {
  if (!shared.value || isLocalShare.value || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName || '')) return
  if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(0.25) }
  else if (event.key === '-') { event.preventDefault(); changeZoom(-0.25) }
  else if (event.key === '0') { event.preventDefault(); fitScreen() }
  else if (event.key.toLowerCase() === 'f') { event.preventDefault(); void toggleFullscreen() }
}
watch(() => Boolean(shared.value), (active) => {
  pointerDrag = null
  isPanning.value = false
  if (!active) {
    zoom.value = 1
    panX.value = 0
    panY.value = 0
    void exitFullscreenIfOwned()
    sharePeopleOpen.value = false
  } else {
    zoom.value = defaultShareZoom()
    panX.value = 0
    panY.value = 0
  }
  void nextTick(syncSharedScreenObserver)
})
watch(() => shared.value?.stream, () => {
  pointerDrag = null
  isPanning.value = false
  panX.value = 0
  panY.value = 0
  void nextTick(syncSharedScreenObserver)
})
watch(zoom, constrainPan)
onMounted(() => {
  resizeObserver = new ResizeObserver(constrainPan)
  syncSharedScreenObserver()
  document.addEventListener('fullscreenchange', syncFullscreen)
  document.addEventListener('keydown', onShareKeydown)
})
onActivated(() => document.addEventListener('keydown', onShareKeydown))
onDeactivated(() => document.removeEventListener('keydown', onShareKeydown))
onBeforeUnmount(() => {
  void exitFullscreenIfOwned()
  resizeObserver?.disconnect()
  observedVideo?.removeEventListener('loadedmetadata', constrainPan)
  observedVideo?.removeEventListener('resize', constrainPan)
  document.removeEventListener('fullscreenchange', syncFullscreen)
  document.removeEventListener('keydown', onShareKeydown)
})
</script>
<template>
  <div v-if="shared" ref="shareViewport" class="share-experience" :class="{ fullscreen }">
    <div ref="sharedScreen" class="shared-screen" :class="{ 'is-zoomed': zoom > 1, 'is-panning': isPanning }" @pointerdown="startPan" @pointermove="movePan" @pointerup="endPan" @pointercancel="endPan" @lostpointercapture="endPan"><MediaTile v-if="!isLocalShare" :stream="shared.stream" muted :speaker="speaker" :zoom="zoom" :pan-x="panX" :pan-y="panY" /><div v-else class="local-share-placeholder"><Maximize :size="34" /><strong>正在共享屏幕</strong><span>为避免镜中镜，本机不显示自己的共享画面。其他参会人可以正常观看。</span></div><span class="share-label">{{ participants.find(p => p.userId === shared?.userId)?.nickname || '参会人' }} 正在共享屏幕</span>
      <div v-if="!isLocalShare" class="share-controls" role="toolbar" aria-label="共享画面显示控制"><button title="缩小画面（-）" aria-label="缩小画面" :disabled="zoom <= 1" @click="changeZoom(-0.25)"><Minus :size="16" /></button><span>{{ Math.round(zoom * 100) }}%</span><button title="放大画面（+）" aria-label="放大画面" :disabled="zoom >= 2.5" @click="changeZoom(0.25)"><Plus :size="16" /></button><i></i><button title="适应窗口（0）" aria-label="适应窗口" @click="fitScreen"><RotateCcw :size="16" /></button><button :title="fullscreen ? '退出全屏（F）' : '全屏显示（F）'" :aria-label="fullscreen ? '退出全屏' : '全屏显示'" @click="toggleFullscreen"><Minimize v-if="fullscreen" :size="16" /><Maximize v-else :size="16" /></button></div>
      <span v-if="!isLocalShare" class="share-shortcut-hint">放大后按住画面拖动 · + / - 缩放 · 0 适应 · F 全屏</span><span v-if="!isLocalShare" class="landscape-hint">放大后可拖动画面 · 横屏观看内容更大</span>
    </div>
    <aside class="share-people-drawer" :class="{ open: sharePeopleOpen }" aria-label="共享期间参会人">
      <button class="share-people-toggle" :aria-expanded="sharePeopleOpen" :aria-label="sharePeopleOpen ? '收起参会人视频' : `展开参会人视频，共${participants.length}人`" @click="sharePeopleOpen = !sharePeopleOpen">
        <UsersRound :size="17" /><span>{{ participants.length }}</span><ChevronRight v-if="sharePeopleOpen" :size="15" /><ChevronLeft v-else :size="15" />
      </button>
      <div v-if="sharePeopleOpen" class="share-people-list">
        <article v-for="p in ordered" :key="p.userId" class="video-tile share-people-tile" :class="{ speaking: p.userId === activeSpeaker }">
          <MediaTile :stream="media(p.userId,'video')" muted :hidden="p.videoOff" :name="p.nickname" />
          <div class="tile-label"><span>{{ p.nickname }}<em>{{ p.userId === activeSpeaker ? ' · 正在发言' : '' }}</em></span><MicOff v-if="p.audioOff" :size="13" /></div>
        </article>
      </div>
    </aside>
  </div>
  <div v-if="!shared && layout === 'speaker' && featured" class="speaker-stage">
    <article class="video-tile main-speaker" :class="{ speaking: featured.userId === activeSpeaker }"><MediaTile :stream="media(featured.userId,'video')" muted :hidden="featured.videoOff" :name="featured.nickname" /><div class="tile-label"><span>{{ featured.nickname }} <em>{{ featured.userId === selfId ? '我' : '' }}{{ featured.isHost ? ' · 主持人' : '' }}{{ featured.userId === activeSpeaker ? ' · 正在发言' : '' }}</em></span><MicOff v-if="featured.audioOff" :size="15" /><Mic v-else :size="15" /></div></article>
    <div class="speaker-strip" aria-label="其他参会人">
      <article v-for="p in ordered.slice(1)" :key="p.userId" class="video-tile speaker-thumb" :class="{ speaking: p.userId === activeSpeaker }"><MediaTile :stream="media(p.userId,'video')" muted :hidden="p.videoOff" :name="p.nickname" /><div class="tile-label"><span>{{ p.nickname }}<em>{{ p.userId === activeSpeaker ? ' · 正在发言' : '' }}</em></span><MicOff v-if="p.audioOff" :size="13" /></div></article>
    </div>
  </div>
  <div v-else-if="!shared" class="video-grid" :class="`participants-${Math.min(9, ordered.length)}`">
    <article v-for="(p,index) in ordered" :key="p.userId" class="video-tile" :class="{ speaking: p.userId === activeSpeaker, 'main-speaker': layout === 'speaker' && index === 0 }"><MediaTile :stream="media(p.userId,'video')" :muted="true" :hidden="p.videoOff" :name="p.nickname" /><div class="tile-label"><span>{{ p.nickname }} <em>{{ p.userId === selfId ? '我' : '' }}{{ p.isHost ? ' · 主持人' : '' }}</em></span><MicOff v-if="p.audioOff" :size="15" /><Mic v-else :size="15" /></div></article>
  </div>
</template>
