/* Поисковым роботам: игра и одиночные истории — можно, служебное и страницы входа в комнату — нет. */
import { siteOrigin } from '../utils/site'

export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')
  return [
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /play',
    'Disallow: /_ws',
    'Disallow: /_solo',
    '',
    `Sitemap: ${siteOrigin(event)}/sitemap.xml`,
    ''
  ].join('\n')
})
