import { fileURLToPath } from 'node:url'
import { writeCaseRegistry } from './tools/cases-registry.mjs'

// дела лежат в отдельном репозитории (CASES_DIR) — перед сборкой собираем их список
const { dir: casesDir, ids: caseIds } = writeCaseRegistry()
console.log(caseIds.length ? `Красная нить: дела ${caseIds.join(', ')}` : `Красная нить: в ${casesDir} нет дел`)

export default defineNuxtConfig({
  compatibilityDate: '2025-09-10',
  // файлы дел импортируют типы по этому имени — так им всё равно, где лежит репозиторий дел
  alias: { '@red-thread/types': fileURLToPath(new URL('./shared/types.ts', import.meta.url)) },
  modules: ['nuxt-qrcode'],
  css: ['~/assets/scss/main.scss'],
  ssr: false,
  devtools: { enabled: false },
  // манифест сборки не нужен: перезагрузку при новой сборке делает сам клиент по метке сервера
  experimental: { appManifest: false },
  nitro: {
    experimental: {
      websocket: true
    },
    routeRules: {
      '/': { headers: { 'cache-control': 'no-cache' } },
      '/play': { headers: { 'cache-control': 'no-cache' } },
      // сборка Vite: имена с хешем, можно кэшировать надолго
      '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      '/fonts/**': { headers: { 'cache-control': 'public, max-age=2592000' } },
      '/sfx/**': { headers: { 'cache-control': 'public, max-age=86400' } }
    }
    // картинки, озвучка и музыка отдаются с диска на лету — server/utils/media.ts
  },
  qrcode: {
    options: {
      variant: { pixel: 'rounded', marker: 'rounded', inner: 'circle' },
      radius: { pixel: 1, marker: 0.5, inner: 1 },
      ecc: 'L',
      border: 2
    }
  },
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1' },
        { name: 'theme-color', content: '#0c0d10' },
        { name: 'mobile-web-app-capable', content: 'yes' }
      ],
      link: [
        // свои имена файлов: на этом же порту раньше жила другая игра, браузер кэширует иконку по адресу
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon-rn.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-rn.png' }
      ]
    }
  }
})
