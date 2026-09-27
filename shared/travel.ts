/* Дорога по карте города (режим «на время», Scenario.map.kind === 'city'): напрямую, время — по расстоянию между
   серединами мест на общем плане. Движок считает по ней шаги, телефон — «ехать 18 с». Одна формула на обоих концах */
import type { CityMap } from './types'

interface Box { x: number; y: number; w: number; h: number }

/** минимум на любую поездку (выйти, дождаться лифта или такси) */
const BASE_MS = 2500

export function cityLegMs(map: CityMap, from: Box, to: Box): number {
  const aspect = map.aspect ?? 16 / 10
  const across = (map.secondsAcross ?? 30) * 1000
  const dx = ((to.x + to.w / 2) - (from.x + from.w / 2)) * aspect
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2)
  // через весь план по ширине (100 × aspect) — ровно secondsAcross
  return Math.round(BASE_MS + (Math.hypot(dx, dy) / (100 * aspect)) * across)
}
