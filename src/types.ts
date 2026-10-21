export interface MeetingRecord {
  id: string
  title: string
  startTime: string
  duration: number
  status: 'scheduled' | 'ongoing' | 'ended'
  maxParticipants: number
  defaultMute: boolean
  hostName: string
  hostId?: string
  joinBeforeHost?: boolean
  locked?: boolean
  chatClosed?: boolean
  participantCount?: number
  hasPassword?: boolean
  password?: string
  inviteDays?: 1 | 7 | 30
  inviteExpiresAt?: string
}

export interface JoinOptions {
  meetingId: string
  nickname: string
  password: string
  audioOff: boolean
  videoOff: boolean
  isHost: boolean
}

export interface ChatMessage {
  id: string
  sender: string
  text: string
  time: string
  mine: boolean
}
