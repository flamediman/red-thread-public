import type { ClientConfig } from '#shared/types'

/* Режим сервера и ссылки проекта. Грузится один раз; до ответа — домашний режим, но экран ждёт loaded,
   чтобы не мигнуть воротами с кодом там, где нужна кнопка «Открыть комнату». */
const config = ref<ClientConfig>({ mode: 'local', photos: true, telegram: '', donate: '' })
const loaded = ref(false)
let pending: Promise<void> | null = null

export function loadConfig() {
  pending ??= $fetch<ClientConfig>('/api/config')
    .then((c) => { config.value = c })
    .catch(() => { /* старый сервер без /api/config — домашний режим */ })
    .finally(() => { loaded.value = true })
  return pending
}

export function useConfig() {
  if (import.meta.client) void loadConfig()
  return { config, loaded }
}
