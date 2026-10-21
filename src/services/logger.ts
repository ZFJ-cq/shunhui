const prefix = '[瞬会]'
function details(value: unknown) {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  return value
}
export const logger = {
  debug(message: string, data?: unknown) { data === undefined ? console.debug(prefix, message) : console.debug(prefix, message, details(data)) },
  info(message: string, data?: unknown) { data === undefined ? console.info(prefix, message) : console.info(prefix, message, details(data)) },
  warn(message: string, data?: unknown) { data === undefined ? console.warn(prefix, message) : console.warn(prefix, message, details(data)) },
  error(message: string, error?: unknown) { console.error(prefix, message, details(error)) },
}
export function installGlobalErrorLogging() {
  window.addEventListener('error', event => logger.error('页面运行异常', event.error || event.message))
  window.addEventListener('unhandledrejection', event => logger.error('未处理的异步异常', event.reason))
}
