import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { JoinOptions, MeetingRecord } from '../types'
import { api } from '../services/api'
export const useMeetingStore = defineStore('meeting', () => {
  const meetings = ref<MeetingRecord[]>([])
  const pendingJoin = ref<JoinOptions>({ meetingId: '', nickname: '我', password: '', audioOff: true, videoOff: true, isHost: false })
  const profileName = ref(localStorage.getItem('shunhui.nickname') || '访客')
  const sortedMeetings = computed(() => [...meetings.value].sort((a,b) => Date.parse(b.startTime) - Date.parse(a.startTime)))
  async function refresh() { meetings.value = await api('/meetings') }
  async function makeMeeting(input: Partial<MeetingRecord> & { title: string }) { const m = await api<MeetingRecord>(`/meetings/${input.startTime ? 'schedule' : 'create'}`, 'POST', input); meetings.value.unshift(m); return m }
  function setJoinOptions(options: JoinOptions) { pendingJoin.value = options; profileName.value = options.nickname; localStorage.setItem('shunhui.nickname', options.nickname) }
  async function deleteMeeting(id: string) { await api(`/meetings/${id}`, 'DELETE'); await refresh() }
  return { meetings, sortedMeetings, pendingJoin, profileName, makeMeeting, setJoinOptions, deleteMeeting, refresh }
})
