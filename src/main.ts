import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import App from './App.vue'
import router from './router'
import './style.css'
import { installGlobalErrorLogging } from './services/logger'

installGlobalErrorLogging()
createApp(App).use(createPinia()).use(router).mount('#app')
