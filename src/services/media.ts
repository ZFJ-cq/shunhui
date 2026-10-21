let localStream: MediaStream | null = null
import { logger } from './logger'

export function setLocalStream(stream: MediaStream | null) {
  localStream = stream
  logger.info('已保存本地媒体流', { tracks: localStream ? localStream.getTracks().map(track => track.kind) : [] })
}

export function getLocalStream() {
  return localStream
}

export function stopLocalStream() {
  logger.info('正在停止本地媒体流')
  localStream?.getTracks().forEach((track) => track.stop())
  localStream = null
}

/** 统一权限错误文案；不吞掉浏览器错误名，便于用户区分拒绝、占用与缺失。 */
export function mediaErrorMessage(error: unknown): string {
  logger.warn('媒体设备访问异常', error)
  const name = error instanceof DOMException ? error.name : ''
  const messages: Record<string, string> = {
    NotAllowedError: '设备权限被拒绝，请在地址栏的网站权限中允许摄像头/麦克风。',
    NotFoundError: '未找到所选设备，请连接设备后重新检测。',
    NotReadableError: '设备被其他程序占用或系统禁止访问，请关闭占用程序后重试。',
    OverconstrainedError: '所选设备或分辨率不可用，请重新选择设备。',
    SecurityError: '当前安全上下文禁止访问设备，请使用 HTTPS 或 localhost。',
    AbortError: '设备访问已中断，请重试。',
  }
  return messages[name] || (window.isSecureContext ? '无法访问音视频设备，请检查系统和浏览器权限。' : '设备访问需要 HTTPS 或 localhost。')
}
