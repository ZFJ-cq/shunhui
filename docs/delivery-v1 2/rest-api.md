# REST 接口文档

Base URL 默认 http://localhost:33101。成功结构为 {code:0,msg:ok,data}，错误结构为 {code:httpStatus,msg,data:null}。认证头为 Authorization: Bearer token。startTime 使用 Unix 毫秒。

## 用户

POST /api/user/guest-login，body {nickname}，返回 userId、token、isGuest。
POST /api/user/login，body {phone,password}，返回 userId、nickname、avatar、token。
GET /api/user/me。

## 会议

POST /api/meetings/create，body {title,hostId,meetingPassword,maxParticipants,defaultMute}。
POST /api/meetings/schedule，body {title,startTime,duration,meetingPassword,maxParticipants,openWaitingRoom,joinBeforeHost,defaultMute}。
GET /api/meetings。
GET /api/meetings/:meetingId。
POST /api/meetings/:meetingId/join，body {nickname,password,userId,audioOff,videoOff}。
POST /api/meetings/:meetingId/leave，body {userId}。
PUT /api/meetings/:meetingId/end，body {hostId}。

## 参会人和聊天

GET /api/meetings/:meetingId/participants。
PUT /api/meetings/:meetingId/participant/mute，body {targetUserId,media,mute}。
PUT /api/meetings/:meetingId/mute-all。
DELETE /api/meetings/:meetingId/participant/:targetUserId，body {hostId}。
PUT /api/meetings/:meetingId/lock，body {hostId,lock}。
GET /api/meetings/:meetingId/chat。
POST /api/meetings/:meetingId/chat/send，body {content}。
PUT /api/meetings/:meetingId/chat/close，body {hostId,enable}。
GET /api/meetings/:meetingId/sfu-token。
GET /health。

密码不得明文或普通 MD5 存储。Postman 集合同目录可直接导入。等候室、举手、录制、白板、字幕、联席主持人和自动重连不属于一期 API 验收。
