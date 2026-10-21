# 前端、后端、媒体服务三层架构

浏览器 Vue3 -> Nginx HTTPS/WSS -> Express REST/JWT 与 WebSocket/Socket.IO；REST -> MySQL8；信令 -> SFU；浏览器媒体 -> SFU/TURN。

## 目录

瞬会/
├── src/ views components services stores router.ts
├── backend/ src/routes.js signaling.js validation.js db.js middleware/auth.js repositories/ services/ sql/schema.sql test/
├── server/ sfu.mjs sfu-server.mjs remote-sfu.mjs
├── deploy/nginx/ deploy/certs/
├── tests/
└── docs/delivery-v1/

前端负责页面、设备采集和媒体客户端；后端负责 JWT、会议状态、容量、角色、聊天持久化和 REST；SFU 负责媒体路由；MySQL 负责用户、会议、成员和审计记录。生产必须替换证书、JWT、数据库、SFU 和 TURN 密钥。

一期不新增等候室队列、举手状态、录制文件、白板、字幕、联席主持人或自动重连状态机。
