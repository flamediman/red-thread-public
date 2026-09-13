/* История сыгранных дел домашнего сервера — .data/history.json. Файл, а не база: партий будут десятки,
   а один файл переживает перезапуск, копируется вместе с .data и не требует установки.
   В сети история своя у каждой комнаты и лежит в её снимке (rooms.ts). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './data-dir'
import type { GameRecord } from '../../shared/types'

const FILE = join(DATA_DIR, 'history.json')
/** состояние уходит клиентам на каждое изменение — файл читается один раз */
let cache: GameRecord[] | null = null

export function readHistory(): GameRecord[] {
  if (cache) return cache
  try {
    const data = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []
    cache = Array.isArray(data) ? data : []
  } catch {
    cache = []
  }
  return cache
}

export function appendHistory(record: GameRecord) {
  cache = [...readHistory(), record]
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(cache, null, 2))
  } catch (e) {
    console.warn('история не записана:', (e as Error).message)
  }
}
