<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight, CalendarDays, ChevronDown, Clock3, Headphones, Plus, Video, WandSparkles } from 'lucide-vue-next'
import { useMeetingStore } from '../stores/meeting'

import { api, attempt } from '../services/api'
const router = useRouter()
const store = useMeetingStore()
const route = useRoute()
const meetingId = ref(typeof route.query.meeting === 'string' ? route.query.meeting : '')
const nickname = ref(store.profileName)
const audioOff = ref(true)
const videoOff = ref(true)
const recentMeetings = computed(() => store.sortedMeetings.filter(m => m.status !== 'ended').slice(0, 3))
onMounted(() => { void attempt(() => store.refresh()) })

async function startNow() {
 await attempt(async () => {
  const meeting = await store.makeMeeting({ title: '即刻会议', status: 'scheduled' })
  store.setJoinOptions({ meetingId: meeting.id, nickname: nickname.value || store.profileName, password: '', audioOff: true, videoOff: true, isHost: true })
  router.push('/precheck')
  })
}

async function join() {
  if (!meetingId.value.trim()) {
    ElMessage.warning('请输入会议号')
    return
  }
  if (!nickname.value.trim()) {
    ElMessage.warning('请输入你的昵称')
    return
  }
  const id = meetingId.value.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z0-9-]{3,32}$/.test(id)) return ElMessage.warning('会议号应为 3–32 位字母、数字或短横线')
  const info = await attempt(() => api(`/meetings/${id}`))
  if (!info) return
  if (info.status === 'ended') return ElMessage.warning('该会议已结束')
  let password = ''
  if (info.hasPassword) {
    try { password = (await ElMessageBox.prompt('请输入6位会议密码', '加入会议', { inputType: 'password', inputPattern: /^\d{6}$/, inputErrorMessage: '请输入6位数字' })).value } catch { return }
  }
  store.setJoinOptions({
    meetingId: id, nickname: nickname.value.trim(), password,
    audioOff: audioOff.value, videoOff: videoOff.value, isHost: false,
  })
  router.push('/precheck')
}

function showGuide() {
  void ElMessageBox.alert('快速开会：创建会议后检查设备并进入。预约会议：设置主题与时间，在“我的会议”管理。加入会议：输入会议号及昵称。支持真实多人音视频、共享屏幕与实时聊天。手机和跨设备使用请部署 HTTPS 并配置媒体公网地址。', '瞬会使用指南', { confirmButtonText: '知道了' })
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink to="/" class="brand"><span class="brand-mark"><Video :size="19" /></span><span>瞬会</span></RouterLink>
      <div class="side-label">工作空间</div>
      <nav class="side-nav">
        <RouterLink to="/" class="side-link active"><span class="nav-dot">◉</span>会议首页</RouterLink>
        <RouterLink to="/my-meetings" class="side-link"><CalendarDays :size="17" />我的会议</RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <div class="help-card"><div class="help-icon"><Headphones :size="18" /></div><strong>需要帮助？</strong><span>查看使用指南，快速开始</span><button @click="showGuide()">了解更多 <ArrowRight :size="14" /></button></div>
        <RouterLink to="/login" class="back-link">账号登录 / 管理后台</RouterLink><div class="user-profile"><div class="avatar avatar-blue">{{ store.profileName.slice(0, 1) }}</div><div class="user-copy"><strong>{{ store.profileName }}</strong><span>个人空间</span></div><ChevronDown :size="15" class="muted" /></div>
      </div>
    </aside>

    <main class="main-shell">
      <header class="topbar"><div class="breadcrumb">工作空间 <span>/</span> <b>会议首页</b></div><div class="topbar-right"><span class="top-date"><Clock3 :size="15" />{{ new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date()) }}</span><div class="avatar avatar-blue small-avatar">{{ store.profileName.slice(0, 1) }}</div></div></header>
      <section class="home-content">
        <div class="welcome-row"><div><div class="eyebrow"><WandSparkles :size="14" /> 简单、高效、轻松连接</div><h1>让沟通，<span>即刻发生。</span></h1><p>无论身在何处，都能和重要的人面对面交流。</p></div><div class="welcome-art" aria-hidden="true"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><div class="art-face face-one">林</div><div class="art-face face-two">M</div><div class="art-face face-three">陈</div><div class="art-video"><div class="video-sun"></div><div class="video-person"><i></i><b></b></div><div class="art-video-bar"><span></span><span></span><span></span></div></div><div class="art-sparkle">✦</div></div></div>

        <div class="home-grid">
          <section class="action-card create-card">
            <div class="card-topline"><span class="action-icon create-icon"><Video :size="19" /></span><span class="pill pill-live">现在开始</span></div>
            <h2>开启一场会议</h2><p>创建即时会议，邀请大家快速加入。</p>
            <button class="primary-button" @click="startNow">快速开会 <ArrowRight :size="17" /></button>
            <div class="card-foot"><span class="tiny-dot"></span> 无需预约，马上开始</div>
          </section>
          <section class="action-card schedule-card">
            <div class="card-topline"><span class="action-icon schedule-icon"><CalendarDays :size="19" /></span><span class="pill">提前安排</span></div>
            <h2>预约一场会议</h2><p>安排时间并设置会议详情。</p>
            <RouterLink class="secondary-button" to="/schedule">预约会议 <ArrowRight :size="17" /></RouterLink>
            <div class="card-foot"><span class="clock-face"><Clock3 :size="13" /></span> 支持提前创建日程</div>
          </section>
        </div>

        <section class="join-card">
          <div class="join-heading"><div class="join-heading-icon"><Plus :size="19" /></div><div><h2>加入会议</h2><p>输入会议号，快速加入一场正在进行的会议。</p></div></div>
          <form class="join-form" @submit.prevent="join">
            <label class="field"><span>会议号</span><input v-model="meetingId" placeholder="例如：SH-839 204" autocomplete="off" /><small>请输入会议主持人分享的会议号</small></label>
            <label class="field"><span>你的昵称</span><input v-model="nickname" placeholder="输入会议中显示的名称" maxlength="30" /></label>
            <div class="join-options"><label class="check-option"><input v-model="videoOff" type="checkbox" /><span class="check-box"></span>关闭摄像头</label><label class="check-option"><input v-model="audioOff" type="checkbox" /><span class="check-box"></span>静音入会</label></div>
            <button class="join-button" type="submit">加入会议 <ArrowRight :size="16" /></button>
          </form>
        </section>
        <section v-if="recentMeetings.length" class="recent-meetings"><div class="recent-head"><h2>最近会议</h2><RouterLink to="/my-meetings">查看全部 <ArrowRight :size="15" /></RouterLink></div><div class="recent-list"><RouterLink v-for="item in recentMeetings" :key="item.id" :to="`/m/${item.id}`" class="recent-row"><span class="recent-icon"><CalendarDays :size="17" /></span><span class="recent-copy"><strong>{{ item.title }}</strong><small>{{ item.id }} · {{ new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.startTime)) }}</small></span><ArrowRight :size="16" /></RouterLink></div></section>
        <div class="home-bottom-note"><span class="secure-mark">✓</span> 设备预览仅在本地运行，入会后通过加密媒体连接交流 <span class="note-separator">·</span> <button @click="showGuide()">帮助中心</button></div>
      </section>
    </main>
  </div>
</template>
