# 信令与媒体协议

浏览器以 `auth.token` 中 12 小时有效的 room JWT 连接同源 `/socket.io`。服务端校验用户、会议、membership，派生发送者与角色，不信任客户端 from/hostId。房间按 meetingId 隔离，目标通知进入 meetingId:userId 私有房间。

请求：Socket.IO `request` 事件，`{type,payload}`，ack 返回 `{data}` 或 `{error}`。

| type | payload | 用途 |
|---|---|---|
| state | {} | 会议、在线用户、最近200条消息 |
| chat | {content} | 持久化并广播纯文本 |
| media_state | {audioOff?,videoOff?} | 同步状态，暂停/恢复本人媒体生产者 |
| switch_layout | {layout:gallery或speaker} | 兼容事件；当前布局仅本地生效 |
| sfu | {method,data} | mediasoup RTP/ICE/DTLS 协商 |

SFU 方法：capabilities、producers、createTransport({direction})、connectTransport({transportId,dtlsParameters})、produce({transportId,kind,rtpParameters,source})、consume({transportId,producerId,rtpCapabilities})、resumeConsumer({consumerId})、closeProducer({producerId})、closeTransport({transportId,direction})。

通知 `signal`：`{type,from:'server',target,payload}`。包括 room_state、participant_left、chat_message、active_speaker、new_producer、producer_closed、consumer_closed、meeting_ended、kicked、host_media、switch_layout。

实现使用 mediasoup 原生 RTP/ICE/DTLS 协商，取代 PRD 泛化的 SDP offer/answer。浏览器 handler 负责底层 SDP，不在业务信令中转发不兼容的点对点 offer。所有媒体对象验证归属。主持人静音、踢人、锁会与聊天控制通过 REST 调用，结果实时广播；解除静音仅发请求，由本人点击开麦。布局仅在本地切换。

Socket.IO 断线最多自动重连 8 次。重连成功后服务端释放该成员旧 SFU peer，客户端重新获取 state、创建 send/recv transport、发布仍存活的本地音视频轨道，并重新订阅 producers；媒体连接仍会在首次失败时自动短重试一次，失败后提示用户重新入会。浏览器共享轨道不能跨断线安全恢复，需重新选择屏幕。异常信令断线服务端按 30 秒无 socket 清理成员。独立 SFU 通过内部密钥认证 RPC，只接收一个权威 API 连接；连接丢失通过容器重启恢复。
