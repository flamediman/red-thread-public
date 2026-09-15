/* Адрес сайта для ссылок наружу: превью, канонический адрес, sitemap. */
import type { H3Event } from 'h3'
import { TRUST_PROXY } from './mode'

/** SITE_URL, иначе из запроса (за прокси — по заголовкам); www в каноническом адресе не нужен */
export function siteOrigin(event: H3Event) {
  const fixed = process.env.SITE_URL?.trim().replace(/\/+$/, '')
  if (fixed && /^https?:\/\/[^\s"'<>]+$/.test(fixed)) return fixed
  const url = getRequestURL(event, { xForwardedHost: TRUST_PROXY, xForwardedProto: TRUST_PROXY })
  return `${url.protocol}//${url.host.replace(/^www\./, '')}`
}
