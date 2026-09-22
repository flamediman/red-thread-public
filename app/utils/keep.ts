/** Жетоны живут в localStorage, а дублируются в cookie сервера (см. server/api/keep.post.ts): Safari чистит localStorage
    через неделю без захода, cookie переживает год и больше. */
export function cookieValue(name: string): string {
  try {
    const m = document.cookie.split('; ').find(c => c.startsWith(`rt-${name}=`))
    return m ? decodeURIComponent(m.slice(name.length + 4)) : ''
  } catch { return '' }
}
/** положить (или снять, если value пустое) — ошибки сети не мешают игре */
export function keep(name: 'solo' | 'host', value: string) {
  void $fetch('/api/keep', { method: 'POST', body: { name, value } }).catch(() => { /* без cookie — как раньше, на localStorage */ })
}
