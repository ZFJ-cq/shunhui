<script setup lang="ts">
import { computed } from 'vue'
import SharePreview from './components/SharePreview.vue'
import { useMeetingStore } from './stores/meeting'

const meetingStore = useMeetingStore()
const cachedViews = computed(() => meetingStore.cacheMeetingView ? ['MeetingView'] : [])
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <KeepAlive :include="cachedViews" :max="1">
      <component :is="Component" :key="route.name === 'meeting' ? String(route.params.meetingId) : undefined" />
    </KeepAlive>
  </RouterView>
  <SharePreview :stream="meetingStore.sharePreviewStream" :disconnected="meetingStore.sharePreviewDisconnected" />
</template>
