# 瞬会 WebMeeting MVP 一期交付物

| 交付物 | 文件 |
|---|---|
| PRD 完整版 | PRD.md |
| 页面原型流程图与字段 | prototype-and-fields.md |
| MySQL 建表 SQL | schema.mysql.sql |
| REST 接口与 Postman | rest-api.md、WebMeeting.postman_collection.json |
| WebSocket 信令 | signaling.md |
| AI 开发提示词 | ai-prompts.md |
| 三层项目架构 | architecture.md |

一期包含创建/预约、链接入会、游客会话、设备预检、音视频、屏幕共享、公共聊天、主持人控制、我的会议和基础管理。

一期不开放等候室、举手、录制、白板、字幕、联席主持人和自动重连。

## 联调注意

Postman 集合保留了项目原有的完整操作目录，便于导入和评审；其中取消预约、管理员路由、聊天开关的旧路径与当前 `backend/src/routes.js` 尚未完全一致。以当前后端源码为执行基线：聊天开关使用 `/api/meetings/:meetingId/chat/close`，全员静音使用 `/api/meetings/:meetingId/mute-all`；取消预约和管理员接口需后端补齐后再验收。等候室相关集合项不属于一期。
