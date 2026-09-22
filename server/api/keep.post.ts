/* Дубль жетонов в cookie. Safari стирает localStorage сайта через семь дней, если на сайт не заходили, а cookie,
   поставленную сервером, держит до срока. Клиент читает жетон из localStorage, а если там пусто — отсюда.
   value пустое — cookie снимается (экран ушёл из комнаты). */
const KEEP: Record<string, RegExp> = {
  solo: /^[a-z0-9]{12,40}$/,
  host: /^[A-HJ-NP-Z2-9]{6}\.[A-Za-z0-9_-]{16,64}$/
}
/** предел жизни cookie в браузерах — 400 дней; продлевается при каждом заходе */
const DAYS = 400

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string; value?: string }>(event)
  const name = typeof body?.name === 'string' ? body.name : ''
  const re = KEEP[name]
  if (!re || typeof body?.value !== 'string') throw createError({ statusCode: 400, statusMessage: 'Нечего хранить' })
  const secure = getRequestURL(event).protocol === 'https:'
  if (body.value === '') { deleteCookie(event, `rt-${name}`, { path: '/' }); return { ok: true } }
  if (!re.test(body.value)) throw createError({ statusCode: 400, statusMessage: 'Не похоже на жетон' })
  setCookie(event, `rt-${name}`, body.value, { maxAge: DAYS * 86400, path: '/', sameSite: 'lax', secure, httpOnly: false })
  return { ok: true }
})
