<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AlertTriangle, ArrowRight, CalendarDays, ChevronDown, Clock3, Copy, Plus, Search, Video, X } from 'lucide-vue-next'
import { useMeetingStore } from '../stores/meeting'
import type { MeetingRecord } from '../types'

import QRCode from 'qrcode'
import { attempt, user } from '../services/api'
import { inviteUrl } from '../services/invite'
const router = useRouter()
const store = useMeetingStore()
onMounted(() => attempt(() => store.refresh()))
const filter = ref<'all' | MeetingRecord['status']>('all')
const query = ref('')
const rows = computed(() => store.sortedMeetings.filter((meeting) =>
 (filter.value === 'all' || meeting.status === filter.value) &&
 `${meeting.title} ${meeting.id} ${meeting.hostName}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))

const inviteMeeting = ref<MeetingRecord | null>(null), qr = ref('')
async function invite(meeting: MeetingRecord) { inviteMeeting.value = meeting; qr.value = await QRCode.toDataURL(inviteUrl(meeting.id), { width: 240, margin: 2 }) }
async function begin(meeting: MeetingRecord) {
  let password = ''
  if (meeting.hasPassword && meeting.hostId !== user?.id) {
    try { password = (await ElMessageBox.prompt('请输入6位会议密码', '加入会议', { inputType: 'password', inputPattern: /^\d{6}$/, inputErrorMessage: '请输入6位数字' })).value } catch { return }
  }
  store.setJoinOptions({ meetingId: meeting.id, nickname: store.profileName, password, audioOff: meeting.defaultMute, videoOff: true, isHost: meeting.hostId === user?.id })
  router.push('/precheck')
}

const cancelTarget = ref<MeetingRecord | null>(null)
async function cancel(meeting: MeetingRecord) {
  cancelTarget.value = meeting
}
const cancelling = ref(false)
async function confirmCancel() {
  if (!cancelTarget.value || cancelling.value) return
  cancelling.value = true
  const target = cancelTarget.value
  const ok = await attempt(async () => { await store.deleteMeeting(target.id); return true })
  cancelling.value = false
  if (ok) { ElMessage.success(`已取消预约「${target.title}」`); cancelTarget.value = null }
}
function formatDateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }

async function copyLink(id: string) {
  const link = inviteUrl(id)
  try {
    await navigator.clipboard.writeText(link)
    ElMessage.success('会议链接已复制')
  } catch {
    ElMessage.warning('复制失败，请打开邀请窗口手动复制链接。')
  }
}
function statusText(status: MeetingRecord['status']) {
  return { scheduled: '未开始', ongoing: '进行中', ended: '已结束' }[status]
}
</script>

<template>
  <div class="app-shell"><aside class="sidebar"><RouterLink to="/" class="brand"><span class="brand-mark"><Video :size="19" /></span><span>瞬会</span></RouterLink><div class="side-label">工作空间</div><nav class="side-nav"><RouterLink to="/" class="side-link"><span class="nav-dot">◉</span>会议首页</RouterLink><RouterLink to="/my-meetings" class="side-link active"><CalendarDays :size="17" />我的会议</RouterLink></nav><div class="sidebar-bottom"><div class="user-profile"><div class="avatar avatar-blue">{{ store.profileName.slice(0, 1) }}</div><div class="user-copy"><strong>{{ store.profileName }}</strong><span>个人空间</span></div><ChevronDown :size="15" class="muted" /></div></div></aside>
    <main class="main-shell"><header class="topbar"><div class="breadcrumb"><RouterLink to="/">工作空间</RouterLink><span>/</span><b>我的会议</b></div><div class="topbar-right"><div class="avatar avatar-blue small-avatar">{{ store.profileName.slice(0, 1) }}</div></div></header>
      <section class="meetings-page"><div class="page-heading"><div><div class="eyebrow"><CalendarDays :size="14" /> 你的会议日程</div><h1>我的会议</h1><p>管理你创建的预约和正在进行的会议。</p></div><RouterLink to="/schedule" class="primary-button"><Plus :size="17" />预约会议</RouterLink></div>
        <div class="meeting-filters"><button v-for="item in [{ id: 'all', name: '全部会议' }, { id: 'scheduled', name: '未开始' }, { id: 'ongoing', name: '进行中' }, { id: 'ended', name: '已结束' }] as const" :key="item.id" :class="{ chosen: filter === item.id }" @click="filter = item.id">{{ item.name }}<span>{{ item.id === 'all' ? store.meetings.length : store.meetings.filter(m => m.status === item.id).length }}</span></button></div><label class="meeting-search"><Search :size="17" /><input v-model="query" placeholder="搜索会议主题、会议号或主持人" aria-label="搜索会议" /></label>
        <div v-if="rows.length" class="meeting-list"><article v-for="meeting in rows" :key="meeting.id" class="meeting-row"><div class="meeting-date-box"><span>{{ new Intl.DateTimeFormat('zh-CN', { month: 'short' }).format(new Date(meeting.startTime)) }}</span><b>{{ new Intl.DateTimeFormat('zh-CN', { day: '2-digit' }).format(new Date(meeting.startTime)) }}</b></div><div class="meeting-info"><div class="meeting-name-line"><h2>{{ meeting.title }}</h2><span class="status-pill" :class="`status-${meeting.status}`"><i></i>{{ statusText(meeting.status) }}</span></div><div class="meeting-meta"><span><Clock3 :size="14" />{{ new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(meeting.startTime)) }}</span><span class="meta-dot">·</span><span>{{ meeting.duration }} 分钟</span><span class="meta-dot">·</span><span>会议号 {{ meeting.id }}</span><span> · {{ meeting.participantCount || 0 }} 人在线</span></div></div><div class="meeting-actions"><button v-if="meeting.status !== 'ended'" class="icon-button" title="邀请链接与二维码" aria-label="查看邀请链接与二维码" @click="invite(meeting)"><Copy :size="16" /></button><button v-if="meeting.status !== 'ended'" class="compact-primary" @click="begin(meeting)">{{ meeting.status === 'ongoing' ? '加入会议' : '进入会场' }} <ArrowRight :size="15" /></button><button v-if="meeting.status === 'scheduled' && meeting.hostId === user?.id" class="icon-button danger-icon" title="取消预约" aria-label="取消预约" @click="cancel(meeting)"><X :size="17" /></button><span v-if="meeting.status === 'ended'" class="ended-note">会议已结束</span></div></article></div>
        <div v-else class="empty-state"><div class="empty-icon"><CalendarDays :size="25" /></div><h2>{{ query ? '没有找到匹配的会议' : filter === 'all' ? '还没有会议安排' : '这里暂时没有会议' }}</h2><p>{{ query ? '请尝试其他主题、会议号或主持人姓名。' : '创建一场会议，邀请大家一起加入。' }}</p><button v-if="query" class="secondary-button" @click="query = ''">清除搜索</button><RouterLink v-else to="/schedule" class="secondary-button">预约会议 <ArrowRight :size="16" /></RouterLink></div>
        <div class="meetings-footnote"><span>i</span>会议记录由服务端保存</div>
        <div v-if="cancelTarget" class="dialog-backdrop" @click.self="!cancelling && (cancelTarget = null)"><section class="panel-card invite-dialog cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><button class="plain-icon-button" aria-label="关闭取消预约窗口" :disabled="cancelling" @click="cancelTarget = null">×</button><div class="cancel-warn-icon"><AlertTriangle :size="22" /></div><h2 id="cancel-title">取消预约</h2><p class="invite-copy">取消后，该会议号与邀请链接将立即失效，参会人无法再加入。此操作不可撤销。</p><div class="invite-detail"><span>会议主题</span><b>{{ cancelTarget.title }}</b></div><div class="invite-detail"><span>开始时间</span><b>{{ formatDateTime(cancelTarget.startTime) }}</b></div><div class="invite-detail"><span>会议号</span><b>{{ cancelTarget.id }}</b></div><div class="cancel-actions"><button class="secondary-button" :disabled="cancelling" @click="cancelTarget = null">保留预约</button><button class="danger-button" :disabled="cancelling" @click="confirmCancel">{{ cancelling ? '正在取消…' : '确认取消' }}</button></div></section></div>
      </section>
    </main><div v-if="inviteMeeting" class="dialog-backdrop" @click.self="inviteMeeting=null"><section class="panel-card invite-dialog" role="dialog" aria-modal="true" aria-labelledby="meeting-invite-title"><button class="plain-icon-button" aria-label="关闭邀请窗口" @click="inviteMeeting=null">×</button><h2 id="meeting-invite-title">邀请参会</h2><p class="invite-copy">{{ inviteMeeting.title }}</p><img :src="qr" alt="扫描二维码加入会议" /><div class="invite-detail"><span>会议号</span><b>{{ inviteMeeting.id }}</b></div><div class="invite-detail"><span>入会密码</span><b>{{ inviteMeeting.hasPassword ? '请联系主持人获取' : '无需密码' }}</b></div><div v-if="inviteMeeting.inviteExpiresAt" class="invite-detail"><span>链接有效期</span><b>截至 {{ new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(inviteMeeting.inviteExpiresAt)) }}</b></div><p class="invite-url">{{ inviteUrl(inviteMeeting.id) }}</p><button class="primary-button" @click="copyLink(inviteMeeting.id)">复制邀请链接</button></section></div></div>
</template>

<style scoped>
.cancel-dialog { width: min(420px, 100%); text-align: center; }
.cancel-warn-icon { width: 46px; height: 46px; display: grid; place-items: center; margin: 0 auto 10px; border-radius: 50%; color: #e08a6a; background: #fdeee4; }
.cancel-dialog .invite-copy { max-width: 320px; }
.cancel-actions { display: flex; gap: 9px; margin-top: 18px; }
.cancel-actions button { min-height: 40px; flex: 1; justify-content: center; border-radius: 8px; font-size: 13px; font-weight: 700; transition: background .15s, transform .15s; }
.cancel-actions .secondary-button { border: 1px solid #e8eaf2; background: #fff; color: #545f76; }
.cancel-actions .secondary-button:hover:not(:disabled) { border-color: #d9ddf7; color: #5464e4; }
.danger-button { border: 0; background: #d95550; color: #fff; box-shadow: 0 5px 12px rgba(217,85,80,.22); }
.danger-button:hover:not(:disabled) { background: #c94e4e; transform: translateY(-1px); }
.danger-button:disabled, .cancel-actions .secondary-button:disabled { opacity: .6; cursor: default; }
</style>
