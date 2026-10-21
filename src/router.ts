import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import ScheduleView from './views/ScheduleView.vue'
import MyMeetingsView from './views/MyMeetingsView.vue'
import PrecheckView from './views/PrecheckView.vue'
import { useMeetingStore } from './stores/meeting'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/login', component: () => import('./views/LoginView.vue') },
    { path: '/admin', component: () => import('./views/AdminView.vue') },
    { path: '/m/:meetingId', redirect: to => ({ path: '/', query: { meeting: String(to.params.meetingId) } }) },
    { path: '/schedule', component: ScheduleView },
    { path: '/my-meetings', component: MyMeetingsView },
    { path: '/precheck', component: PrecheckView },
    {
      path: '/meeting/:meetingId', component: () => import('./views/MeetingView.vue'),
      beforeEnter: (to) => {
        if (useMeetingStore().pendingJoin.meetingId !== String(to.params.meetingId)) {
          return { path: '/', query: { meeting: String(to.params.meetingId) } }
        }
      },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
