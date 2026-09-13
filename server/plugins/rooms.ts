import { flushAll, initRooms } from '../utils/rooms'

export default defineNitroPlugin((nitroApp) => {
  initRooms()

  // сообщение больше 16 КБ закрывает сокет ещё до разбора (по умолчанию ws принимает до 100 МБ)
  const ws = nitroApp.h3App.websocket as { serverOptions?: Record<string, unknown> } | undefined
  if (ws) ws.serverOptions = { ...(ws.serverOptions ?? {}), maxPayload: 16 * 1024 }

  // перед остановкой отложенные снимки партий — на диск
  nitroApp.hooks.hook('close', () => flushAll())
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      flushAll()
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
    })
  }
})
