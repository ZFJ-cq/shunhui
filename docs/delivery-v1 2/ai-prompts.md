# 全套 AI 开发提示词

## 全局上下文

你正在开发瞬会 WebMeeting。技术为 Vue3、TypeScript、Express、MySQL8、JWT、WebSocket/Socket.IO、WebRTC+SFU。只实现 MVP 一期：创建/预约、入会、游客会话、设备预检、音视频、共享、公共聊天、主持人控制、我的会议和基础管理。禁止等候室、举手、录制、白板、字幕、联席主持人和自动重连。先读代码、PRD、接口和测试；不以模拟成员或 localStorage 冒充真实多人会议；输出文件变更、接口影响、测试和风险。

## 前端
检查 router、store、services、类型和样式，复用 API。覆盖加载、空、错误、权限拒绝、已满、锁定、结束、被移除和断开。音视频必须绑定真实 MediaStream 或 producer；聊天纯文本转义；主持人权限以服务端角色为准；预检离开释放轨道；断线只提示手动重入。

## 后端
检查 routes、repositories、auth、validation、schema 和 Postman。保持 {code,msg,data}；JWT 推导身份；容量、锁定、结束、踢人和聊天开关使用事务；密码使用带盐适应性哈希；不泄露密码/token；清理离会、踢出、结束和断线资源；不实现二期。

## SFU
实现 capabilities、send/recv transport、DTLS、produce、consume、resume、close。权限由 API/信令验证；音频、摄像头、共享分别管理；处理权限拒绝、设备拔出、SFU错误；一期不做自动恢复；输出时序、清理和25人压测方法。

## 测试
覆盖创建预约、密码、链接入会、容量、锁定、设备权限、音视频、共享、多浏览器、SFU、聊天、主持人控制、越权、XSS、密码泄露、离会和断线清理。每条给前置、步骤、期望、证据、优先级；禁止用模拟成员证明多人能力；验证二期功能无入口。

## 部署
设计静态前端、Node API、WSS、SFU、TURN、MySQL。Nginx 转发 /api、/socket.io、/ws/signaling；密钥只用环境变量；提供健康检查、日志、端口、备份、回滚、25人压测和浏览器矩阵；说明单 API 权威房间状态的扩容限制。

## 审查
检查客户端越权、并发超员、幽灵成员、媒体泄漏、WSS鉴权、聊天XSS、密码/token泄露、模拟数据、二期功能和自动重连回归。按 P0/P1/P2 输出文件、行号、证据和修复建议。
