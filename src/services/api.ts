import { ElMessage } from 'element-plus'
import { logger } from './logger'
export interface User { id: string; nickname: string; isGuest: boolean; role?: string }
export let user: User | null = JSON.parse(sessionStorage.getItem('shunhui.user') || 'null')
export function saveSession(result: { user: User; token: string }) { user = result.user; sessionStorage.setItem('shunhui.token', result.token); sessionStorage.setItem('shunhui.user', JSON.stringify(user)) }
let guestLogin: Promise<unknown> | undefined
export async function api<T = any>(path: string, method = 'GET', body?: unknown, automaticGuest = true): Promise<T> {
  if (automaticGuest && !sessionStorage.getItem('shunhui.token')) { guestLogin ||= guest(localStorage.getItem('shunhui.nickname') || '访客').finally(() => { guestLogin = undefined }); await guestLogin }
  let response: Response
  try { response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('shunhui.token') || ''}` }, body: body === undefined ? undefined : JSON.stringify(body) }) }
  catch (error) { logger.error(`接口请求失败：${method} ${path}`, error); throw new Error('无法连接会议服务，请确认服务已启动') }
  const result = await response.json()
  if (!response.ok) { logger.warn(`接口返回错误：${method} ${path}`, { status: response.status, message: result.message }); if (response.status === 401 && automaticGuest) { sessionStorage.removeItem('shunhui.token'); user = null } throw new Error(result.message || '请求失败') }
  return result.data
}
export async function guest(nickname: string) { const result = await api('/user/guest-login', 'POST', { nickname }, false); saveSession(result); return result }
export async function attempt<T>(fn: () => Promise<T>) { try { return await fn() } catch (e) { logger.error('业务操作失败', e); ElMessage.error(e instanceof Error ? e.message : '操作失败') } }
