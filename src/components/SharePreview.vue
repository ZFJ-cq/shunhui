<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Move, MonitorOff, X } from 'lucide-vue-next'
import MediaTile from './MediaTile.vue'

const props = defineProps<{ stream: MediaStream | null; disconnected: boolean }>()
const previewOpen = ref(false)
const previewDragging = ref(false)
const previewWindow = ref<HTMLElement | null>(null)
const previewPosition = ref({ x: 0, y: 0 })
let previewPointer: { id: number; startX: number; startY: number; x: number; y: number } | null = null
const previewStyle = computed(() => ({ left: `${previewPosition.value.x}px`, top: `${previewPosition.value.y}px` }))

function constrainPosition(x: number, y: number) {
  const width = previewWindow.value?.offsetWidth || Math.min(240, Math.max(0, window.innerWidth - 24))
  const height = previewWindow.value?.offsetHeight || 135
  const edge = 12
  return {
    x: Math.max(edge, Math.min(Math.max(edge, window.innerWidth - width - edge), x)),
    y: Math.max(edge, Math.min(Math.max(edge, window.innerHeight - height - edge), y)),
  }
}
function placeBottomRight() {
  const width = previewWindow.value?.offsetWidth || Math.min(240, Math.max(0, window.innerWidth - 24))
  const height = previewWindow.value?.offsetHeight || 135
  previewPosition.value = constrainPosition(window.innerWidth - width - 16, window.innerHeight - height - 16)
}
function clampToViewport() {
  previewPosition.value = constrainPosition(previewPosition.value.x, previewPosition.value.y)
}
function startDrag(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button')) return
  const target = event.currentTarget as HTMLElement
  previewPointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: previewPosition.value.x, y: previewPosition.value.y }
  previewDragging.value = true
  target.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function movePreview(event: PointerEvent) {
  if (!previewPointer || previewPointer.id !== event.pointerId) return
  previewPosition.value = constrainPosition(previewPointer.x + event.clientX - previewPointer.startX, previewPointer.y + event.clientY - previewPointer.startY)
}
function endDrag(event: PointerEvent) {
  if (!previewPointer || previewPointer.id !== event.pointerId) return
  previewPointer = null
  previewDragging.value = false
}
function closePreview() {
  previewOpen.value = false
}

watch(() => [props.stream, props.disconnected] as const, ([stream, disconnected]) => {
  if (stream) {
    previewOpen.value = true
    previewPointer = null
    previewDragging.value = false
    placeBottomRight()
    void nextTick(placeBottomRight)
  } else if (!disconnected) {
    previewOpen.value = false
    previewPointer = null
    previewDragging.value = false
  }
}, { immediate: true })
onMounted(() => window.addEventListener('resize', clampToViewport))
onBeforeUnmount(() => window.removeEventListener('resize', clampToViewport))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="previewOpen && (props.stream || props.disconnected)"
      ref="previewWindow"
      class="share-preview-window"
      :class="{ dragging: previewDragging, disconnected: props.disconnected && !props.stream }"
      :style="previewStyle"
      role="region"
      aria-label="共享画面预览"
      @pointerdown="startDrag"
      @pointermove="movePreview"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @lostpointercapture="endDrag"
    >
      <MediaTile v-if="props.stream && !props.disconnected" :stream="props.stream" muted />
      <div v-else class="share-preview-disconnected" role="status">
        <MonitorOff :size="22" />
        <strong>共享流已断开</strong>
      </div>
      <div class="share-preview-toolbar">
        <div class="share-preview-actions">
          <button aria-label="关闭预览，不停止共享" title="关闭预览" @pointerdown.stop @click.stop="closePreview"><X :size="15" /></button>
        </div>
      </div>
      <div v-if="previewDragging" class="share-preview-drag-hint" aria-hidden="true"><Move :size="16" />正在移动预览窗口</div>
    </div>
  </Teleport>
</template>
