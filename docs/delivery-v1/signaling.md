# WebSocket / Socket.IO 信令协议

Socket.IO 使用 HTTPS host 的 /socket.io，握手 auth 为 {token,meetingId}，事件为 message。原生 WebSocket 为 wss://host/ws/signaling/{meetingId}?token=meetingToken。

## 消息信封

{type:toggle_audio,from:123,target:all,payload:{userId:123,status:0}}。服务端从 token 推导 from 和角色。

## 事件

| type | payload | 权限 |
|---|---|---|
| offer/answer | sdp | 单播 |
| ice_candidate | candidate,sdpMid,sdpMLineIndex | 单播 |
| toggle_audio/toggle_video | userId,status | 仅本人 |
| screen_share_start/stop | userId | 仅本人 |
| host_mute_all | 空对象 | 主持人 |
| kick_user | targetUserId | 主持人 |
| close_chat | enable | 主持人 |
| active_speaker | activeUserId | 受控 |
| switch_layout | gallery或speaker | 本地 |
| sfu | method,data | SFU协商 |

服务端通知：participant_joined、participant_left、chat_message、active_speaker、new_producer、producer_closed、consumer_closed、meeting_ended、kicked、host_media、meeting_locked、close_chat、error。

服务端必须拒绝跨会议 target、失效 token、伪造 from、非主持人控制和非法 payload。SFU流程为 capabilities、transport、DTLS、produce、consume、resume、close。一期断线显示提示并释放资源，用户手动重新入会，不做自动重连。
