/* Поисковым роботам: служебное закрыто. Страница входа в комнату не закрыта — превьюшники мессенджеров
   могут слушаться robots.txt, а из поиска её убирает meta robots noindex (server/plugins/meta.ts). */
import { siteOrigin } from '../utils/site'

export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')
  return [
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /_ws',
    'Disallow: /_solo',
    '',
    `Sitemap: ${siteOrigin(event)}/sitemap.xml`,
    ''
  ].join('\n')
})
