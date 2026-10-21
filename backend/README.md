# 瞬会后端

Node.js 20+、Express、Socket.IO、原生 WebSocket、MySQL 8、JWT 和 LiveKit SFU。后端与 Vue 前端分开运行。

```sh
cd backend
npm install
cp .env.example .env
# 配好 MySQL 后初始化表
npm run db:init
npm run dev
```

服务默认监听 `http://localhost:3001`。需先创建 MySQL 数据库账户；`.env` 中的 JWT 密钥须为至少 32 个字符。使用 LiveKit 时填写 `LIVEKIT_URL`、`LIVEKIT_API_KEY` 和 `LIVEKIT_API_SECRET`。未配置时，加入会议仍返回 `sfuUrl: ""`；真实媒体连接不可用。启用 LiveKit 后，客户端应通过受鉴权的后端凭证接口取得 LiveKit access token。账号登录只接受已有账号，管理员使用 `npm run user:create -- <phone> <password> <nickname> [avatarUrl]` 建立账号；密码以随机盐 scrypt 哈希保存。

## REST 契约

成功与失败都使用 `{ "code": number, "msg": string, "data": any }`，成功 `code=0`。业务接口 JWT 从 `Authorization: Bearer <token>` 读取。`hostId` 和 `userId` 入参会与 JWT 主体核对，绝不以请求中的 ID 授权。时间戳 `startTime` 按 Unix 毫秒读取，数据库按 UTC 保存。

| Method | Path | Body | data |
| --- | --- | --- | --- |
| POST | `/api/user/guest-login` | `{nickname}` | `{userId,token,isGuest:true}` |
| POST | `/api/user/login` | `{phone,password}` | `{userId,nickname,avatar,token}` |
| POST | `/api/meetings/create` | `{title,hostId,meetingPassword,maxParticipants,defaultMute}` | `{meetingId,joinUrl,token,meetingInfo}` |
| POST | `/api/meetings/schedule` | `{title,startTime,duration,meetingPassword,maxParticipants,openWaitingRoom,joinBeforeHost,defaultMute}` | 同创建会议 |
| GET | `/api/meetings/:meetingId` | - | `{meetingId,title,meetingPassword:"",maxParticipants,meetingStatus,defaultMute}` |
| POST | `/api/meetings/:meetingId/join` | `{nickname,password,userId}` | `{meetingToken,wsSignalingUrl,sfuUrl,meetingInfo,participantInfo}` |
| POST | `/api/meetings/:meetingId/leave` | `{userId}` | `null` |
| PUT | `/api/meetings/:meetingId/end` | `{hostId}` | `null` |
| GET | `/api/meetings/:meetingId/participants` | - | 参会人数组 |
| PUT | `/api/meetings/:meetingId/participant/mute` | `{targetUserId,media,mute}` | `null` |
| DELETE | `/api/meetings/:meetingId/participant/:targetUserId` | `{hostId}` | `null` |
| PUT | `/api/meetings/:meetingId/lock` | `{hostId,lock}` | `null` |
| POST | `/api/meetings/:meetingId/chat/send` | `{content}` | `null` |

`meetingStatus`: scheduled=0、ongoing=1、ended=2。会议详情不泄露密码。密码采用 Node.js scrypt 随机盐哈希。账号登录需要预置用户，因原始协议没有注册接口。

辅助管理路由（不改变原始契约）：

| Method | Path | Body | 用途 |
| --- | --- | --- | --- |
| GET | `/api/meetings/:meetingId/sfu-token` | - | 为已入会用户签发短期 LiveKit 凭证，返回 `{sfuUrl,sfuToken,expiresIn}` |
| GET | `/api/meetings/:meetingId/waiting-participants` | - | 主持人查看候场列表 |
| PUT | `/api/meetings/:meetingId/participant/admit` | `{hostId,targetUserId}` | 主持人准入候场用户；用户随后重试 join |
| PUT | `/api/meetings/:meetingId/mute-all` | - | 主持人全员静音 |
| PUT | `/api/meetings/:meetingId/chat/close` | `{hostId,enable}` | 主持人关闭或重新开启聊天 |

启用 `openWaitingRoom` 时，非主持人的首次 join 返回 HTTP 409（统一错误结构），并写入候场记录。主持人通过上述准入接口同意后，客户端重试 join 获取会议令牌。登录接口为 JWT 的签发入口，无需已有令牌。

运行验证：`npm test` 执行密码单元测试；启动本服务和 MySQL 后，使用 `TEST_API=http://localhost:3001/api npm test` 同时执行 REST 与信令集成测试。集成测试会在当前数据库创建测试用户和会议，应使用独立测试库。

## 信令

原生 WebSocket 地址由加入响应返回：`/ws/signaling/{meetingId}?token={meetingToken}`。每条消息使用 `{type,from,target,payload}`；服务端以 JWT 覆盖 `from`，客户端伪造身份会被拒绝。SDP、ICE 支持 `target` 为数字用户 ID 单播或 `all` 会议内广播。状态/主持人指令只发给同一会议。信令事件包括协议中列出的 `offer`、`answer`、`ice_candidate`、参会人状态、踢人、全员静音、锁定、聊天控制和布局切换。

同一服务也提供 Socket.IO (`path: /socket.io`)。握手参数使用 `auth: {token, meetingId}` 或 query `token`、`meetingId`；客户端通过 `message` 事件发送相同信封，并监听 `message` 接收。协议地址中的 `{meetingId}` 是必需路径段；Socket.IO 握手单独携带 `meetingId`。WebSocket 使用 URL token 是协议要求；生产环境须强制 HTTPS/WSS，因为 URL 可能进入代理访问日志。

会议房间以 `meeting:{meetingId}` 隔离。只有已通过 REST 入会并保持活跃的参会人可连接和收发消息；主持人权限从会议表核验。人数上限使用事务锁会议行避免并发超员。参会入会、离会、踢出、结束时清理均写入 `participant_logs`。

## 目录

```text
backend/
  sql/schema.sql
  src/
    app.js config.js db.js errors.js logger.js routes.js server.js signaling.js validation.js
    middleware/auth.js
    repositories/{meetings,users}.js
    services/{meetingService,passwords,sfu}.js
    scripts/{init-db,create-user}.js
  test/{passwords,signaling}.test.js
```

四张表定义在 `sql/schema.sql`：`users`、`meetings`、`participants`、`participant_logs`。`GET /health` 为进程健康探针。

根目录的 Vue 前端目前仍连接其原有本地原型服务。启用本后端时，应将 `/api` 代理到 `http://localhost:3001`，并将信令客户端配置到本服务；本后端 Socket.IO 的事件名为 `message`，消息封套遵循上面的临时协议。前端仓库当前信令示例采用不同封套，正式联调前需按双方确认的临时协议同步前端适配。
