/* Заголовки безопасности для всех ответов. Скрипты и стили — только свои (Nuxt вставляет немного встроенного кода),
   чужие сайты не могут встроить игру во фрейм, камера разрешена только дома. */
import { IS_PUBLIC } from '../utils/mode'

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ')

export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': IS_PUBLIC ? 'camera=(), microphone=(), geolocation=()' : 'camera=(self), microphone=(), geolocation=()',
    ...(import.meta.dev ? {} : { 'content-security-policy': CSP })
  })
})
