<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Check, ChevronDown, Headphones, Mic, MicOff, Monitor, RotateCw, Video, VideoOff, Volume2 } from 'lucide-vue-next'
import { useMeetingStore } from '../stores/meeting'
import { setLocalStream, mediaErrorMessage } from '../services/media'
import { observeMicrophone } from '../services/audio'
import { logger } from '../services/logger'

const router = useRouter()
const store = useMeetingStore()
const videoRef = ref<HTMLVideoElement | null>(null)
const stream = ref<MediaStream | null>(null)
let transferred = false
let disposed = false
let requestGeneration = 0
let disposeMeter: (() => void) | undefined
const microphoneLevel = ref(0)
const speakerSelectionSupported = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype
const devices = ref<MediaDeviceInfo[]>([])
const selectedCamera = ref('')
const selectedMic = ref('')
const selectedSpeaker = ref('')
const audioOff = ref(store.pendingJoin.audioOff)
const videoOff = ref(store.pendingJoin.videoOff)
const loading = ref(false)
const permissionMessage = ref('')
const browserNotice = ref('')
const mediaSupported = Boolean(navigator.mediaDevices?.getUserMedia)
const secureContext = window.isSecureContext
const audioAvailable = ref(false)
const videoAvailable = ref(false)
const cameras = computed(() => devices.value.filter((device) => device.kind === 'videoinput'))
const microphones = computed(() => devices.value.filter((device) => device.kind === 'audioinput'))
const speakers = computed(() => devices.value.filter((device) => device.kind === 'audiooutput'))
const initials = computed(() => (store.pendingJoin.nickname || '我').slice(0, 1))
const permissionGuide = computed(() => permissionMessage.value.includes('权限被拒绝')
  ? '请在浏览器网站设置中允许摄像头和麦克风访问，并确认系统隐私设置未禁止浏览器使用这些设备。'
  : permissionMessage.value.includes('安全连接') ? '请使用 HTTPS 会议地址重新打开此页面。' : '')

function stopTracks(source: MediaStream | null) {
  source?.getTracks().forEach((track) => track.stop())
}

async function requestDevices() {
  if (loading.value) return
  if (!mediaSupported) {
    permissionMessage.value = secureContext ? '当前浏览器无法访问音视频设备，请更新浏览器或检查系统权限。' : '音视频设备需要安全连接。请使用 HTTPS 打开会议页面。'
    return
  }
  loading.value = true
  logger.info('开始检测摄像头和麦克风')
  permissionMessage.value = ''
  try {
    const generation = ++requestGeneration
    const results = await Promise.allSettled([
      navigator.mediaDevices.getUserMedia({ audio: selectedMic.value ? { deviceId: { exact: selectedMic.value } } : true }),
      navigator.mediaDevices.getUserMedia({ video: selectedCamera.value ? { deviceId: { exact: selectedCamera.value } } : true }),
    ])
    const next = new MediaStream(results.flatMap(r => r.status === 'fulfilled' ? r.value.getTracks() : []))
    if (disposed || generation !== requestGeneration) { stopTracks(next); return }
    if (!next.getTracks().length) { const failed = results.find(r => r.status === 'rejected'); throw failed?.status === 'rejected' ? failed.reason : new DOMException('设备不可用', 'NotFoundError') }
    permissionMessage.value = results.flatMap((result, index) => result.status === 'rejected'
      ? [`${index === 0 ? '麦克风' : '摄像头'}：${mediaErrorMessage(result.reason)}`] : []).join(' ')
    stopTracks(stream.value)
    disposeMeter?.()
    stream.value = next
    if (videoRef.value) videoRef.value.srcObject = next
    devices.value = await navigator.mediaDevices.enumerateDevices()
    audioAvailable.value = next.getAudioTracks().length > 0
    videoAvailable.value = next.getVideoTracks().length > 0
    if (audioAvailable.value) disposeMeter = observeMicrophone(next, (level) => { microphoneLevel.value = level })
    if (!selectedCamera.value) selectedCamera.value = next.getVideoTracks()[0]?.getSettings().deviceId || ''
    if (!selectedMic.value) selectedMic.value = next.getAudioTracks()[0]?.getSettings().deviceId || ''
    syncToggleState()
    logger.info('设备检测完成', { audio: audioAvailable.value, video: videoAvailable.value, tracks: next.getTracks().length })
  } catch (error) {
    logger.error('设备检测失败', error)
    permissionMessage.value = mediaErrorMessage(error)
    ElMessage.warning(permissionMessage.value)
  } finally {
    loading.value = false
  }
}

function syncToggleState() {
  stream.value?.getAudioTracks().forEach((track) => { track.enabled = !audioOff.value })
  stream.value?.getVideoTracks().forEach((track) => { track.enabled = !videoOff.value })
}

async function changeDevice(_kind: 'audioinput' | 'videoinput') {
  await requestDevices()
}

async function testSpeaker() {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return ElMessage.info('当前浏览器不支持扬声器测试')
  try {
    const context = new AudioContextClass()
    if (selectedSpeaker.value && 'setSinkId' in context) {
      await (context as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(selectedSpeaker.value)
    }
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 660
    gain.gain.value = 0.04
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.45)
    oscillator.onended = () => void context.close()
    ElMessage.success('正在播放测试音')
  } catch (error) { logger.error('扬声器测试失败', error); ElMessage.warning('扬声器测试失败') }
}

function enterMeeting() {
  if (loading.value) return
  sessionStorage.setItem('shunhui.speaker', selectedSpeaker.value)
  if (stream.value) {
    syncToggleState()
    setLocalStream(stream.value)
    transferred = true
  }
  if (!stream.value?.getAudioTracks().length) audioOff.value = true
  if (!stream.value?.getVideoTracks().length) videoOff.value = true
  store.setJoinOptions({ ...store.pendingJoin, nickname: store.pendingJoin.nickname || store.profileName, audioOff: audioOff.value, videoOff: videoOff.value })
  router.push(`/meeting/${store.pendingJoin.meetingId}`)
}

async function refreshDevices() {
  try { devices.value = await navigator.mediaDevices.enumerateDevices(); logger.debug('已刷新设备列表', { count: devices.value.length }) } catch (error) { logger.error('读取设备列表失败', error); permissionMessage.value = '无法读取设备列表，请检查浏览器权限。' }
}
onMounted(() => {
  if (!store.pendingJoin.meetingId) { void router.replace('/'); return }
  if (/MicroMessenger/i.test(navigator.userAgent)) browserNotice.value = '检测到微信内置浏览器。音视频和屏幕共享能力可能受限，建议复制会议链接后使用 Safari 或 Chrome 打开。'
  // 初始只枚举设备。由用户点击检测按钮请求权限，适配移动 Safari 手势限制。
  if (mediaSupported) { void refreshDevices(); navigator.mediaDevices.addEventListener('devicechange', refreshDevices) }
  else permissionMessage.value = secureContext ? '当前浏览器无法访问音视频设备，请更新浏览器或检查系统权限。' : '音视频设备需要安全连接。请使用 HTTPS 打开会议页面。'
})

onUnmounted(() => {
  navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices)
  disposed = true
  requestGeneration++
  disposeMeter?.()
  if (!transferred) stopTracks(stream.value)
})
</script>

<template>
  <div class="precheck-page"><header class="precheck-header"><RouterLink to="/" class="brand"><span class="brand-mark"><Video :size="19" /></span><span>瞬会</span></RouterLink><div class="precheck-step"><span class="step-complete"><Check :size="13" /></span><b>设备检查</b><i></i><span>加入会议</span></div><button class="plain-icon-button" aria-label="关闭" @click="router.push('/')">×</button></header>
    <main class="precheck-main"><div class="precheck-heading"><div class="eyebrow">入会前准备</div><h1>检查你的设备</h1><p>确认摄像头和麦克风状态，准备好后即可加入会议。</p></div>
      <div class="precheck-layout"><section class="camera-preview" :class="{ 'video-disabled': videoOff || !stream?.getVideoTracks().length }"><video ref="videoRef" autoplay playsinline muted></video><div v-if="videoOff || !stream?.getVideoTracks().length" class="preview-placeholder"><div class="avatar preview-avatar">{{ initials }}</div><span>{{ videoOff ? '摄像头已关闭' : '等待摄像头画面' }}</span></div><div class="preview-label"><span class="green-dot"></span> 本地预览</div><div class="preview-controls"><button :class="{ off: audioOff }" :aria-label="audioOff ? '开启麦克风' : '关闭麦克风'" @click="audioOff = !audioOff; syncToggleState()"> <Mic v-if="!audioOff" :size="17" /><MicOff v-else :size="17" /></button><button :class="{ off: videoOff }" :aria-label="videoOff ? '开启摄像头' : '关闭摄像头'" @click="videoOff = !videoOff; syncToggleState()"><Video v-if="!videoOff" :size="17" /><VideoOff v-else :size="17" /></button></div></section>
        <section class="device-settings"><div class="device-card"><div class="device-heading"><span class="device-icon mic-device"><Mic :size="18" /></span><div><b>麦克风</b><small>{{ audioAvailable ? '设备已就绪' : '尚未检测到设备' }}</small></div><span class="device-status" :class="{ inactive: audioOff || !audioAvailable }"><i></i>{{ !audioAvailable ? '不可用' : audioOff ? '静音' : '正常' }}</span></div><label class="select-wrap device-select"><select v-model="selectedMic" @change="changeDevice('audioinput')"><option value="">{{ microphones.length ? '选择麦克风' : '未检测到麦克风' }}</option><option v-for="(device, i) in microphones" :key="device.deviceId" :value="device.deviceId">{{ device.label || `麦克风 ${i + 1}` }}</option></select><ChevronDown :size="15" /></label><div class="mic-level"><span v-for="i in 18" :key="i" :class="{ lit: audioAvailable && !audioOff && i <= Math.ceil(microphoneLevel * 18) }"></span></div></div>
          <div class="device-card"><div class="device-heading"><span class="device-icon camera-device"><Video :size="18" /></span><div><b>摄像头</b><small>{{ videoAvailable ? '实时画面预览中' : '尚未检测到设备' }}</small></div><span class="device-status" :class="{ inactive: videoOff || !videoAvailable }"><i></i>{{ !videoAvailable ? '不可用' : videoOff ? '已关闭' : '正常' }}</span></div><label class="select-wrap device-select"><select v-model="selectedCamera" @change="changeDevice('videoinput')"><option value="">{{ cameras.length ? '选择摄像头' : '未检测到摄像头' }}</option><option v-for="(device, i) in cameras" :key="device.deviceId" :value="device.deviceId">{{ device.label || `摄像头 ${i + 1}` }}</option></select><ChevronDown :size="15" /></label></div>
          <div class="device-card speaker-card"><div class="device-heading"><span class="device-icon speaker-device"><Volume2 :size="18" /></span><div><b>扬声器</b><small>{{ speakerSelectionSupported ? '可选择测试音输出设备' : '当前浏览器使用系统默认输出' }}</small></div><button class="test-speaker" @click="testSpeaker">测试 <Headphones :size="14" /></button></div><label class="select-wrap device-select"><select v-model="selectedSpeaker" :disabled="!speakerSelectionSupported"><option value="">系统默认扬声器</option><option v-for="(device, i) in speakers" :key="device.deviceId" :value="device.deviceId">{{ device.label || `扬声器 ${i + 1}` }}</option></select><ChevronDown :size="15" /></label></div>
          <div v-if="browserNotice" class="permission-note" role="status"><span>i</span>{{ browserNotice }}</div><div v-if="permissionMessage" class="permission-note" role="alert"><span>i</span><div><b>{{ permissionMessage }}</b><small v-if="permissionGuide">{{ permissionGuide }}</small></div><button @click="requestDevices">重新检测</button></div><button class="detect-button" :disabled="loading" @click="requestDevices"><RotateCw :size="15" :class="{ spin: loading }" />{{ loading ? '正在检测设备…' : '重新检测设备' }}</button>
        </section></div>
      <div class="precheck-bottom"><button class="back-link" @click="router.push('/')"><ArrowLeft :size="15" />返回</button><div class="precheck-assurance"><span>🔒</span> 设备仅用于本次会议</div><button class="primary-button enter-button" :disabled="loading" @click="enterMeeting">进入会议 <ArrowLeft class="forward-arrow" :size="16" /></button></div>
      <div class="precheck-hint"><Monitor :size="14" />如无法访问设备，请在浏览器地址栏左侧检查网站权限。移动端浏览器请使用 HTTPS。</div>
    </main>
  </div>
</template>
