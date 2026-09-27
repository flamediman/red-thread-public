import { closeSession } from '../../utils/stats-auth'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  closeSession(event)
  return { ok: true }
})
