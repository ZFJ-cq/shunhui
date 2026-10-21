# MVP 功能实现核对

本表按当前一期需求和仓库实际代码核对，功能状态以可运行实现为准。

| 需求 | 状态 | 实现位置 |
|---|---|---|
| FR1 手机号注册登录、游客入会 | 已实现 | `server/index.mjs`、`src/views/LoginView.vue` |
| FR2 即时/预约会议、会议号、密码 | 已实现 | `server/index.mjs`、`src/views/HomeView.vue`、`src/views/ScheduleView.vue` |
| FR3 密码、有效性、人数、锁定、结束校验 | 已实现 | `server/index.mjs` |
| FR4 摄像头、麦克风、扬声器预检和权限提示 | 已实现 | `src/views/PrecheckView.vue`、`src/services/media.ts` |
| FR5 音视频发布订阅、开关、语音激励 | 已实现 | `src/services/room.ts`、`server/sfu.mjs` |
| FR6 屏幕/窗口/标签页共享，单人共享 | 已实现 | `src/views/MeetingView.vue`、`server/index.mjs` |
| FR7 在线成员和媒体状态同步 | 已实现 | `server/index.mjs`、`src/services/room.ts` |
| FR8 主持人静音、关视频、全员静音、移除、锁定、结束 | 已实现 | `server/index.mjs`、`src/views/MeetingView.vue` |
| FR9 公共聊天、历史消息、主持人开关 | 已实现 | `server/index.mjs`、`src/components/ChatPanel.vue` |
| FR10 Socket.IO 和媒体自动恢复 | 已实现 | `src/services/room.ts`、`docs/signaling.md` |

媒体连接恢复流程会串行创建 transport，清理服务端旧 transport 后最多进行一次短重试；Socket.IO 断线会自动重连并重新发布仍存活的本地音视频轨道。浏览器出于安全限制不能自动恢复屏幕共享，需要用户重新选择共享源。

已验证：

```sh
npm run build
npm test
REAL_SFU=1 npm test
```

仍需部署环境验收的项目包括公网 TURN 穿透、跨浏览器/移动端真实媒体、25 人并发、端到端时延和弱网体验。这些指标无法由本机集成测试代替。
