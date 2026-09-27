/* Статистика для владельца — из того, что и так лежит на диске, без отдельной базы: снимки комнат (DATA_DIR/rooms,
   история последних 50 партий в каждой) и партии «Тумана» (DATA_DIR/solo/<история>/<жетон>.json). Сколько живут файлы —
   см. rooms.ts (ROOM_KEEP_DAYS, 90 дней; пустые — 3) и _solo.ts (SOLO_KEEP_DAYS, год): статистика видит ровно этот срок.
   Места и концовки «Тумана» не называются — только доля пройденного (страница без спойлеров) */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './data-dir'
import { CASES, SETTINGS, SOLO_STORIES } from '../scenario/index'
import type { GameRecord } from '../../shared/types'

const DAY = 86_400_000
const LIVE_MS = 20 * 60_000
/** экраны, где партия идёт */
const PLAYING = new Set(['tutorial', 'prologue', 'plan', 'resolve', 'field', 'discuss', 'accuse', 'verdict'])
const SCREEN: Record<string, string> = {
  menu: 'меню', lobby: 'лобби', tutorial: 'обучение', prologue: 'пролог', plan: 'ход', resolve: 'разбор хода', field: 'поиск на время',
  discuss: 'совещание', accuse: 'обвинение', verdict: 'приговор', epilogue: 'эпилог', final: 'финал'
}

interface RoomFile { code: string; createdAt: number; touchedAt: number; history?: GameRecord[]; game?: { screen?: string; caseId?: string; players?: Record<string, { name?: string }> | { name?: string }[]; round?: number; roundsTotal?: number } }

const readJson = <T>(file: string): T | null => { try { return JSON.parse(readFileSync(file, 'utf8')) as T } catch { return null } }
const caseTitle = (id?: string) => {
  const c = id ? CASES[id] : undefined
  return c ? `${c.info.title} · ${SETTINGS[c.info.settingId]?.title ?? c.info.settingId}` : id ?? '—'
}
function dirSize(dir: string): number {
  let n = 0
  try { for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? dirSize(join(dir, e.name)) : statSync(join(dir, e.name)).size } catch { /* нет папки */ }
  return n
}

export function collectStats() {
  const now = Date.now()
  const within = (t: number | undefined, days: number) => !!t && now - t < days * DAY

  /* ── комнаты и партии детективов ── */
  const roomDir = join(DATA_DIR, 'rooms')
  const rooms = (existsSync(roomDir) ? readdirSync(roomDir) : []).filter(f => f.endsWith('.json')).map(f => readJson<RoomFile>(join(roomDir, f))).filter((r): r is RoomFile => !!r?.code)
  const games = rooms.flatMap(r => (r.history ?? []).map(h => ({ ...h, room: r.code, at: Date.parse(h.finishedAt) || 0 })))
  const byCase = new Map<string, { title: string; games: number; solved: number; partial: number; failed: number; minutes: number; players: number }>()
  for (const g of games) {
    const c = byCase.get(g.caseId) ?? { title: caseTitle(g.caseId), games: 0, solved: 0, partial: 0, failed: 0, minutes: 0, players: 0 }
    c.games++; c[g.outcome]++; c.minutes += g.minutes || 0; c.players += g.players?.length ?? 0
    byCase.set(g.caseId, c)
  }
  const players = (r: RoomFile) => {
    const p = r.game?.players
    return (Array.isArray(p) ? p : Object.values(p ?? {})).map(x => x?.name).filter((x): x is string => !!x)
  }
  const roomRows = [...rooms].sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0)).slice(0, 40).map(r => {
    const screen = r.game?.screen ?? 'menu'
    return {
      code: r.code, createdAt: r.createdAt, touchedAt: r.touchedAt, case: r.game?.caseId && screen !== 'menu' ? caseTitle(r.game.caseId) : null,
      screen: SCREEN[screen] ?? screen, live: PLAYING.has(screen) && now - (r.touchedAt || 0) < LIVE_MS,
      round: PLAYING.has(screen) && r.game?.roundsTotal ? `${(r.game.round ?? 0) + 1} из ${r.game.roundsTotal}` : null,
      players: players(r), finished: r.history?.length ?? 0
    }
  })

  /* ── «Туман» ── */
  const soloDir = join(DATA_DIR, 'solo')
  const stories = (existsSync(soloDir) ? readdirSync(soloDir, { withFileTypes: true }) : []).filter(d => d.isDirectory()).map(d => d.name)
  const solo = stories.map(id => {
    const total = SOLO_STORIES[id]?.story.places.length ?? 0
    const files = readdirSync(join(soloDir, id)).filter(f => f.endsWith('.json') && f !== 'transfers.json')
    const runs = files.map(f => {
      const file = join(soloDir, id, f)
      const d = readJson<{ run?: { visited?: string[]; playMs?: number; deaths?: number; kills?: number; ending?: string | null } | null }>(file)
      const r = d?.run
      return { at: statSync(file).mtimeMs, started: !!r && ((r.playMs ?? 0) > 0 || (r.visited?.length ?? 0) > 1), minutes: Math.round((r?.playMs ?? 0) / 60000), progress: total && r?.visited ? Math.round((r.visited.length / total) * 100) : 0, deaths: r?.deaths ?? 0, kills: r?.kills ?? 0, ended: !!r?.ending }
    })
    const started = runs.filter(r => r.started)
    return {
      id, title: SOLO_STORIES[id]?.info.title ?? id,
      saves: runs.length, started: started.length, ended: started.filter(r => r.ended).length,
      day: started.filter(r => within(r.at, 1)).length, week: started.filter(r => within(r.at, 7)).length,
      avgMinutes: started.length ? Math.round(started.reduce((s, r) => s + r.minutes, 0) / started.length) : 0,
      recent: started.sort((a, b) => b.at - a.at).slice(0, 20)
    }
  })

  const inbox = join(DATA_DIR, 'telegram', 'inbox.jsonl')
  let feedback: number | null = null
  try { if (existsSync(inbox)) feedback = readFileSync(inbox, 'utf8').split('\n').filter(Boolean).length } catch { /* нет журнала */ }

  return {
    now,
    rooms: {
      total: rooms.length, created: { day: rooms.filter(r => within(r.createdAt, 1)).length, week: rooms.filter(r => within(r.createdAt, 7)).length, month: rooms.filter(r => within(r.createdAt, 30)).length },
      live: roomRows.filter(r => r.live).length, rows: roomRows
    },
    games: {
      total: games.length, week: games.filter(g => within(g.at, 7)).length, month: games.filter(g => within(g.at, 30)).length,
      solved: games.filter(g => g.outcome === 'solved').length,
      byCase: [...byCase.values()].sort((a, b) => b.games - a.games),
      recent: games.sort((a, b) => b.at - a.at).slice(0, 20).map(g => ({ at: g.at, case: caseTitle(g.caseId), outcome: g.outcome, players: g.players?.length ?? 0, minutes: g.minutes, room: g.room }))
    },
    solo,
    feedback,
    storage: {
      bytes: dirSize(DATA_DIR),
      keep: { rooms: Math.max(1, Number(process.env.ROOM_KEEP_DAYS) || 90), emptyRooms: 3, roomHistory: 50, solo: Math.max(30, Number(process.env.SOLO_KEEP_DAYS) || 365) }
    }
  }
}
export type Stats = ReturnType<typeof collectStats>
