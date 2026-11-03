<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, LockKeyhole, Phone, ShieldCheck, Sparkles, UserRound, Users, Video } from 'lucide-vue-next'
import { api, attempt, saveSession, guest, user } from '../services/api'
import { useMeetingStore } from '../stores/meeting'

const router = useRouter()
const store = useMeetingStore()
const phone = ref('')
const password = ref('')
const nickname = ref(store.profileName)
const busy = ref(false)
const registering = ref(false)

async function login(asGuest = false) {
  busy.value = true
  try {
    const result = asGuest
      ? await guest(nickname.value)
      : await api(registering.value ? '/user/register' : '/user/login', 'POST', registering.value
          ? { phone: phone.value, password: password.value, nickname: nickname.value }
          : { phone: phone.value, password: password.value }, false)
    saveSession(result)
    store.profileName = result.user.nickname
    await store.refresh()
    router.push(result.user.role === 'admin' ? '/admin' : '/')
  } catch (e) {
    await attempt(async () => { throw e })
  } finally {
    busy.value = false
  }
}

function logout() {
  sessionStorage.clear()
  location.assign('/')
}
</script>

<template>
  <main class="auth-page">
    <div class="auth-layout">
      <section class="auth-intro" aria-label="瞬会介绍">
        <RouterLink to="/" class="auth-brand">
          <span class="auth-brand-mark"><Video :size="19" /></span>
          <span>瞬会</span>
        </RouterLink>

        <div class="auth-intro-copy">
          <span class="auth-eyebrow"><Sparkles :size="14" /> 简单、高效、轻松连接</span>
          <h1>让每一次沟通，<br /><span>都简单一点。</span></h1>
          <p>开启一场清晰、自然的面对面交流。<br />重要的人和想法，此刻就能连接。</p>
        </div>

        <div class="auth-visual" aria-hidden="true">
          <div class="auth-visual-orbit"></div>
          <div class="auth-visual-window">
            <div class="auth-visual-top"><i></i><i></i><i></i><span>瞬会 · 即刻连接</span></div>
            <div class="auth-visual-people">
              <div class="auth-person person-one"><span>林</span></div>
              <div class="auth-person person-two"><span>M</span></div>
              <div class="auth-person person-three"><span>陈</span></div>
            </div>
            <div class="auth-visual-controls"><i></i><i></i><b><Video :size="13" /></b><i></i></div>
          </div>
          <div class="auth-float-note"><span class="auth-live-dot"></span> 连接稳定 · 高清音视频</div>
        </div>

        <div class="auth-benefits">
          <span><Users :size="15" /> 轻松多人协作</span>
          <span><ShieldCheck :size="15" /> 安心连接</span>
        </div>
      </section>

      <section class="auth-panel" aria-labelledby="auth-title">
        <RouterLink to="/" class="auth-back"><ArrowLeft :size="15" /> 返回首页</RouterLink>
        <div class="auth-panel-heading">
          <span class="auth-panel-kicker">PERSONAL WORKSPACE</span>
          <h2 id="auth-title">{{ registering ? '创建你的账号' : '欢迎回来' }}</h2>
          <p>{{ registering ? '注册后即可管理会议与个人空间。' : '登录以继续管理你的会议空间。' }}</p>
        </div>

        <div class="auth-tabs" role="tablist" aria-label="账号操作">
          <button type="button" role="tab" :aria-selected="!registering" :class="{ selected: !registering }" @click="registering = false">登录</button>
          <button type="button" role="tab" :aria-selected="registering" :class="{ selected: registering }" @click="registering = true">注册</button>
        </div>

        <form class="auth-form" @submit.prevent="login()">
          <label class="auth-field">
            <span>手机号</span>
            <span class="auth-input-wrap"><Phone :size="16" /><input v-model="phone" type="tel" autocomplete="tel" inputmode="numeric" pattern="[0-9]{11}" maxlength="11" placeholder="请输入 11 位手机号" required /></span>
          </label>
          <label v-if="registering" class="auth-field">
            <span>昵称</span>
            <span class="auth-input-wrap"><UserRound :size="16" /><input v-model="nickname" autocomplete="nickname" maxlength="30" placeholder="输入会议中显示的昵称" required /></span>
          </label>
          <label class="auth-field">
            <span>密码 <small>{{ registering ? '至少 8 位' : '' }}</small></span>
            <span class="auth-input-wrap"><LockKeyhole :size="16" /><input v-model="password" type="password" :autocomplete="registering ? 'new-password' : 'current-password'" minlength="8" :placeholder="registering ? '请设置至少 8 位密码' : '请输入密码'" required /></span>
          </label>
          <button class="auth-submit" :disabled="busy" type="submit">{{ busy ? '请稍候…' : registering ? '创建账号' : '登录' }} <ArrowRight :size="17" /></button>
          <p v-if="registering" class="auth-form-note"><ShieldCheck :size="14" /> 手机号注册暂不需要短信验证</p>
        </form>

        <div class="auth-divider"><span>或者</span></div>

        <form class="guest-form" @submit.prevent="login(true)">
          <div class="guest-form-copy"><div class="guest-icon"><Users :size="17" /></div><div><strong>先以游客身份体验</strong><span>无需注册，输入昵称即可临时加入</span></div></div>
          <label class="auth-field guest-field"><span>游客昵称</span><span class="auth-input-wrap"><UserRound :size="16" /><input v-model="nickname" maxlength="30" placeholder="输入你希望显示的昵称" required /></span></label>
          <button class="guest-submit" :disabled="busy" type="submit">使用游客身份 <ArrowRight :size="16" /></button>
        </form>

        <button v-if="user" class="auth-logout" @click="logout">退出当前身份</button>
        <p class="auth-footnote"><ShieldCheck :size="14" /> 你的会议信息受到安全保护</p>
      </section>
    </div>
  </main>
</template>
