<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { logger } from '../services/logger'
const emit = defineEmits<{ blocked: [value: boolean] }>()
const props = defineProps<{ stream?: MediaStream | null; muted?: boolean; hidden?: boolean; name?: string; speaker?: string; zoom?: number }>()
const video = ref<HTMLVideoElement>()
const blocked = ref(false)
async function sync() {
 if (!video.value) return
 if (video.value.srcObject !== (props.stream || null)) video.value.srcObject = props.stream || null
 if (props.speaker && 'setSinkId' in video.value) await (video.value as HTMLVideoElement & { setSinkId(id: string): Promise<void> }).setSinkId(props.speaker).catch(error => logger.warn('设置扬声器输出设备失败', error))
 if (props.stream) { try { await video.value.play(); blocked.value = false } catch (error) { logger.warn('视频自动播放被浏览器拦截，请点击播放', error); blocked.value = true } finally { emit('blocked', blocked.value) } }
}
function retryPlay() {
 if (!video.value || !props.stream) return
 if (video.value.srcObject !== props.stream) video.value.srcObject = props.stream
 void video.value.play().then(() => { blocked.value = false }).catch(error => { logger.warn('用户手动播放视频失败', error); blocked.value = true }).finally(() => emit('blocked', blocked.value))
}
watch(() => [props.stream, props.speaker], sync)
onMounted(() => {
  sync()
  video.value?.addEventListener('loadedmetadata', retryPlay)
  video.value?.addEventListener('canplay', retryPlay)
})
onBeforeUnmount(() => {
  video.value?.removeEventListener('loadedmetadata', retryPlay)
  video.value?.removeEventListener('canplay', retryPlay)
})
defineExpose({ play: sync })
</script>
<template><video ref="video" autoplay playsinline :muted="muted" :style="{ opacity: hidden ? 0 : 1, transform: zoom && zoom !== 1 ? `scale(${zoom})` : undefined }"></video><button v-if="blocked" class="media-play" @click="sync">点击播放音视频</button><div v-if="hidden || !stream" class="tile-avatar avatar-blue">{{ name?.slice(0, 1) }}</div></template>
