/* Превью ссылок и поисковики. Игра — SPA, и мессенджеры с поисковыми роботами видят только HTML-оболочку,
   без выполнения скриптов. Поэтому заголовок, описание и картинка вставляются в оболочку на сервере — по адресу:
   главная — сама игра, /play?r=КОД — приглашение в комнату, /solo?story=… — одиночная история с её обложкой.
   Картинка по умолчанию — public/og/red-thread.jpg (собирается tools/og-image.mjs). */
import type { H3Event } from 'h3'
import { SOLO_SETTINGS, SOLO_STORIES } from '../scenario/index'
import { siteOrigin } from '../utils/site'
import { formatRoom } from '../../app/utils/room'

const SITE = 'Красная нить'
const TITLE = 'Красная нить — кооперативный детектив для компании'
const DESCRIPTION = 'Детектив для компании: общий экран, телефоны вместо блокнотов и одна ночь, чтобы найти правду. '
  + 'Нуар, Неон и одиночный хоррор «Туман» — прямо в браузере, без установки и регистрации.'
const IMAGE = { path: '/og/red-thread.jpg', width: 1200, height: 630, alt: 'Красная нить — кооперативный детектив: фото трёх миров на доске, связанные красной нитью' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface Page { title: string; description: string; path: string; image: { path: string; width?: number; height?: number; alt: string }; index: boolean; game?: boolean }

function pageFor(event: H3Event): Page {
  const url = getRequestURL(event)
  if (url.pathname === '/play') {
    const code = url.searchParams.get('r')?.toUpperCase() ?? ''
    const room = /^[A-Z0-9]{4,8}$/.test(code) ? formatRoom(code) : ''
    return {
      title: 'Вас зовут в «Красную нить»',
      description: room
        ? `Откройте ссылку на телефоне — он станет вашим блокнотом сыщика. Код комнаты: ${room}.`
        : 'Подключитесь с телефона к общему экрану: введите код комнаты — и телефон станет блокнотом сыщика.',
      path: '/play', image: IMAGE, index: false
    }
  }
  if (url.pathname === '/solo') {
    const id = url.searchParams.get('story') ?? ''
    const entry = SOLO_STORIES[id] ?? Object.values(SOLO_STORIES)[0]
    if (entry) {
      const world = SOLO_SETTINGS[entry.info.settingId]?.title ?? 'Туман'
      return {
        title: `${entry.info.title} — ${world} · ${SITE}`,
        description: entry.info.lede,
        path: `/solo?story=${encodeURIComponent(entry.info.id)}`,
        image: { path: `/art/${entry.info.id}/cover.jpg`, alt: `${entry.info.title} — обложка истории` },
        index: entry.info.ready
      }
    }
  }
  return { title: TITLE, description: DESCRIPTION, path: '/', image: IMAGE, index: url.pathname === '/', game: url.pathname === '/' }
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const page = pageFor(event)
    const base = siteOrigin(event)
    const url = base + page.path
    const image = base + page.image.path
    const meta = (attr: 'name' | 'property', key: string, value: string) => `<meta ${attr}="${key}" content="${esc(value)}">`
    const tags = [
      `<title>${esc(page.title)}</title>`,
      meta('name', 'description', page.description),
      `<link rel="canonical" href="${esc(url)}">`,
      meta('name', 'robots', page.index ? 'index, follow' : 'noindex, follow'),
      meta('property', 'og:type', 'website'),
      meta('property', 'og:site_name', SITE),
      meta('property', 'og:locale', 'ru_RU'),
      meta('property', 'og:title', page.title),
      meta('property', 'og:description', page.description),
      meta('property', 'og:url', url),
      meta('property', 'og:image', image),
      meta('property', 'og:image:type', 'image/jpeg'),
      ...(page.image.width ? [meta('property', 'og:image:width', String(page.image.width)), meta('property', 'og:image:height', String(page.image.height))] : []),
      meta('property', 'og:image:alt', page.image.alt),
      meta('name', 'twitter:card', 'summary_large_image'),
      meta('name', 'twitter:title', page.title),
      meta('name', 'twitter:description', page.description),
      meta('name', 'twitter:image', image)
    ]
    // подтверждение прав в Google Search Console и Яндекс Вебмастере — код из их кабинетов, в переменных окружения
    const google = process.env.GOOGLE_SITE_VERIFICATION?.trim(), yandex = process.env.YANDEX_VERIFICATION?.trim()
    if (google) tags.push(meta('name', 'google-site-verification', google))
    if (yandex) tags.push(meta('name', 'yandex-verification', yandex))
    if (page.game) {
      const ld = {
        '@context': 'https://schema.org', '@type': 'VideoGame', name: SITE, url, image, description: DESCRIPTION,
        inLanguage: 'ru', genre: ['детектив', 'кооперативная игра', 'хоррор'], playMode: ['CoOp', 'SinglePlayer'],
        gamePlatform: 'Браузер', applicationCategory: 'Game'
      }
      tags.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`)
    }
    // в конец головы: кодировка из оболочки должна остаться первой
    html.head.push(tags.join(''))
  })
})
