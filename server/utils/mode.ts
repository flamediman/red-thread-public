/* Два режима сервера.
   local  — дома: одна партия, экран входит по коду ведущего, телефоны в той же сети Wi‑Fi, фото игроков можно.
   public — в интернете: много комнат, каждую создаёт экран; фото выключены (не храним персональные данные),
            адреса локальной сети не раскрываются. */
export const IS_PUBLIC = process.env.GAME_MODE === 'public'

/** за прокси (Caddy, Cloudflare) адрес клиента берётся из заголовка; без прокси заголовкам верить нельзя */
export const TRUST_PROXY = process.env.TRUST_PROXY === '1'
/** какой заголовок несёт адрес: x-forwarded-for (Caddy, nginx) или cf-connecting-ip (Cloudflare) */
const REAL_IP_HEADER = (process.env.REAL_IP_HEADER || 'x-forwarded-for').toLowerCase()

const url = (v: string | undefined) => {
  const s = v?.trim()
  return s && /^https:\/\/[^\s"'<>]+$/.test(s) ? s : ''
}

/** то, что клиенту можно знать о сервере (/api/config) */
export const CLIENT_CONFIG = {
  mode: IS_PUBLIC ? 'public' as const : 'local' as const,
  photos: !IS_PUBLIC,
  /** канал игры в Telegram — ссылка в меню и в финале */
  telegram: url(process.env.TELEGRAM_URL),
  /** страница доната (Boosty, CloudTips…) — ссылка и QR в меню */
  donate: url(process.env.DONATE_URL)
}

export function clientIp(headers: Headers | undefined, fallback: string | undefined): string {
  if (TRUST_PROXY && headers) {
    const value = headers.get(REAL_IP_HEADER)
    // в x-forwarded-for последний адрес дописал ближайший прокси — ему и верим; первые клиент мог подделать
    if (value) return value.split(',').pop()!.trim()
  }
  return fallback || 'unknown'
}
