export function log(level, message, detail = {}) {
  const record = { time: new Date().toISOString(), level, message, ...detail }
  const output = JSON.stringify(record)
  if (level === 'error') console.error(output)
  else console.log(output)
}
