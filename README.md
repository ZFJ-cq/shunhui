# 瞬会：Web 视频会议 MVP

Vue 3 + TypeScript 前端、Express/Socket.IO 服务、mediasoup SFU、SQLite 或 MySQL 持久化。房间状态由服务端持有，媒体由 SFU 转发；客户端不能自行声明主持人身份。账号密码使用 scrypt，会议密码使用带盐 scrypt，均不采用 PRD 中不适合存密码的 MD5。

## 开发

要求 Node.js 22 或 24、Python 3.10+、C++ 构建工具。mediasoup 安装会下载 worker，无法取到预编译包时会本地编译。

```sh
cp .env.example .env
npm ci
npm run dev
```

默认 `npm run dev` 使用 HTTP `http://localhost:5173`；需要本地 HTTPS 时运行 `npm run dev:https`，证书从 `HTTPS_CERT`/`HTTPS_KEY` 或 `deploy/certs/lan-cert.pem`、`lan-key.pem` 读取。API、Socket.IO 和 SFU 在 `http://localhost:33101`。本地默认用 `data/meeting.sqlite`，可在 `.env` 配置 MySQL `DATABASE_URL`。启动会自动建存储表。其他设备访问时必须使用可信 HTTPS 证书；首次访问需在每台设备上信任对应证书。私钥不应提交到版本库。

在本机用 `localhost` 打开时，邀请链接和二维码会自动使用启动电脑的私网 IPv4 地址。可通过 `VITE_LAN_HOST` 指定网卡地址，或通过 `VITE_PUBLIC_ORIGIN` 固定分享域名；域名部署优先使用它。局域网 HTTPS 证书的 SAN 必须包含当前 LAN IP，并且需要在参会设备上信任证书，否则浏览器会拦截媒体权限。

如果 mediasoup worker 在 macOS 上构建失败或网络无法访问 GitHub，使用 Docker 部署或更换能下载官方预编译 worker 的网络。没有可运行的 mediasoup worker 时，会议 API 测试仍可运行，但媒体会议不会启动。

## 生产部署

1. 将 `deploy/.env.example` 复制为项目 `.env`，填入数据库、JWT、内部RPC与TURN随机密钥，公网IP、域名与管理员凭证。
2. 证书保存为 `deploy/certs/fullchain.pem`、`privkey.pem`。设置 `APP_ORIGIN=https://会议域名` 和 `TURN_URLS=turn:会议域名:3478?transport=udp,turn:会议域名:3478?transport=tcp`。
3. 运行 `docker compose up --build -d`，启动 MySQL、API、signaling TLS/WebSocket网关、SFU、Coturn 五个服务。公网开放 TCP443、UDP/TCP40000–40100、UDP/TCP3478、UDP49160–49200。
4. API是房间状态权威源，网关仅代理TLS和Socket.IO，SFU用内部认证RPC连接。生产密钥不要沿用示例，数据库密码中的URL保留字符需编码。
5. 管理员首次启动时由 `ADMIN_PHONE`、`ADMIN_PASSWORD` 创建，之后可通过管理页创建普通账号。Coturn REST凭证按每次入会动态生成，有效期24小时；服务间密钥仅保存在服务器。

真实 mediasoup 官方worker已在本机启动并通过transport集成检查。开发环境Docker daemon不可用，未启动Compose；公网TURN、跨浏览器媒体、25人负载和300ms时延目标仍需部署环境验收。本地 TLS 会自动使用 `deploy/certs/lan-cert.pem` 和 `deploy/certs/lan-key.pem`（如果存在），也可通过 `HTTPS_CERT`/`HTTPS_KEY` 指定证书路径。

## 实现范围

- 游客身份、预置账号登录、管理员登录；JWT 鉴权与账号禁用。
- 即时会议、预约会议、会前主持人限制、密码、容量、锁定、取消/结束、我的会议和邀请二维码。
- Host 授权、在线参会名单、强制静音/关视频请求、移除与防止重入、锁会、关闭聊天。
- Socket.IO 房间信令；mediasoup SFU 音频/视频、屏幕共享、发言人检测；实时公共聊天与历史。
- 管理页显示用户、会议、参会记录、操作审计、在线数和信令连接数。
- 本地 SQLite、MySQL 存储、Docker Compose、Nginx HTTPS 反代与 coturn 配置。
- FR1–FR10 的逐项核对及剩余部署验收范围见 [MVP 功能实现核对](docs/implementation-status.md)。

## REST API

鉴权请求头：`Authorization: Bearer <JWT>`。成功结构为 `{code:0,data:...}`。

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/user/guest-login` | 游客登录 |
| POST | `/api/user/login` | 预置账号登录 |
| GET | `/api/user/me` | 当前身份 |
| POST | `/api/meetings/create` | 即时会议 |
| POST | `/api/meetings/schedule` | 预约会议 |
| GET | `/api/meetings` | 我的会议 |
| GET | `/api/meetings/:id` | 会议详情 |
| POST | `/api/meetings/:id/join` | 验证并获取短期房间凭证 |
| POST | `/api/meetings/:id/leave` | 离会 |
| PUT | `/api/meetings/:id/end` | 主持人结束会议 |
| DELETE | `/api/meetings/:id` | 取消预约 |
| GET | `/api/meetings/:id/participants` | 在线参会人 |
| PUT | `/api/meetings/:id/participant/mute` | 主持人静音或请求开麦/关视频 |
| DELETE | `/api/meetings/:id/participant/:userId` | 移除并禁止重入 |
| PUT | `/api/meetings/:id/lock` | 锁定/解锁 |
| PUT | `/api/meetings/:id/chat` | 关闭/开放聊天 |
| GET/POST | `/api/meetings/:id/chat`、`/chat/send` | 历史/发消息 |
| GET | `/api/admin/overview` | 管理监控与审计 |
| POST | `/api/admin/users` | 管理员创建账号 |
| PUT | `/api/admin/users/:id` | 禁用/启用账号 |
| PUT | `/api/admin/meetings/:id/end` | 管理员结束会议 |

## 信令与媒体

Socket.IO 默认同源 `/socket.io`。连接认证使用 `auth.token` 的短期 meeting JWT，服务端从 token 派生用户、房间与主持人权限。信令 envelope 为 `{type,from,target,payload}`，`request` 使用 ack 回答；事件包括 `room_state`、`participant_left`、`chat_message`、`active_speaker`、`new_producer`、`producer_closed`、`consumer_closed`、`meeting_ended`、`kicked`、`host_media` 和 `switch_layout`。mediasoup 的 ICE/DTLS/RTP 参数通过 `sfu` request 方法交换，这替代浏览器点对点 SDP offer/answer。

客户端每 4 秒采集发送/接收 WebRTC RTT、上下行丢包率和码率，并在会中显示网络质量；弱网时限制摄像头 simulcast 层，恢复后提升层数，统计不受支持时继续使用浏览器原生拥塞控制。媒体 transport 建立或运行失败时，客户端清理旧 transport 并自动短重试一次；Socket.IO 信令断线最多自动重连 8 次，重连成功后沿用原会议凭证同步状态、重建媒体 transport 并重新订阅远端流，屏幕共享因浏览器安全限制需要重新选择。屏幕共享优先保留 1080p 细节，主舞台完整显示共享内容，参会者缩略视图可滚动；服务端为摄像头、共享和音频预留合计码率空间。公网 TURN 和端到端流畅度仍须按实际网络环境验收。存储目前用 JSON 列存每行，适用于小规模 MVP，不支持多 API 副本并发写；上线扩容前应迁移到规范化表和集中式房间状态/锁。

## 检查

Postman 导入 `docs/WebMeeting.postman_collection.json`；默认 API 为 `http://localhost:33101`。先执行游客登录，再按“会议”文件夹顺序检查生命周期。预约、主持人控制和管理员文件夹按需单独执行；管理员需先通过账号登录获取 JWT。入会后应在 30 秒内建立 Socket.IO 连接，否则席位自动释放。

```sh
npm test
REAL_SFU=1 npm test
npm run build
```

集成测试以注入式 SFU 替身检查服务端授权、容量、控制、聊天与 Socket.IO；它不替代真实浏览器音视频验收。

## 前端代码与信令示例

业务页面位于 `src/views/`：HomeView、ScheduleView、PrecheckView、MeetingView。
会议 UI 拆为 `src/components/VideoCanvas.vue`、`ParticipantList.vue`、`ToolBar.vue`、`ChatPanel.vue`；媒体元素绑定与自动播放回退在 MediaTile。
Pinia 业务状态位于 `src/stores/meeting.ts`。底层会话、发布订阅与重连在 `src/services/room.ts`，弱网采样在 network.ts，媒体生命周期和权限错误映射在 media.ts。

需求未附外部信令 JSON 文档；当前实现与仓库内 Socket.IO/mediasoup 服务一致。若接入其他 SFU，应按其协议替换适配层，不能直接混发通用 SDP 信令。

客户端通过 Socket.IO `request` 事件发送 JSON，使用 ack 获取结果：

```json
{"type":"sfu","payload":{"method":"createTransport","data":{"direction":"send"}}}
```

成功 ack 为 `{"data":{...}}`，失败为 `{"error":"原因"}`。SFU 方法包括 capabilities、createTransport、connectTransport、produce、producers、consume、resumeConsumer、closeProducer。
业务请求包括 `{"type":"media_state","payload":{"audioOff":true}}`、`{"type":"chat","payload":{"content":"你好"}}` 和 `{"type":"state","payload":{}}`。
服务端通过 `signal` 事件推送 `{"type":"room_state","from":"server","target":"all","payload":{"meeting":{},"participants":[]}}`。
mediasoup-client 内部创建 RTCPeerConnection 并完成 SDP offer/answer 与 ICE 收集；应用层传递 SFU 所需的 ICE、DTLS、RTP 参数。

## 交付文档

- [接口Postman集合](docs/WebMeeting.postman_collection.json)
- [信令协议](docs/signaling.md)
- [黑盒验收用例](docs/acceptance.md)
- [架构、页面流程与带宽估算](docs/architecture.md)
- [数据库脚本](docs/schema.sql)
