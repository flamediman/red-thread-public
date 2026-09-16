/** Экраны способностей сверх хода на телефоне */
export type AbilityMode = 'drone' | 'archivist' | 'verify' | 'summon' | 'reporter'

/** способности, которые — действие сверх хода (остальные со счётчиком срабатывают внутри обычного хода) */
const EXTRA = new Set(['drone', 'patrol', 'reporter', 'intern', 'fixer', 'archivist', 'tracker', 'coroner'])
const TIMES: Record<number, string> = { 1: 'один раз', 2: 'два раза', 3: 'три раза', 4: 'четыре раза', 5: 'пять раз' }

/** Одна строка о том, как способность используется, — под описанием и примером на всех экранах телефона.
    В самих текстах способностей этого больше нет: раньше «Работает всегда» стояло и в примере, и внизу. */
export function abilityUses(ability: { kind: string; uses: number | null } | null | undefined, usesLeft?: number | null) {
  if (!ability || ability.uses == null) return 'Работает сама, всегда.'
  const times = `${TIMES[ability.uses] ?? `${ability.uses} раз`} за ночь`
  const base = EXTRA.has(ability.kind) ? `Сверх хода, ${times}` : `${times[0]!.toUpperCase()}${times.slice(1)}`
  if (usesLeft == null || usesLeft === ability.uses) return `${base}.`
  return usesLeft > 0 ? `${base} · осталось ${usesLeft}.` : `${base} · на эту ночь закончились.`
}
