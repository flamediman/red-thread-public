/* Архивные фотографии: /public/art/<дело>/<префикс>_<id>.jpg, генерируются tools/images.mjs.
   Единый стиль — чёрно-белая плёнка. Если файла нет, <img> просто не покажется —
   компоненты держат запасной вариант (инициал / заливка). */
import { currentCase, currentSetting } from './case-store'

const base = (caseId?: string) => `/art/${caseId ?? currentCase.value}`

export const ART = {
  get cover() { return `${base()}/cover.jpg` },
  get dawn() { return `${base()}/dawn.jpg` },
  coverOf: (caseId: string) => `${base(caseId)}/cover.jpg`,
  witness: (id: string) => `${base()}/w_${id}.jpg`,
  detective: (id: string) => `/art/${currentSetting.value}/d_${id}.jpg`,
  location: (id: string) => `${base()}/l_${id}.jpg`,
  item: (id: string) => `${base()}/i_${id}.jpg`
}

/** Снимок у карточки на доске: вещдок — фото вещи, слова свидетеля — лицо, находка в комнате — кадр комнаты. */
export function cardPhoto(c: { itemId?: string; witnessId?: string; locationId?: string }): { src: string; kind: 'item' | 'face' | 'place' } | null {
  if (c.itemId) return { src: ART.item(c.itemId), kind: 'item' }
  if (c.witnessId) return { src: ART.witness(c.witnessId), kind: 'face' }
  if (c.locationId) return { src: ART.location(c.locationId), kind: 'place' }
  return null
}

/** Небольшой детерминированный наклон «приколотой» карточки или фото — от id. */
export function tilt(id: string, max = 2): string {
  let h = 7
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const v = ((h % 1000) / 1000) * 2 * max - max
  return `${v.toFixed(2)}deg`
}
