<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, RotateCw, Search } from 'lucide-vue-next'
import { api, attempt } from '../services/api'

interface AdminUser { id: string; nickname: string; phone?: string; role: string; isGuest: boolean; disabled: boolean }
interface AdminMeeting { id: string; title: string; status: 'scheduled' | 'ongoing' | 'ended'; participantCount: number; startTime: string }
type AdminTab = 'meetings' | 'users' | 'participants' | 'audit'
const data = ref<any>(null), tab = ref<AdminTab>('meetings'), query = ref(''), page = ref(1), pageSize = 10, loading = ref(false)
const phone = ref(''), nickname = ref(''), password = ref(''), creating = ref(false)
const sourceRows = computed<any[]>(() => data.value?.[tab.value] || [])
const filteredRows = computed(() => {
 const term = query.value.trim().toLocaleLowerCase()
 if (!term) return sourceRows.value
 return sourceRows.value.filter(row => [row.id,row.nickname,row.userId,row.phone,row.title,row.meetingId,row.action,row.detail].some(value => String(value || '').toLocaleLowerCase().includes(term)))
})
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize)))
const visibleRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const tabs: { id: AdminTab; label: string }[] = [{ id: 'meetings', label: '会议记录' }, { id: 'users', label: '用户管理' }, { id: 'participants', label: '参会日志' }, { id: 'audit', label: '操作日志' }]
async function refresh(showFeedback = false) {
 loading.value = true
 const ok = await attempt(async () => { data.value = await api('/admin/overview'); return true })
 if (ok && showFeedback) ElMessage.success('管理数据已更新。')
 loading.value = false
}
async function createUser() {
 if (creating.value) return
 creating.value = true
 const ok = await attempt(async () => { await api('/admin/users', 'POST', { phone: phone.value.trim(), nickname: nickname.value.trim(), password: password.value }); return true })
 creating.value = false
 if (ok) { phone.value = ''; nickname.value = ''; password.value = ''; ElMessage.success('账号已创建。'); await refresh() }
}
async function disable(user: AdminUser) {
 const action = user.disabled ? '启用' : '禁用'
 try { await ElMessageBox.confirm(`确定${action}账号“${user.nickname}”吗？${user.disabled ? '' : '禁用后，该账号将无法继续使用会议服务。'}`, `${action}账号`, { confirmButtonText: `确认${action}`, cancelButtonText: '返回', type: 'warning' }) } catch { return }
 const ok = await attempt(async () => { await api(`/admin/users/${user.id}`, 'PUT', { disabled: !user.disabled }); return true })
 if (ok) { ElMessage.success(`账号已${action}。`); await refresh() }
}
async function end(meeting: AdminMeeting) {
 try { await ElMessageBox.confirm(`结束“${meeting.title}”后，所有参会人都会立即离开。`, '结束会议', { confirmButtonText: '结束会议', cancelButtonText: '继续会议', type: 'warning' }) } catch { return }
 const ok = await attempt(async () => { await api(`/admin/meetings/${meeting.id}/end`, 'PUT'); return true })
 if (ok) { ElMessage.success('会议已结束。'); await refresh() }
}
function statusLabel(value: string) { return ({ scheduled: '未开始', ongoing: '进行中', ended: '已结束' } as Record<string,string>)[value] || value }
function roleLabel(user: AdminUser) { return user.role === 'admin' ? '管理员' : user.isGuest ? '游客' : '账号用户' }
function timeLabel(value?: string) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }
function displayAction(value?: string) { return ({ schedule: '预约会议', create: '创建会议', end: '结束会议', mute: '媒体控制', kick: '移出参会人', lock: '会议锁定', chat: '聊天设置', cancel: '取消预约', create_user: '创建账号', disable_user: '账号状态调整' } as Record<string,string>)[value || ''] || value || '—' }
onMounted(refresh)
</script>

<template>
 <main class="admin-page">
  <RouterLink to="/" class="back-link"><ArrowLeft :size="15" />会议首页</RouterLink>
  <header class="admin-heading"><div><h1>平台管理</h1><p>管理用户、会议记录、参会情况与操作日志。</p></div><button class="secondary-button" :disabled="loading" @click="refresh(true)"><RotateCw :size="15" :class="{ spin: loading }" />{{ loading ? '正在更新' : '刷新数据' }}</button></header>
  <p v-if="!data" class="admin-empty">{{ loading ? '正在读取管理数据…' : '暂无管理数据，请确认当前账号具有管理员权限。' }}</p>
  <template v-else>
   <div class="admin-stats"><section><b>{{ data.users.length }}</b><span>用户总数</span></section><section><b>{{ data.meetings.length }}</b><span>会议总数</span></section><section><b>{{ data.concurrent }}</b><span>当前参会人数</span></section><section><b>{{ data.sockets }}</b><span>信令连接数</span></section></div>
   <nav class="admin-tabs" aria-label="管理分类"><button v-for="item in tabs" :key="item.id" :class="{ chosen: tab === item.id }" @click="tab = item.id; page = 1; query = ''">{{ item.label }}</button></nav>
   <form v-if="tab === 'users'" class="admin-create" @submit.prevent="createUser"><label>手机号<input v-model="phone" required maxlength="11" inputmode="numeric" autocomplete="off" /></label><label>昵称<input v-model="nickname" required maxlength="30" /></label><label>初始密码<input v-model="password" type="password" required minlength="8" autocomplete="new-password" /></label><button class="secondary-button" :disabled="creating">{{ creating ? '正在创建…' : '创建账号' }}</button></form>
   <div class="admin-table-tools"><label><Search :size="16" /><input v-model="query" :placeholder="`搜索${tabs.find(item => item.id === tab)?.label || '记录'}`" @input="page = 1" /></label><span>共 {{ filteredRows.length }} 条</span></div>
   <div class="admin-table">
    <table v-if="tab === 'users'"><thead><tr><th>昵称</th><th>手机号</th><th>账号类型</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="u in visibleRows as AdminUser[]" :key="u.id"><td>{{ u.nickname }}</td><td>{{ u.phone || '—' }}</td><td>{{ roleLabel(u) }}</td><td><span class="admin-status" :class="u.disabled ? 'is-disabled' : 'is-active'">{{ u.disabled ? '已禁用' : '正常' }}</span></td><td><button v-if="u.role !== 'admin'" class="table-action" @click="disable(u)">{{ u.disabled ? '启用账号' : '禁用账号' }}</button></td></tr><tr v-if="!visibleRows.length"><td colspan="5" class="table-empty">没有符合条件的用户</td></tr></tbody></table>
    <table v-else-if="tab === 'meetings'"><thead><tr><th>会议号</th><th>会议主题</th><th>开始时间</th><th>状态</th><th>在线人数</th><th>操作</th></tr></thead><tbody><tr v-for="m in visibleRows as AdminMeeting[]" :key="m.id"><td>{{ m.id }}</td><td>{{ m.title }}</td><td>{{ timeLabel(m.startTime) }}</td><td><span class="admin-status" :class="`status-${m.status}`">{{ statusLabel(m.status) }}</span></td><td>{{ m.participantCount }}</td><td><button v-if="m.status === 'ongoing'" class="table-action danger" @click="end(m)">结束会议</button></td></tr><tr v-if="!visibleRows.length"><td colspan="6" class="table-empty">没有符合条件的会议</td></tr></tbody></table>
    <table v-else><thead><tr><th>时间</th><th>用户</th><th>会议号</th><th>操作</th><th>详情</th></tr></thead><tbody><tr v-for="row in visibleRows" :key="row.id"><td>{{ timeLabel(row.time || row.joinTime) }}</td><td>{{ row.nickname || row.userId || '—' }}</td><td>{{ row.meetingId || '—' }}</td><td>{{ tab === 'audit' ? displayAction(row.action) : (row.leaveTime ? '已离会' : '参会中') }}</td><td>{{ row.detail || '—' }}</td></tr><tr v-if="!visibleRows.length"><td colspan="5" class="table-empty">没有符合条件的记录</td></tr></tbody></table>
   </div>
   <footer class="admin-pagination"><span>第 {{ page }} / {{ pageCount }} 页</span><div><button :disabled="page <= 1" @click="page--">上一页</button><button :disabled="page >= pageCount" @click="page++">下一页</button></div></footer>
  </template>
 </main>
</template>
