/* Карта сайта: главная и готовые одиночные истории. */
import { SOLO_STORIES } from '../scenario/index'
import { siteOrigin } from '../utils/site'

export default defineEventHandler((event) => {
  const base = siteOrigin(event)
  const urls = [`${base}/`, ...Object.values(SOLO_STORIES).filter(s => s.info.ready).map(s => `${base}/solo?story=${encodeURIComponent(s.info.id)}`)]
  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(u => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n') + '\n</urlset>\n'
})
