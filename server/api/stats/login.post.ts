/* Вход по паролю: попытки ограничены (5 с адреса и 30 всего за 15 минут), неверный пароль отвечает с задержкой */
import { STATS_ON, mayTry, openSession, passwordOk } from '../../utils/stats-auth'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  if (!STATS_ON) throw createError({ statusCode: 404, statusMessage: 'Нет такой страницы' })
  if (!mayTry(event)) throw createError({ statusCode: 429, statusMessage: 'Слишком много попыток — подождите 15 минут' })
  const body = await readBody<{ password?: unknown }>(event).catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!passwordOk(password)) {
    await new Promise(r => setTimeout(r, 600))
    throw createError({ statusCode: 401, statusMessage: 'Неверный пароль' })
  }
  openSession(event)
  return { ok: true }
})
