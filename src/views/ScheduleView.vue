<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, CalendarDays, Check, ChevronDown, Clock3, LockKeyhole, UsersRound, Video, Copy, X } from 'lucide-vue-next'
import { useMeetingStore } from '../stores/meeting'

import QRCode from 'qrcode'
import { inviteUrl } from '../services/invite'
const router = useRouter()
const store = useMeetingStore()
const now = new Date(Date.now() + 60 * 60 * 1000)
const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const title = ref('')
const startTime = ref(localDateTime)
const duration = ref(60)
const maxParticipants = ref(25)
const passwordEnabled = ref(false)
const password = ref('')
const defaultMute = ref(true)
const joinBeforeHost = ref(true)
const inviteDays = ref<1 | 7 | 30>(7)
const creating = ref(false)
const createdMeeting = ref<Awaited<ReturnType<typeof store.makeMeeting>> | null>(null)
const createdQr = ref('')
const createdUrl = computed(() => createdMeeting.value ? inviteUrl(createdMeeting.value.id) : '')
const formattedStart = computed(() => startTime.value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(startTime.value)) : '选择开始时间')

async function create() {
  if (creating.value) return
  if (!title.value.trim()) return ElMessage.warning('请填写会议主题')
  if (!startTime.value || new Date(startTime.value).getTime() < Date.now()) return ElMessage.warning('请选择一个未来的开始时间')
  if (passwordEnabled.value && !/^\d{6}$/.test(password.value)) return ElMessage.warning('会议密码需要为 6 位数字')
  creating.value = true
  try {
   const meeting = await store.makeMeeting({ title: title.value.trim(), startTime: new Date(startTime.value).toISOString(), duration: Number(duration.value), maxParticipants: Number(maxParticipants.value), defaultMute: defaultMute.value, joinBeforeHost: joinBeforeHost.value, inviteDays: inviteDays.value, password: passwordEnabled.value ? password.value : '' })
   createdMeeting.value = meeting
   createdQr.value = await QRCode.toDataURL(inviteUrl(meeting.id), { width: 240, margin: 2 })
   ElMessage.success('预约已创建，可复制邀请信息发送给参会人。')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '创建预约失败，请重试。') }
  finally { creating.value = false }
}
async function copyInvite() {
 if (!createdMeeting.value) return
 try { await navigator.clipboard.writeText(createdUrl.value); ElMessage.success('邀请链接已复制。') }
 catch { ElMessage.warning('复制失败，请手动复制下方链接。') }
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar"><RouterLink to="/" class="brand"><span class="brand-mark"><Video :size="19" /></span><span>瞬会</span></RouterLink><div class="side-label">工作空间</div><nav class="side-nav"><RouterLink to="/" class="side-link"><span class="nav-dot">◉</span>会议首页</RouterLink><RouterLink to="/my-meetings" class="side-link"><CalendarDays :size="17" />我的会议</RouterLink></nav><div class="sidebar-bottom"><div class="user-profile"><div class="avatar avatar-blue">{{ store.profileName.slice(0, 1) }}</div><div class="user-copy"><strong>{{ store.profileName }}</strong><span>个人空间</span></div><ChevronDown :size="15" class="muted" /></div></div></aside>
    <main class="main-shell"><header class="topbar"><div class="breadcrumb"><RouterLink to="/">工作空间</RouterLink><span>/</span><b>预约会议</b></div><div class="topbar-right"><div class="avatar avatar-blue small-avatar">{{ store.profileName.slice(0, 1) }}</div></div></header>
      <section class="form-page"><RouterLink to="/" class="back-link"><ArrowLeft :size="16" />返回首页</RouterLink><div class="form-title-row"><div><div class="eyebrow"><CalendarDays :size="14" /> 规划你的下一场交流</div><h1>预约会议</h1><p>填写会议详情，我们会为你生成专属会议号和邀请链接。</p></div><div class="schedule-illustration"><CalendarDays :size="40" /><span>📅</span></div></div>
        <div class="schedule-layout"><form class="schedule-form panel-card" @submit.prevent="create"><div class="form-section-title"><span>01</span><div><h2>基本信息</h2><p>会议将显示给所有受邀参会人</p></div></div>
          <label class="field wide-field"><span>会议主题 <b class="required">*</b></span><input v-model="title" placeholder="例如：每周产品例会" maxlength="100" required /></label>
          <div class="form-row"><label class="field"><span>开始时间 <b class="required">*</b></span><input v-model="startTime" type="datetime-local" required /><small>{{ formattedStart }}</small></label><label class="field"><span>会议时长</span><div class="select-wrap"><select v-model.number="duration"><option :value="30">30 分钟</option><option :value="60">60 分钟</option><option :value="90">90 分钟</option><option :value="120">120 分钟</option></select><ChevronDown :size="15" /></div></label></div>
          <div class="form-section-title settings-title"><span>02</span><div><h2>会议设置</h2><p>你可以稍后在会议中调整设置</p></div></div>
          <div class="form-row"><label class="field"><span>参会人数上限</span><div class="select-wrap"><select v-model.number="maxParticipants"><option :value="5">5 人</option><option :value="10">10 人</option><option :value="25">25 人</option><option :value="50">50 人</option><option :value="100">100 人</option><option :value="200">200 人</option></select><ChevronDown :size="15" /></div></label><div class="field"><span>会议密码 <em>选填</em></span><label class="switch-line"><input v-model="passwordEnabled" type="checkbox" /><span class="switch-ui"></span><span>设置入会密码</span></label><input v-if="passwordEnabled" v-model="password" class="password-input" placeholder="6 位数字" inputmode="numeric" maxlength="6" /></div></div>
          <label class="setting-row"><span class="setting-icon"><Video :size="17" /></span><span class="setting-copy"><b>参会人入会时静音</b><small>参会人加入时将默认关闭麦克风</small></span><input v-model="defaultMute" type="checkbox" class="native-switch" /></label>
          <label class="field invite-expiry-field"><span>邀请链接有效期</span><div class="select-wrap"><select v-model.number="inviteDays"><option :value="1">1 天</option><option :value="7">7 天</option><option :value="30">30 天</option></select><ChevronDown :size="15" /></div></label>
          <label class="setting-row"><span class="setting-copy"><b>允许在主持人之前入会</b></span><input v-model="joinBeforeHost" type="checkbox" class="native-switch" /></label><div class="form-actions"><button type="button" class="text-button" @click="router.push('/')">取消</button><button type="submit" class="primary-button" :disabled="creating">{{ creating ? '正在创建…' : '创建预约' }} <ArrowLeft class="forward-arrow" :size="16" /></button></div>
        </form>
        <aside class="schedule-aside"><div class="summary-card"><div class="summary-head"><span class="summary-calendar"><CalendarDays :size="20" /></span><div><strong>会议预览</strong><small>创建后可在“我的会议”中查看</small></div></div><div class="summary-divider"></div><div class="summary-detail"><span class="summary-icon"><Video :size="16" /></span><div><small>会议主题</small><b>{{ title || '尚未填写' }}</b></div></div><div class="summary-detail"><span class="summary-icon"><Clock3 :size="16" /></span><div><small>开始时间</small><b>{{ formattedStart }}</b></div></div><div class="summary-detail"><span class="summary-icon"><UsersRound :size="16" /></span><div><small>参会人数</small><b>最多 {{ maxParticipants }} 人</b></div></div><div class="summary-detail"><span class="summary-icon"><LockKeyhole :size="16" /></span><div><small>入会保护</small><b>{{ passwordEnabled ? '密码保护已开启' : '无需密码' }}</b></div></div></div><div class="tip-card"><span class="tip-check"><Check :size="15" /></span><div><b>会前准备</b><p>会议开始前可通过会议链接邀请参会人。请确保浏览器允许访问摄像头和麦克风。</p></div></div></aside></div>
  </section>
    </main>
  </div>
  <div v-if="createdMeeting" class="dialog-backdrop" @click.self="createdMeeting=null"><section class="panel-card invite-dialog schedule-success-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-success-title"><button class="plain-icon-button" aria-label="关闭预约成功窗口" @click="createdMeeting=null"><X :size="18" /></button><div class="success-mark"><Check :size="20" /></div><h2 id="schedule-success-title">预约已创建</h2><p class="invite-copy">会议已保存到“我的会议”。你可以现在复制邀请信息发给参会人。</p><img :src="createdQr" alt="扫描二维码加入会议" /><div class="invite-detail"><span>会议主题</span><b>{{ createdMeeting.title }}</b></div><div class="invite-detail"><span>开始时间</span><b>{{ new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(createdMeeting.startTime)) }}</b></div><div class="invite-detail"><span>会议号</span><b>{{ createdMeeting.id }}</b></div><p class="invite-url">{{ createdUrl }}</p><div class="success-actions"><button class="secondary-button" @click="router.push('/my-meetings')">查看我的会议</button><button class="primary-button" @click="copyInvite"><Copy :size="15" />复制邀请链接</button></div></section></div>
</template>
