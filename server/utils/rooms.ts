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
  /** ПИН из четырёх цифр: вход телефона по коду без QR и продолжение комнаты с другого экрана; дома нет */
  pin: string | null
  /** секрет в ссылке QR: кто отсканировал код с экрана, входит без ПИНа */
  pass: string | null
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

/** комната в памяти — или поднятая с диска: партию можно продолжить и через неделю, с другого экрана и телефонов */
export function getRoom(code: string | null | undefined): Room | undefined {
  if (!code) return undefined
  return rooms.get(code) ?? (IS_PUBLIC ? loadRoom(code) : undefined)
}

function readRoomFile(code: string): RoomFile | null {
  const file = roomFile(code)
  if (!existsSync(file)) return null
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as RoomFile
    return saved.code === code && typeof saved.hostKey === 'string' ? saved : null
  } catch { return null }
}

function loadRoom(code: string): Room | undefined {
  if (!CODE.test(code)) return undefined
  const saved = readRoomFile(code)
  if (!saved) return undefined
  if (rooms.size >= MAX_ROOMS) sweep(true)
  if (rooms.size >= MAX_ROOMS) return undefined
  const room = open(code, saved.hostKey, saved)
  room.touchedAt = Date.now()
  console.log(`комната ${code} поднята с диска · всего ${rooms.size}`)
  return room
}

export function verifyHost(room: Room, key: unknown): boolean {
  if (!room.hostKey || typeof key !== 'string') return false
  const a = Buffer.from(room.hostKey), b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function roomCount() { return rooms.size }

const same = (a: string | null, b: unknown) => {
  if (!a || typeof b !== 'string') return false
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
/** комната без ПИНа (дома) пускает всех */
export function verifyPin(room: Room, pin: unknown) { return !room.pin || same(room.pin, typeof pin === 'string' ? pin.replace(/\D/g, '') : pin) }
export function verifyPass(room: Room, pass: unknown) { return !room.pass || same(room.pass, pass) }
const newPin = () => String(randomInt(0, 10000)).padStart(4, '0')
const newPass = () => randomBytes(9).toString('base64url')

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

interface RoomFile { code: string; hostKey: string; pin?: string; pass?: string; createdAt: number; touchedAt: number; history: GameRecord[]; game: unknown }

/** В сети: один файл на комнату — ключ экрана, история этой комнаты и снимок партии */
function roomStore(room: () => Room, saved: RoomFile | null): GameStore {
  const file = new LaterFile(roomFile(saved?.code ?? room().code))
  let history: GameRecord[] = saved?.history ?? []
  let game: unknown = saved?.game ?? null
  const dump = () => {
    const r = room()
    const data: RoomFile = { code: r.code, hostKey: r.hostKey!, pin: r.pin ?? undefined, pass: r.pass ?? undefined, createdAt: r.createdAt, touchedAt: r.touchedAt, history, game }
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
  const room: Room = { code, hostKey, pin: hostKey ? saved?.pin ?? newPin() : null, pass: hostKey ? saved?.pass ?? newPass() : null, createdAt: saved?.createdAt ?? Date.now(), touchedAt: saved?.touchedAt ?? Date.now(), peers: new Set(), game: null as unknown as Game }
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

/** выгружает комнату из памяти; снимок остаётся на диске и поднимется по коду с ПИНом или ключом экрана */
function unload(room: Room) {
  room.game.dispose()
  rooms.delete(room.code)
}
/** то же снаружи (проверки): комната без людей уходит из памяти, файл остаётся */
export function unloadRoom(code: string) { const r = rooms.get(code); if (r && !r.peers.size) unload(r) }

/** Выгружает брошенные комнаты из памяти. force — сервер заполнен: выгрузить и те, что просто стоят без людей. */
function sweep(force = false) {
  const now = Date.now()
  for (const room of rooms.values()) {
    if (!room.hostKey || room.peers.size) continue
    const idle = now - room.touchedAt
    const quiet = ['menu', 'lobby', 'final'].includes(room.game.screen)
    const limit = force ? (quiet ? 10 * 60_000 : 2 * HOUR) : quiet ? 3 * HOUR : 12 * HOUR
    if (idle > limit) {
      unload(room)
      console.log(`комната ${room.code} выгружена: пустая ${Math.round(idle / 60_000)} мин`)
    }
  }
}

/** Файлы комнат живут KEEP_DAYS с последнего действия; комната, в которой так и не начали партию, — KEEP_EMPTY_DAYS */
const KEEP_DAYS = Math.max(1, Number(process.env.ROOM_KEEP_DAYS) || 30)
const KEEP_EMPTY_DAYS = 3
function purgeFiles() {
  let gone = 0
  try {
    for (const name of existsSync(ROOM_DIR) ? readdirSync(ROOM_DIR) : []) {
      if (!name.endsWith('.json')) continue
      const code = name.slice(0, -5)
      if (rooms.has(code)) continue
      const file = join(ROOM_DIR, name)
      let drop = false
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as RoomFile
        const age = Date.now() - (saved.touchedAt || 0)
        const empty = !saved.history?.length && (!saved.game || (saved.game as { screen?: string }).screen === 'menu')
        drop = !normalizeCode(saved.code) || typeof saved.hostKey !== 'string' || age > KEEP_DAYS * 24 * HOUR || (empty && age > KEEP_EMPTY_DAYS * 24 * HOUR)
      } catch { drop = true }
      if (drop) { try { unlinkSync(file); gone++ } catch { /* не удалось — не страшно */ } }
    }
  } catch (e) { console.warn('файлы комнат не прочитались:', (e as Error).message) }
  if (gone) console.log(`комнат стёрто с диска: ${gone}`)
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
  // старые файлы — прочь; свежие (сутки) комнаты поднимаются сразу, остальные лежат на диске и поднимутся по коду
  purgeFiles()
  let restored = 0, kept = 0
  try {
    for (const name of existsSync(ROOM_DIR) ? readdirSync(ROOM_DIR) : []) {
      if (!name.endsWith('.json')) continue
      const saved = readRoomFile(name.slice(0, -5))
      if (!saved) continue
      if (Date.now() - saved.touchedAt > 24 * HOUR) { kept++; continue }
      open(saved.code, saved.hostKey, saved)
      restored++
    }
  } catch (e) { console.warn('комнаты не прочитались:', (e as Error).message) }
  console.log(`режим «в сети»: комнат поднято ${restored}, на диске ещё ${kept}, предел в памяти ${MAX_ROOMS}`)
  const t = setInterval(() => sweep(), 5 * 60_000)
  t.unref?.()
  const p = setInterval(() => purgeFiles(), 6 * HOUR)
  p.unref?.()
}
