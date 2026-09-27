/* Вход на страницу статистики (/stats) — только для владельца, по паролю.
   Пароль нигде не хранится: в окружении — хэш scrypt (STATS_PASSWORD_HASH=scrypt:<соль hex>:<ключ hex>) и секрет подписи
   (STATS_SECRET). Без них страница выключена (404). После входа — cookie на 30 дней с подписью HMAC, только для /api/stats,
   HttpOnly и SameSite=Strict. Попытки входа ограничены: 5 с адреса за 15 минут и 30 со всех адресов — перебор бессмыслен.
   Хэш для нового пароля: node -e "const c=require('crypto');const s=c.randomBytes(16);console.log('scrypt:'+s.toString('hex')+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'пароль' */
import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { WindowLimiter } from './limits'
import { clientIp } from './mode'

const HASH = process.env.STATS_PASSWORD_HASH || ''
const SECRET = process.env.STATS_SECRET || ''
export const STATS_ON = /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/.test(HASH) && SECRET.length >= 32

const COOKIE = 'rt-stats'
const DAYS = 30
const perIp = new WindowLimiter(5, 15 * 60_000)
const everyone = new WindowLimiter(30, 15 * 60_000)

export function ipOf(event: H3Event) { return clientIp(event.headers, event.node.req.socket?.remoteAddress) }

/** можно ли сейчас пробовать пароль (попытка засчитывается) */
export function mayTry(event: H3Event) { return everyone.take('all') && perIp.take(ipOf(event)) }

export function passwordOk(password: string): boolean {
  if (!STATS_ON || !password || password.length > 200) return false
  const [, salt, key] = HASH.split(':')
  const got = scryptSync(password.normalize('NFC'), Buffer.from(salt!, 'hex'), 64)
  return timingSafeEqual(got, Buffer.from(key!, 'hex'))
}

const sign = (exp: number) => createHmac('sha256', SECRET).update(`stats.${exp}`).digest('base64url')

export function openSession(event: H3Event) {
  const exp = Date.now() + DAYS * 86_400_000
  const secure = getRequestURL(event).protocol === 'https:' || getRequestHeader(event, 'x-forwarded-proto') === 'https'
  setCookie(event, COOKIE, `${exp}.${sign(exp)}`, { httpOnly: true, secure, sameSite: 'strict', path: '/api/stats', maxAge: DAYS * 86_400 })
}

export function closeSession(event: H3Event) { deleteCookie(event, COOKIE, { path: '/api/stats' }) }

export function inSession(event: H3Event): boolean {
  if (!STATS_ON) return false
  const [exp, sig] = (getCookie(event, COOKIE) ?? '').split('.')
  const t = Number(exp)
  if (!t || t < Date.now() || !sig) return false
  const want = Buffer.from(sign(t)), got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}
