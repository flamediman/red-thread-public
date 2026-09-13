/* Комнаты: у каждой своя партия, свой снимок на диске и своя история дел.
   Дома комната одна (LOCAL) и живёт в .data/game.json, как раньше. В сети комнату создаёт экран:
   код из шести знаков для телефонов и секретный ключ для самого экрана. Пустые комнаты со временем закрываются. */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { Game } from '../game/engine'
import type { GameStore } from '../game/store'
import type { GameRecord } from '../../shared/types'
import { DATA_DIR } from './data-dir'
import { IS_PUBLIC } from './mode'
import { appendHistory, readHistory } from './history'

export interface Room {
  code: string
  game: Game
  /** ключ экрана; дома его нет — экран входит по коду ведущего */
  hostKey: string | null
  createdAt: number
  touchedAt: number
  /** id сокетов, которые смотрят в эту комнату */
  peers: Set<string>
}

export const LOCAL_ROOM = 'LOCAL'
/** без похожих друг на друга знаков: ни O и 0, ни I и 1 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE = /^[A-HJ-NP-Z2-9]{6}$/
const ROOM_DIR = join(DATA_DIR, 'rooms')
const MAX_ROOMS = Math.max(1, Number(process.env.MAX_ROOMS) || 300)
const HOUR = 3_600_000

const rooms = new Map<string, Room>()
const listeners = new Set<(room: Room) => void>()

export function onRoomChange(fn: (room: Room) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** «abc-def», « ABCDEF » → ABCDEF; мусор → null */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return CODE.test(code) ? code : null
}

export function getRoom(code: string | null | undefined): Room | undefined {
  return code ? rooms.get(code) : undefined
}

export function verifyHost(room: Room, key: unknown): boolean {
  if (!room.hostKey || typeof key !== 'string') return false
  const a = Buffer.from(room.hostKey), b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function roomCount() { return rooms.size }

/* ── снимки ─────────────────────────────────────────────────── */

/** через временный файл: снимок не порвётся, если процесс упадёт посреди записи */
function writeAtomic(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

/** Отложенная запись: партия меняется много раз в секунду, на диск уходит последнее состояние раз в секунду. */
class LaterFile {
  private pending: (() => string) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private file: string) {}
  write(build: () => string) {
    this.pending = build
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 1000)
    this.timer.unref?.()
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    const build = this.pending
    this.pending = null
    if (!build) return
    try { writeAtomic(this.file, build()) } catch (e) { console.warn('снимок не записался:', (e as Error).message) }
  }
}

const roomFile = (code: string) => join(ROOM_DIR, `${code}.json`)

/** Дома: снимок и история — те же файлы, что и до комнат (.data/game.json, .data/history.json) */
function localStore(): GameStore {
  const file = new LaterFile(join(DATA_DIR, 'game.json'))
  return {
    load() {
      try { return existsSync(join(DATA_DIR, 'game.json')) ? JSON.parse(readFileSync(join(DATA_DIR, 'game.json'), 'utf8')) : null } catch { return null }
    },
    save(data) { file.write(() => JSON.stringify(data)) },
    flush() { file.flush() },
    history: readHistory,
    addHistory: appendHistory,
    log: text => console.log(text)
  }
}

interface RoomFile { code: string; hostKey: string; createdAt: number; touchedAt: number; history: GameRecord[]; game: unknown }

/** В сети: один файл на комнату — ключ экрана, история этой комнаты и снимок партии */
function roomStore(room: () => Room, saved: RoomFile | null): GameStore {
  const file = new LaterFile(roomFile(saved?.code ?? room().code))
  let history: GameRecord[] = saved?.history ?? []
  let game: unknown = saved?.game ?? null
  const dump = () => {
    const r = room()
    const data: RoomFile = { code: r.code, hostKey: r.hostKey!, createdAt: r.createdAt, touchedAt: r.touchedAt, history, game }
    return JSON.stringify(data)
  }
  // новая комната сразу ложится на диск: переживёт перезапуск, даже если в ней ещё ничего не делали
  if (!saved) file.write(dump)
  return {
    load: () => game,
    save(data) { game = data; file.write(dump) },
    flush() { file.flush() },
    history: () => history,
    addHistory(record) { history = [...history, record].slice(-50); file.write(dump) },
    log: text => console.log(`[${room().code}] ${text}`)
  }
}

function open(code: string, hostKey: string | null, saved: RoomFile | null): Room {
  const room: Room = { code, hostKey, createdAt: saved?.createdAt ?? Date.now(), touchedAt: saved?.touchedAt ?? Date.now(), peers: new Set(), game: null as unknown as Game }
  const store = hostKey ? roomStore(() => room, saved) : localStore()
  room.game = new Game(() => {
    room.touchedAt = Date.now()
    for (const fn of listeners) fn(room)
  }, store)
  rooms.set(code, room)
  return room
}

/** Новая комната для экрана; null — сервер заполнен */
export function createRoom(): Room | null {
  if (rooms.size >= MAX_ROOMS) sweep(true)
  if (rooms.size >= MAX_ROOMS) return null
  let code = ''
  do { code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('') }
  while (rooms.has(code) || existsSync(roomFile(code)))
  const room = open(code, randomBytes(18).toString('base64url'), null)
  console.log(`комната ${code} открыта · всего ${rooms.size}`)
  return room
}

function close(room: Room) {
  room.game.dispose()
  rooms.delete(room.code)
  if (room.hostKey) {
    try { unlinkSync(roomFile(room.code)) } catch { /* уже нет */ }
  }
}

/** Закрывает брошенные комнаты. force — сервер заполнен: закрыть и те, что просто стоят без людей. */
function sweep(force = false) {
  const now = Date.now()
  for (const room of rooms.values()) {
    if (!room.hostKey || room.peers.size) continue
    const idle = now - room.touchedAt
    const quiet = ['menu', 'lobby', 'final'].includes(room.game.screen)
    const limit = force ? (quiet ? 10 * 60_000 : 2 * HOUR) : quiet ? 3 * HOUR : 12 * HOUR
    if (idle > limit) {
      close(room)
      console.log(`комната ${room.code} закрыта: пустая ${Math.round(idle / 60_000)} мин`)
    }
  }
}

export function touch(room: Room) { room.touchedAt = Date.now() }

/** Все отложенные снимки — на диск (перед остановкой сервера) */
export function flushAll() {
  for (const room of rooms.values()) room.game.dispose()
}

/* ── старт ──────────────────────────────────────────────────── */

export function initRooms() {
  if (rooms.size) return
  if (!IS_PUBLIC) {
    open(LOCAL_ROOM, null, null)
    return
  }
  let restored = 0
  try {
    for (const name of existsSync(ROOM_DIR) ? readdirSync(ROOM_DIR) : []) {
      if (!name.endsWith('.json')) continue
      const file = join(ROOM_DIR, name)
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as RoomFile
        if (!normalizeCode(saved.code) || typeof saved.hostKey !== 'string' || Date.now() - saved.touchedAt > 24 * HOUR) {
          unlinkSync(file)
          continue
        }
        open(saved.code, saved.hostKey, saved)
        restored++
      } catch { try { unlinkSync(file) } catch { /* не удалось — не страшно */ } }
    }
  } catch (e) { console.warn('комнаты не прочитались:', (e as Error).message) }
  console.log(`режим «в сети»: комнат восстановлено ${restored}, предел ${MAX_ROOMS}`)
  const t = setInterval(() => sweep(), 5 * 60_000)
  t.unref?.()
}
