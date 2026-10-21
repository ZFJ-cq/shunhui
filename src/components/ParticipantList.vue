<script setup lang="ts">
import { computed, ref } from 'vue'
import { Mic, MicOff, Video as VideoIcon, VideoOff, Crown, MonitorPlay, MoreVertical, UserX } from 'lucide-vue-next'
import type { Participant } from '../services/room'

const props = defineProps<{ participants: Participant[]; isHost: boolean; selfId: string }>()
const emit = defineEmits<{ mute: [userId: string, kind?: string, mute?: boolean]; kick: [userId: string]; transfer: [userId: string] }>()

const openMenu = ref<string | null>(null)
const menuPos = ref<{ top: number; right: number } | null>(null)

function toggleMenu(uid: string, e: MouseEvent) {
  if (openMenu.value === uid) { closeMenu(); return }
  const btn = e.currentTarget as HTMLElement
  const rect = btn.getBoundingClientRect()
  openMenu.value = uid
  // 用 fixed 定位渲染菜单，避免被滚动容器裁剪；靠近屏幕底部时上移。
  menuPos.value = { top: Math.min(rect.bottom + 6, window.innerHeight - 184), right: Math.max(window.innerWidth - rect.right, 8) }
}
function closeMenu() { openMenu.value = null; menuPos.value = null }

const openParticipant = computed(() => props.participants.find(p => p.userId === openMenu.value) || null)

function act(kind: 'mute-audio' | 'mute-video' | 'transfer' | 'kick', p: Participant) {
  if (kind === 'mute-audio') emit('mute', p.userId, 'audio', !p.audioOff)
  else if (kind === 'mute-video') emit('mute', p.userId, 'video')
  else if (kind === 'transfer') emit('transfer', p.userId)
  else emit('kick', p.userId)
  closeMenu()
}

const avatarColors = ['avatar-blue', 'avatar-coral', 'avatar-violet', 'avatar-green']
function avatarClass(uid: string) {
  let h = 0
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0
  return avatarColors[h % avatarColors.length]
}
</script>

<template>
  <div class="people-list">
    <div v-if="!participants.length" class="people-empty">暂时没有参会人</div>
    <div v-for="p in participants" :key="p.userId" class="person-row" :class="{ 'is-self': p.userId === selfId }">
      <div class="avatar" :class="avatarClass(p.userId)">{{ p.nickname.slice(0, 1) }}</div>
      <div class="person-row-copy">
        <div class="person-name-line">
          <b :title="p.nickname">{{ p.nickname }}</b>
          <span v-if="p.isHost" class="role-chip host-chip"><Crown :size="10" />主持人</span>
          <span v-else-if="p.userId === selfId" class="role-chip self-chip">我</span>
          <span v-if="p.screenShare" class="role-chip share-chip"><MonitorPlay :size="10" />共享中</span>
        </div>
        <div class="person-status">
          <span class="media-dot" :class="p.audioOff ? 'off' : 'on'" :title="p.audioOff ? '麦克风已关闭' : '麦克风已开启'">
            <MicOff v-if="p.audioOff" :size="12" /><Mic v-else :size="12" />
          </span>
          <span class="media-dot" :class="p.videoOff ? 'off' : 'on'" :title="p.videoOff ? '摄像头已关闭' : '摄像头已开启'">
            <VideoOff v-if="p.videoOff" :size="12" /><VideoIcon v-else :size="12" />
          </span>
          <small class="status-text">{{ p.audioOff ? '麦克风已关' : '麦克风开' }} · {{ p.videoOff ? '摄像头已关' : '摄像头开' }}</small>
        </div>
      </div>
      <button v-if="isHost && !p.isHost" class="person-more" :aria-label="`管理 ${p.nickname}`" :aria-expanded="openMenu === p.userId" @click="toggleMenu(p.userId, $event)">
        <MoreVertical :size="16" />
      </button>
    </div>
  </div>

  <div v-if="openMenu" class="person-menu-scrim" @click="closeMenu"></div>
  <div v-if="openParticipant" class="person-menu" :style="menuPos ? { top: menuPos.top + 'px', right: menuPos.right + 'px' } : {}" role="menu">
    <button class="person-menu-item" role="menuitem" @click="act('mute-audio', openParticipant)">
      <component :is="openParticipant.audioOff ? Mic : MicOff" :size="14" />
      {{ openParticipant.audioOff ? '邀请开麦' : '关闭麦克风' }}
    </button>
    <button v-if="!openParticipant.videoOff" class="person-menu-item" role="menuitem" @click="act('mute-video', openParticipant)">
      <VideoOff :size="14" /> 关闭摄像头
    </button>
    <button class="person-menu-item" role="menuitem" @click="act('transfer', openParticipant)">
      <Crown :size="14" /> 转让主持人
    </button>
    <button class="person-menu-item danger" role="menuitem" @click="act('kick', openParticipant)">
      <UserX :size="14" /> 移出会议
    </button>
  </div>
</template>

<style scoped>
.person-name-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.person-name-line b { overflow: hidden; color: #d8dbe4; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.role-chip { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; padding: 1px 6px; border-radius: 9px; font-size: 8px; font-weight: 600; white-space: nowrap; }
.host-chip { color: #f0c674; background: rgba(240,198,116,.14); }
.self-chip { color: #8fb0ff; background: rgba(88,105,236,.18); }
.share-chip { color: #6dbf9a; background: rgba(109,191,154,.16); }
.person-status { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.media-dot { display: inline-grid; place-items: center; width: 18px; height: 18px; flex: 0 0 auto; border-radius: 6px; }
.media-dot.on { color: #6dbf9a; background: rgba(109,191,154,.14); }
.media-dot.off { color: #e3817b; background: rgba(227,129,123,.14); }
.status-text { color: #7e899c; font-size: 9px; }
.person-row.is-self { background: rgba(88,105,236,.08); border-radius: 8px; }
.person-more { width: 24px; height: 24px; flex: 0 0 auto; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: #8893a6; }
.person-more:hover { background: rgba(255,255,255,.08); color: #d8dbe4; }
.person-menu-scrim { position: fixed; inset: 0; z-index: 40; }
.person-menu { position: fixed; z-index: 41; width: 138px; padding: 5px; border: 1px solid rgba(255,255,255,.1); border-radius: 9px; background: #2a3142; box-shadow: 0 14px 36px rgba(0,0,0,.4); }
.person-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: 0; border-radius: 6px; background: transparent; color: #dbe0e9; font-size: 11px; text-align: left; }
.person-menu-item:hover { background: rgba(255,255,255,.08); }
.person-menu-item.danger { color: #ef9189; }
.person-menu-item.danger:hover { background: rgba(228,107,101,.16); }
</style>
