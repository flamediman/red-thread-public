/* Статистика для владельца: только после входа (cookie сессии), без кэша */
import { STATS_ON, inSession } from '../../utils/stats-auth'
import { collectStats } from '../../utils/stats'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  if (!STATS_ON) throw createError({ statusCode: 404, statusMessage: 'Нет такой страницы' })
  if (!inSession(event)) throw createError({ statusCode: 401, statusMessage: 'Нужен пароль' })
  return collectStats()
})
