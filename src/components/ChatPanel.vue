<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
interface Message { id: string; senderId: string; sender: string; text: string; time: string }
const props = defineProps<{ messages: Message[]; selfId: string; closed?: boolean }>()
const input = defineModel<string>({ required: true })
const emit = defineEmits<{ send: [] }>()
const list = ref<HTMLElement>()
function send() { if (!props.closed && input.value.trim()) emit('send') }
function onKeydown(event: KeyboardEvent) {
 if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.keyCode === 229) return
 event.preventDefault()
 send()
}
watch(() => props.messages.length, async () => { await nextTick(); list.value?.scrollTo({ top: list.value.scrollHeight, behavior: 'smooth' }) })
</script>
<template><div ref="list" class="chat-list"><div v-if="!messages.length" class="chat-empty">开始一场交流</div><div v-for="m in messages" :key="m.id" class="chat-message" :class="{ mine: m.senderId === selfId }"><div class="chat-message-content"><div class="chat-byline"><b>{{ m.sender }}</b><span>{{ new Date(m.time).toLocaleTimeString('zh-CN') }}</span></div><div class="message-bubble">{{ m.text }}</div></div></div></div><form class="chat-composer" @submit.prevent="send"><textarea v-model="input" :disabled="closed" :placeholder="closed ? '主持人已关闭聊天' : '输入消息，Enter 发送，Shift+Enter 换行'" aria-label="公共聊天消息" maxlength="2000" @keydown="onKeydown"></textarea><button class="compact-primary" :disabled="!input.trim() || closed">发送</button></form></template>
