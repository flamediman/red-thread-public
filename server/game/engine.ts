/* Движок «Красной нити»: раунды, ходы, доска, обвинение. Один экземпляр — одна комната.
   Разгадка приходит из сценария; наружу уходит только публичный срез. */
import { existsSync, readFileSync } from 'node:fs'
import { randomInt } from 'node:crypto'
import { CASES, DEFAULT_CASE, SETTINGS, catalog, type CaseEntry } from '../scenario'
import type { GameStore } from './store'
import { INKS } from '../../shared/inks'
import { TUTORIAL_STEPS } from '../../shared/tutorial'
import { honestBeatId } from '../../shared/types'
import type {
  Beat, BoardCard, BoardLink, BoardQuestion, CaseInfo, ClientMessage, DetectiveRole, Fact, FieldBusy, FieldFeedEntry, FieldLogEntry, FieldMoment, FieldState, FieldWalk,
  GameRecord, HonestAnswer, Item, Location, LocationOptions, PlanAction, PlanSummary, Presentation, PublicState, Question, Scenario, Screen, Spot, Verdict, Witness, YouState
} from '../../shared/types'

const PLAN_MS = 90_000
const ACCUSE_MS = 120_000
/* Режим «на время»: сколько настоящего времени занимает шаг и действие */
const FIELD_STEP_MS = 5000          // соседнее место на том же этаже
const FIELD_FLOOR_MS = 8000         // лестница: другой этаж
const FIELD_SEARCH_MS = 8000
const FIELD_SECOND_MS = 10_000      // второй, внимательный осмотр
const FIELD_TALK_MS = 5000
const FIELD_ABILITY_MS = 4000
const FIELD_FORCE_MS = 4000         // взлом замка — сверх осмотра
const FIELD_WRONG_MS = 15_000       // неподходящая карточка на вопросе доски
const FIELD_COOLDOWN_MS = 8_000     // вопрос «остывает» после неподходящей карточки
const FIELD_ACCUSE_PENALTY_MS = 5 * 60_000
const FIELD_FEED = 40, FIELD_LOG = 40, FIELD_MOMENTS = 8
const FIELD_FRESH_MS = 2 * 60_000   // «новое» у вопроса, открывшегося за последние две минуты
/* Баланс по составу. Ходов за партию = сыщики × раунды: двое — 36, шестеро — 84, десятеро — 100.
   Разбор растёт с числом сыщиков, поэтому у больших бригад раундов меньше — партия остаётся в 75–90 минутах. */
const SMALL_BRIGADE = 3
function roundsFor(n: number) { return n <= 2 ? 18 : n <= 3 ? 16 : n <= 6 ? 14 : n <= 8 ? 12 : n <= 9 ? 11 : 10 }
function discussMsFor(n: number) { return (n <= 3 ? 120 : n <= 4 ? 150 : n <= 7 ? 180 : n <= 9 ? 210 : 240) * 1000 }
const clockMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number) as [number, number]; return h * 60 + m }
const nightMinutes = (S: Scenario) => (clockMinutes(S.clock.dawn) + 24 * 60 - clockMinutes(S.clock.start)) % (24 * 60)
/** метка сборки: из окружения или из файла, который пишет Dockerfile; клиенты перезагружаются при смене */
const BUILD = process.env.BUILD_ID || (existsSync('/app/build-id') ? readFileSync('/app/build-id', 'utf8').trim() : 'dev')

interface PlayerRecord {
  id: string
  token: string
  name: string
  ink: number
  photo: number | null
  connected: boolean
  ready: boolean
  order: number
  detectiveId: string | null
  locationId: string
  usesLeft: number | null
  plan: { locationId: string; action: PlanAction } | null
  /** способность со счётчиком, выбранная сверх хода */
  bonus: PlanAction | null
  /** режим «на время»: путь, текущее действие и личный журнал */
  walk?: FieldWalk | null
  busy?: (FieldBusy & { action: PlanAction }) | null
  log?: FieldLogEntry[]
}

interface BoardEntry { by: string; round: number; witnessId?: string; locationId?: string; verdict?: { lie: boolean; by: string }; time?: string }

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
/** тип недостающей карточки — как на фильтрах доски */
const KIND_HINT: Record<string, string> = { physical: 'следы и предметы', testimony: 'показания', timeline: 'время', background: 'прошлое' }

/** Способности со счётчиком — действие сверх хода: какой тип действия у какой роли */
const BONUS_OF: Record<string, PlanAction['type']> = {
  drone: 'drone', patrol: 'ask', reporter: 'reporter', intern: 'intern', fixer: 'fixer', archivist: 'archivist', tracker: 'verify', coroner: 'coroner'
}
const BONUS_TYPES = new Set<string>(['drone', 'reporter', 'intern', 'fixer', 'archivist', 'verify', 'coroner'])

function uid(n = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < n; i++) s += abc[randomInt(abc.length)]
  return s
}
const TOKEN = /^[a-z0-9]{6,32}$/

/** Резервный таймер сцены — с запасом: озвучка медленнее, чем 62 мс на знак, а экран сам шлёт beatsDone. */
function estimateBeatsMs(beats: Beat[]) {
  return beats.reduce((ms, b) => ms + 2500 + b.text.length * 90 + (b.pauseAfter ?? 0), 0) + 4000
}

const byId = <T extends { id: string }>(arr: T[]) => new Map(arr.map(x => [x.id, x]))

/** Связка активного дела: сценарий и быстрые карты по id. Дело выбирается в меню, движок один. */
interface Bundle {
  info: CaseInfo; S: Scenario
  DET: Map<string, DetectiveRole>; LOC: Map<string, Location>; WIT: Map<string, Witness>; SPOT: Map<string, Spot>
  ITEM: Map<string, Item>; Q: Map<string, Question>; FACT: Map<string, Fact>
  /** факт → вещдок, который находят вместе с ним: на доске у такой карточки фото вещи */
  FACT_ITEM: Map<string, string>
  /** чьи слова кладут карточку: вопрос или предъявление по id факта */
  SRC: Map<string, Question | Presentation>
  night: number
}
function factItems(S: Scenario) {
  const out = new Map<string, string>()
  const finds = [...S.spots.flatMap(s => [s.primary, s.hidden, s.memory]), ...(S.events ?? [])]
  for (const f of finds) if (f?.factId && f.itemId && !out.has(f.factId)) out.set(f.factId, f.itemId)
  return out
}
function bundle(entry: CaseEntry): Bundle {
  const S = entry.scenario
  return { info: entry.info, S, DET: byId(S.detectives), LOC: byId(S.locations), WIT: byId(S.witnesses), SPOT: byId(S.spots), ITEM: byId(S.items), Q: byId(S.questions), FACT: byId(S.facts), FACT_ITEM: factItems(S), SRC: new Map([...S.questions, ...S.presentations].filter(x => x.factId).map(x => [x.factId!, x])), night: nightMinutes(S) }
}
const shuffle = <T>(arr: T[]) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!] } return a }

export class Game {
  private onChange: () => void
  private timer: ReturnType<typeof setInterval>

  private b: Bundle = bundle(CASES[DEFAULT_CASE]!)
  get S() { return this.b.S }
  loadCase(id: string) { const e = CASES[id]; if (e) this.b = bundle(e) }
  /** бригада начинает ночь там, где собирается на совещания (у каждого дела своё место) */
  private startLoc() { return this.b.info.stage.discuss }

  players = new Map<string, PlayerRecord>()
  screen: Screen = 'menu'
  round = 0
  roundsTotal = roundsFor(6)
  /** сколько сыщиков начинало партию — от этого зависят раунды, совещания и правило маленькой бригады */
  brigade = 0
  phaseMs: number | null = null
  /** когда началась партия — для длительности в истории */
  startedAt = 0
  deadline: number | null = null
  paused = false
  pauseLeft = 0
  settings: PublicState['settings'] = { hints: 'soft', stepping: 'manual', roles: 'pick', timers: 'on', tutorial: 'on', duration: '45' }
  tutorialStep = 0

  board = new Map<string, BoardEntry>()
  /** карточки, которые команда отметила как важные */
  pins = new Set<string>()
  links = new Set<string>()
  items = new Set<string>()
  searched = new Set<string>()
  hiddenDone = new Set<string>()
  /** прочитанные записи памяти */
  memoryDone = new Set<string>()
  asked = new Set<string>()
  presented = new Set<string>()
  unlocked = new Set<string>()
  greeted = new Set<string>()
  lieMarks = new Map<string, Record<string, boolean>>()
  /** кого каким противоречием уже уличали: «свидетель:противоречие» */
  confronted = new Set<string>()
  /** сколько раз перед свидетелем уже клали карточку-доказательство: реплики не повторяются */
  proofs = new Map<string, number>()
  /** когда вопрос впервые стал доступен: шаг партии (раунд×2, разбор — нечётный) и время («на время») — для пометки «новое» */
  openedAt = new Map<string, { step: number; at: number }>()

  private _beats: Beat[] = []
  /** какая реплика сейчас на экране — ведущий сообщает, чтобы после перезагрузки продолжить с неё */
  beatIndex = 0
  get beats() { return this._beats }
  set beats(v: Beat[]) { this._beats = v; this.beatIndex = 0 }
  proceedVotes = new Set<string>()
  accusation: PublicState['accusation'] = null
  verdict: Verdict | null = null
  attemptsLeft = 2
  hintsUsed = 0
  hintsFired = new Set<number>()
  /** какие события ночи уже случились */
  eventsFired = new Set<number>()
  /** после верного обвинения: чем закончилось */
  outcome: 'solved' | 'partial' | 'failed' | null = null

  /* режим «на время» */
  fieldTotalMs = 0
  fieldPenaltyMs = 0
  /** сколько оставалось до конца поиска, когда бригада пошла обвинять */
  fieldLeftMs = 0
  solved = new Set<string>()
  solveCooldown = new Map<string, number>()
  /** карточки, приколотые к вопросам доски (по одной, каждая проверена) */
  qpins = new Map<string, string[]>()
  /** места осмотра, которых больше нет */
  gone = new Set<string>()
  /** запертые места, которые вскрыли способностью */
  openedLocs = new Set<string>()
  feed: FieldFeedEntry[] = []
  moments: FieldMoment[] = []
  private seq = 0
  private pausedAt = 0

  private store: GameStore

  constructor(onChange: () => void, store: GameStore) {
    this.onChange = onChange
    this.store = store
    this.restore()
    this.timer = setInterval(() => this.tick(), 250)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /* ── игроки ─────────────────────────────────────────────────── */

  join(token: string | undefined, name: string, ink: number) {
    if (token) {
      const existing = [...this.players.values()].find(p => p.token === token)
      if (existing) {
        existing.connected = true
        if (name) existing.name = name
        this.emit()
        return existing
      }
    }
    if (this.players.size >= 10) return null
    const id = uid(6)
    const used = new Set([...this.players.values()].map(p => p.ink))
    let chosen = ink
    if (chosen == null || chosen < 0 || chosen >= INKS.length || used.has(chosen)) {
      chosen = INKS.findIndex((_, i) => !used.has(i))
      if (chosen < 0) chosen = this.players.size % INKS.length
    }
    const player: PlayerRecord = {
      id, token: token && TOKEN.test(token) ? token : uid(16), name: name || 'Сыщик', ink: chosen, photo: null,
      connected: true, ready: false, order: this.players.size,
      detectiveId: null, locationId: this.startLoc(), usesLeft: null, plan: null, bonus: null, walk: null, busy: null, log: []
    }
    this.players.set(id, player)
    this.emit()
    return player
  }

  rename(id: string, name: string, ink: number) {
    const p = this.players.get(id)
    if (!p) return
    if (name) p.name = name.slice(0, 14)
    const taken = [...this.players.values()].some(o => o.id !== id && o.ink === ink)
    if (!taken && ink >= 0 && ink < INKS.length) p.ink = ink
    this.emit()
  }

  setConnected(id: string, connected: boolean) {
    const p = this.players.get(id)
    if (!p) return
    p.connected = connected
    this.emit()
  }

  remove(id: string): string | null {
    const token = this.players.get(id)?.token ?? null
    this.players.delete(id)
    this.emit()
    return token
  }

  tokenOf(id: string) { return this.players.get(id)?.token ?? null }
  byToken(token: string) { return [...this.players.values()].find(p => p.token === token) ?? null }

  setReady(id: string, ready: boolean) {
    const p = this.players.get(id)
    if (!p || p.ready === ready) return
    p.ready = ready
    this.emit()
  }

  markPhoto(id: string) {
    const p = this.players.get(id)
    if (!p) return null
    p.photo = (p.photo ?? 0) + 1
    this.emit()
    return p.photo
  }

  pickDetective(id: string, detectiveId: string | null) {
    const p = this.players.get(id)
    if (!p || this.screen !== 'lobby' || this.settings.roles === 'random') return
    if (detectiveId === null) { p.detectiveId = null; p.usesLeft = null; this.emit(); return }
    const d = this.b.DET.get(detectiveId)
    if (!d) return
    const takenBy = [...this.players.values()].find(o => o.id !== id && o.detectiveId === detectiveId)
    if (takenBy) return
    p.detectiveId = d.id
    p.usesLeft = d.ability.uses
    this.emit()
  }

  private roleOf(p: PlayerRecord): DetectiveRole | null {
    return p.detectiveId ? this.b.DET.get(p.detectiveId) ?? null : null
  }

  /** Способность сверх хода: только своя, только пока остались использования */
  private setBonus(p: PlayerRecord, action: PlanAction) {
    const kind = this.roleOf(p)?.ability.kind
    if (!kind || (p.usesLeft ?? 0) <= 0) return
    const fits = kind === 'patrol' ? action.type === 'ask' || action.type === 'present' : BONUS_OF[kind] === action.type
    if (!fits) return
    p.bonus = action.type === 'ask' || action.type === 'present' ? { ...action, remote: true } as PlanAction : action
    this.emit()
  }

  /* ── ведущий ────────────────────────────────────────────────── */

  handleHost(msg: ClientMessage) {
    switch (msg.type) {
      case 'settings': {
        const allowed: Record<string, string[]> = { hints: ['soft', 'off'], stepping: ['manual', 'auto'], roles: ['pick', 'random'], timers: ['on', 'off'], tutorial: ['on', 'off'], duration: ['30', '45', '60'] }
        const next = { ...this.settings } as Record<string, string>
        for (const [k, v] of Object.entries(msg.settings ?? {})) if (allowed[k]?.includes(v as string)) next[k] = v as string
        this.settings = next as PublicState['settings']
        this.emit()
        break
      }
      case 'tutorial':
        if (this.screen !== 'tutorial' || typeof msg.step !== 'number') break
        if (msg.step >= TUTORIAL_STEPS) { this.beginPrologue(); break }
        this.tutorialStep = Math.max(0, Math.floor(msg.step))
        this.emit()
        break
      case 'start': this.start(); break
      case 'pause': this.setPaused(msg.paused); break
      case 'skip': this.onDeadline(true); break
      case 'restart': this.reset(); break
      case 'selectCase':
        if (this.screen !== 'menu' && this.screen !== 'lobby') break
        this.loadCase(msg.caseId); this.reset(); break
      case 'toMenu':
        if (this.screen !== 'lobby' && this.screen !== 'final') break
        this.reset(); this.screen = 'menu'; this.emit(); break
      case 'kick': this.remove(msg.playerId); break
      case 'beatAt':
        // позиция принимается, только если реплика та же — запоздавшее сообщение от прошлой сцены игнорируется
        if (this.beats[msg.index]?.id !== msg.beatId) break
        this.beatIndex = msg.index
        // экран дошёл до этой реплики — сдвигаем резервный таймер, чтобы сервер не оборвал сцену на полуслове
        if (!this.paused && this.deadline !== null && ['prologue', 'resolve', 'verdict', 'epilogue'].includes(this.screen)) this.deadline = Date.now() + estimateBeatsMs(this.beats.slice(this.beatIndex))
        // телефоны открывают карточки доски вместе с репликой на экране — им нужна позиция
        if (this.beats[msg.index]?.facts?.length || this.beats[msg.index]?.links?.length) this.emit()
        else this.persist()
        break
      case 'beatsDone':
        if (this.screen === 'prologue' || this.screen === 'resolve' || this.screen === 'verdict' || this.screen === 'epilogue') this.onDeadline(true)
        break
    }
  }

  private setPaused(paused: boolean) {
    if (this.paused === paused) return
    const now = Date.now()
    if (paused) {
      this.pauseLeft = this.deadline ? Math.max(0, this.deadline - now) : 0
      this.pausedAt = now
    } else {
      if (this.deadline) this.deadline = now + this.pauseLeft
      // «на время»: пути, действия и остывание вопросов стояли вместе с часами
      const shift = this.pausedAt ? now - this.pausedAt : 0
      if (shift > 0) {
        for (const p of this.players.values()) {
          if (p.walk) p.walk = { ...p.walk, startedAt: p.walk.startedAt + shift }
          if (p.busy) p.busy = { ...p.busy, startedAt: p.busy.startedAt + shift, until: p.busy.until + shift }
        }
        for (const [q, t] of this.solveCooldown) this.solveCooldown.set(q, t + shift)
      }
      this.pausedAt = 0
    }
    this.paused = paused
    this.emit()
  }

  private reset() {
    for (const p of this.players.values()) {
      p.ready = false; p.detectiveId = null; p.usesLeft = null; p.plan = null; p.bonus = null; p.locationId = this.startLoc()
      p.walk = null; p.busy = null; p.log = []
    }
    this.fieldTotalMs = 0; this.fieldPenaltyMs = 0; this.fieldLeftMs = 0; this.solved.clear(); this.solveCooldown.clear()
    this.gone.clear(); this.openedLocs.clear(); this.feed = []; this.moments = []; this.seq = 0
    // длительность поиска по умолчанию — из дела
    const minutes = String(this.S.realtime?.minutes ?? '')
    if (this.realtime && ['30', '45', '60'].includes(minutes)) this.settings = { ...this.settings, duration: minutes as PublicState['settings']['duration'] }
    this.screen = 'lobby'
    this.round = 0
    this.deadline = null
    this.paused = false
    this.board.clear(); this.pins.clear(); this.links.clear(); this.items.clear()
    this.searched.clear(); this.hiddenDone.clear(); this.memoryDone.clear(); this.asked.clear(); this.presented.clear()
    this.unlocked.clear(); this.greeted.clear(); this.lieMarks.clear(); this.confronted.clear(); this.proofs.clear(); this.openedAt.clear(); this.tutorialStep = 0
    this.beats = []; this.proceedVotes.clear(); this.accusation = null; this.verdict = null
    this.attemptsLeft = 2; this.hintsUsed = 0; this.hintsFired.clear(); this.eventsFired.clear(); this.outcome = null
    this.emit()
  }

  private start() {
    if (this.screen !== 'lobby') return
    const roster = [...this.players.values()]
    if (roster.length < 2) return
    // кто не выбрал сыщика — получает свободного
    if (this.settings.roles === 'random') { for (const p of roster) { p.detectiveId = null; p.usesLeft = null } }
    const free = (this.settings.roles === 'random' ? shuffle(this.S.detectives) : this.S.detectives).filter(d => !roster.some(p => p.detectiveId === d.id))
    for (const p of roster) {
      if (!p.detectiveId) { const d = free.shift(); if (d) { p.detectiveId = d.id; p.usesLeft = d.ability.uses } }
      p.ready = false; p.plan = null; p.bonus = null; p.locationId = this.startLoc()
    }
    this.brigade = roster.length
    this.startedAt = Date.now()
    // «на время»: расписания свидетелей идут по отрезкам времени, а не по раундам
    this.roundsTotal = this.realtime ? Math.max(1, this.S.scheduleLength) : roundsFor(roster.length)
    this.round = 0
    if (this.settings.tutorial === 'on') {
      // обучение ведёт ведущий кнопкой «Дальше»: сервер не торопит
      this.screen = 'tutorial'
      this.tutorialStep = 0
      this.beats = []
      this.phaseMs = null
      this.deadline = null
      this.emit()
      return
    }
    this.beginPrologue()
  }

  private beginPrologue() {
    this.screen = 'prologue'
    this.beats = this.S.prologue
    this.phaseMs = null
    this.deadline = Date.now() + estimateBeatsMs(this.beats)
    this.emit()
  }

  /* ── таймер и переходы ──────────────────────────────────────── */

  private tick() {
    if (this.paused) return
    if (this.screen === 'field') this.fieldTick(Date.now())
    if (!this.deadline) return
    if (Date.now() >= this.deadline) this.onDeadline(false)
  }

  private onDeadline(forced: boolean) {
    switch (this.screen) {
      case 'tutorial':
        if (!forced) break
        if (this.tutorialStep + 1 >= TUTORIAL_STEPS) this.beginPrologue()
        else { this.tutorialStep++; this.emit() }
        break
      case 'prologue': if (this.realtime) this.beginField(); else this.beginPlan(); break
      // «Дальше» с пульта поиск не обрывает: обвинение открывают сами сыщики или конец времени
      case 'field': if (!forced) this.openAccusation('dawn'); break
      case 'plan': this.resolve(); break
      case 'resolve': this.beginDiscuss(); break
      case 'discuss': this.nextRound(); break
      case 'accuse': this.judge(); break
      case 'verdict': this.afterVerdict(); break
      case 'epilogue': this.screen = 'final'; this.deadline = null; this.recordGame(); this.emit(); break
      default: if (forced) this.emit()
    }
  }

  private beginPlan() {
    this.screen = 'plan'
    for (const p of this.players.values()) { p.plan = null; p.bonus = null }
    this.proceedVotes.clear()
    this.beats = []
    // без таймеров фаза ждёт, пока все выберут ход (или ведущий нажмёт «Дальше»)
    this.phaseMs = this.settings.timers === 'on' ? PLAN_MS : null
    this.deadline = this.phaseMs ? Date.now() + this.phaseMs : null
    this.emit()
  }

  private beginDiscuss() {
    this.screen = 'discuss'
    this.beats = []
    this.proceedVotes.clear()
    this.phaseMs = this.settings.timers === 'on' ? discussMsFor(this.brigade || this.players.size) : null
    this.deadline = this.phaseMs ? Date.now() + this.phaseMs : null
    this.emit()
  }

  /** маленькая бригада: до трёх сыщиков — второй слой места открывается с первого осмотра */
  private get smallBrigade() { return (this.screen === 'lobby' ? this.players.size : this.brigade) <= SMALL_BRIGADE }

  private nextRound() {
    if (this.round + 1 >= this.roundsTotal) {
      // рассвет: обвинять обязательно
      this.openAccusation('dawn')
      return
    }
    this.round++
    this.beginPlan()
  }

  /** часы идут от начала ночи к рассвету равными шагами, сколько бы ни было раундов; округление до 5 минут */
  /** партия окончена — в историю дел */
  private recordGame() {
    const players = [...this.players.values()].sort((a, b) => a.order - b.order).map(p => p.name)
    const record: GameRecord = {
      id: uid(8), caseId: this.S.id, finishedAt: new Date().toISOString(), players,
      outcome: this.outcome ?? 'failed', rounds: this.round + 1, hints: this.hintsUsed, wrong: 2 - this.attemptsLeft,
      minutes: this.startedAt ? Math.round((Date.now() - this.startedAt) / 60000) : 0
    }
    this.store.addHistory(record)
  }

  clock(): string {
    const step = Math.round(this.b.night / this.roundsTotal / 5) * 5
    // «на время»: игровые часы идут вместе с настоящими, поминутно
    const total = clockMinutes(this.S.clock.start) + (this.realtime && this.fieldTotalMs
      ? Math.round(this.b.night * this.fieldShare())
      : Math.min(this.b.night, this.round * step))
    const hh = Math.floor(total / 60) % 24, mm = total % 60
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }

  /* ── ходы ───────────────────────────────────────────────────── */

  /** из голоса берутся только существующие варианты текущего дела */
  private pickVote(m: Extract<ClientMessage, { type: 'vote' }>) {
    const out: { culprit?: string; method?: string; motive?: string } = {}
    if (m.culprit && this.b.WIT.has(m.culprit)) out.culprit = m.culprit
    if (m.method && this.S.accusation.methods.some(x => x.id === m.method)) out.method = m.method
    if (m.motive && this.S.accusation.motives.some(x => x.id === m.motive)) out.motive = m.motive
    return out
  }

  handlePlayer(pid: string, msg: ClientMessage) {
    const p = this.players.get(pid)
    if (!p) return
    switch (msg.type) {
      case 'setName': this.rename(pid, msg.name, msg.ink); break
      case 'ready': this.setReady(pid, msg.ready); break
      case 'pickDetective': this.pickDetective(pid, msg.detectiveId); break
      case 'plan': {
        if (this.screen !== 'plan' || this.paused) return
        if (!this.b.LOC.has(msg.locationId) || !msg.action || typeof msg.action !== 'object') return
        // способность со счётчиком ходом не считается — это действие сверх хода
        if (BONUS_TYPES.has(msg.action.type)) { this.setBonus(p, msg.action); return }
        const action = { ...msg.action } as PlanAction
        if ('remote' in action) delete (action as { remote?: boolean }).remote
        p.plan = { locationId: msg.locationId, action }
        this.emit()
        if ([...this.players.values()].filter(o => o.connected).every(o => o.plan)) {
          const soon = Date.now() + 2000
          if (!this.deadline || this.deadline > soon) this.deadline = soon
        }
        break
      }
      case 'unplan':
        if (this.screen !== 'plan') return
        p.plan = null; this.emit(); break
      case 'bonus':
        if (this.screen !== 'plan' || this.paused || !msg.action) return
        this.setBonus(p, msg.action)
        break
      case 'unbonus':
        if (this.screen !== 'plan') return
        p.bonus = null; this.emit(); break
      case 'proceed':
        if (this.screen !== 'discuss' && this.screen !== 'plan') return
        // повторное нажатие снимает голос
        if (this.proceedVotes.has(pid)) { this.proceedVotes.delete(pid); this.emit(); break }
        this.proceedVotes.add(pid)
        if (this.proceedVotes.size * 2 > [...this.players.values()].filter(o => o.connected).length) {
          const soon = Date.now() + 1500
          if (!this.deadline || this.deadline > soon) this.deadline = soon
        }
        this.emit()
        break
      case 'pin':
        if (!this.board.has(msg.factId)) return
        if (this.pins.has(msg.factId)) this.pins.delete(msg.factId); else this.pins.add(msg.factId)
        this.emit()
        break
      case 'callAccuse':
        if (this.screen !== 'discuss' && this.screen !== 'plan' && this.screen !== 'field') return
        if (this.screen === 'field' && this.paused) return
        this.openAccusation(pid)
        break
      case 'go': if (typeof msg.locationId === 'string') this.fieldGo(p, msg.locationId, !!msg.force); break
      case 'act': this.fieldAct(p, msg.action); break
      case 'halt':
        if (this.screen !== 'field') return
        this.settleWalk(p, Date.now()); p.walk = null; p.busy = null; this.emit()
        break
      case 'solve': if (typeof msg.questionId === 'string') this.fieldSolve(p, msg.questionId, msg.factIds); break
      case 'qpin': if (typeof msg.questionId === 'string' && typeof msg.factId === 'string') this.fieldPin(p, msg.questionId, msg.factId); break
      case 'qunpin': if (typeof msg.questionId === 'string' && typeof msg.factId === 'string') this.fieldUnpin(msg.questionId, msg.factId); break
      case 'vote':
        if (this.screen !== 'accuse' || !this.accusation) return
        this.accusation.votes[pid] = { ...(this.accusation.votes[pid] ?? {}), ...this.pickVote(msg) }
        if ([...this.players.values()].filter(o => o.connected).every(o => {
          const v = this.accusation!.votes[o.id]; return v && v.culprit && v.method && v.motive
        })) {
          const soon = Date.now() + 2500
          if (!this.deadline || this.deadline > soon) this.deadline = soon
        }
        this.emit()
        break
    }
  }

  /* ── разбор раунда ──────────────────────────────────────────── */

  private witnessAt(witnessId: string, round = this.round): string {
    const w = this.b.WIT.get(witnessId)!
    // расписание написано на scheduleLength раундов и растягивается на фактическое число
    const r = Math.min(round, this.roundsTotal - 1)
    const idx = Math.min(w.schedule.length - 1, Math.floor(r * w.schedule.length / Math.max(1, this.roundsTotal)))
    return w.schedule[idx]!
  }

  private reqOk(r?: { items?: string[]; facts?: string[] }) {
    return (r?.items ?? []).every(i => this.items.has(i)) && (r?.facts ?? []).every(f => this.board.has(f))
  }

  /** Что нужно, чтобы открылся вопрос или ответ на улику, — без названий: сами названия ненайденного были подсказкой */
  private reqHint(r?: { items?: string[]; facts?: string[] }): string | null {
    const parts: string[] = []
    const items = (r?.items ?? []).filter(i => !this.items.has(i)).length
    if (items) parts.push(items === 1 ? 'улика' : `улики (${items})`)
    const kinds = new Set((r?.facts ?? []).filter(f => !this.board.has(f)).map(f => this.b.FACT.get(f)?.kind).filter(Boolean) as string[])
    for (const k of kinds) parts.push(`карточка «${KIND_HINT[k] ?? 'факт'}»`)
    return parts.length ? `откроется, когда будет: ${parts.join(' и ')}` : null
  }

  private addFact(id: string | undefined, by: string, from: { witnessId?: string; locationId?: string } = {}) {
    if (!id || this.board.has(id) || !this.b.FACT.has(id)) return false
    this.board.set(id, { by, round: this.round, ...from, ...(this.realtime && this.screen === 'field' ? { time: this.clock() } : {}) })
    return true
  }

  /** фраза особого действия сыщика: своя у роли в мире (ability.act) или общая */
  private act(p: PlayerRecord, fallback: string, witness = '') {
    const t = this.roleOf(p)?.ability.act ?? fallback
    return t.replaceAll('{name}', p.name).replaceAll('{w}', witness)
  }

  private narrate(id: string, text: string, sfx?: string[], pauseAfter = 400): Beat {
    return { id, speaker: 'narrator', text, sfx, pauseAfter, mood: 'calm' }
  }

  private resolve() {
    this.screen = 'resolve'
    const beats: Beat[] = []
    const order = [...this.players.values()].sort((a, b) => a.order - b.order)

    /** реплики действия + карточки, которые оно положило на доску (открываются с последней репликой) */
    const withFacts = (make: () => Beat[], at: string, pid: string) => {
      const before = new Set(this.board.keys())
      const out = make().map(b => ({ ...b, locationId: b.locationId ?? at, playerId: pid }))
      const fresh = [...this.board.keys()].filter(k => !before.has(k))
      if (fresh.length && out.length) out[out.length - 1] = { ...out[out.length - 1]!, facts: [...(out[out.length - 1]!.facts ?? []), ...fresh] }
      return out
    }

    for (const p of order) {
      const plan = p.plan
      if (plan && plan.action.type !== 'wait') {
        p.locationId = plan.locationId
        // реплики хода помечаются локацией и игроком — экран показывает фото места и чей это ход
        beats.push(...withFacts(() => this.actBeats(p, plan), plan.locationId, p.id))
      } else if (plan) p.locationId = plan.locationId
      // способность сверх хода: дрон летит в своё место, вызванный свидетель приходит туда, где сыщик
      if (p.bonus) {
        const bonus = { locationId: p.locationId, action: p.bonus }
        beats.push(...withFacts(() => this.actBeats(p, bonus), p.locationId, p.id))
      }
    }

    // события ночи: происходят в свой раунд независимо от ходов
    for (const [i, ev] of (this.S.events ?? []).entries()) {
      if (this.eventsFired.has(i) || Math.round(ev.round * this.roundsTotal / 12) !== this.round) continue
      this.eventsFired.add(i)
      if (ev.itemId) this.items.add(ev.itemId)
      const fresh = this.addFact(ev.factId, 'событие')
      const item = ev.itemId ? this.b.ITEM.get(ev.itemId) : null
      beats.unshift({ ...ev.beat, itemId: item?.id, itemName: item?.name, facts: fresh && ev.factId ? [ev.factId] : undefined })
    }

    // противоречия
    for (const c of this.S.contradictions) {
      if (this.links.has(c.id) || !this.board.has(c.facts[0]) || !this.board.has(c.facts[1])) continue
      this.links.add(c.id)
      const fresh = this.addFact(c.yieldsFactId, 'доска')
      const yielded = c.yieldsFactId ? this.b.FACT.get(c.yieldsFactId) : null
      beats.push({ ...this.narrate(`link_${c.id}`, `Противоречие. ${c.text}${fresh && yielded ? ` Вывод: ${yielded.title}.` : ''}`, ['rumble'], 900), links: [c.id], facts: fresh && c.yieldsFactId ? [c.yieldsFactId] : undefined })
    }

    // подсказка инспектора
    if (this.settings.hints === 'soft') {
      // раунды подсказок заданы для 12-раундовой партии и масштабируются на фактическую длину
      const hint = this.S.hints.find(h => Math.round(h.round * this.roundsTotal / 12) === this.round && !this.hintsFired.has(h.round))
      if (hint && hint.missingAll.every(f => !this.board.has(f))) {
        this.hintsFired.add(hint.round)
        this.hintsUsed++
        beats.push(hint.beat)
      }
    }

    if (!beats.length) beats.push(this.narrate(`empty_${this.round}`, this.b.info.lines.idle, ['clock-tick']))

    this.beats = beats
    this.phaseMs = null
    this.deadline = this.settings.stepping === 'manual' ? null : Date.now() + estimateBeatsMs(beats)
    for (const p of this.players.values()) { p.plan = null; p.bonus = null }
    this.emit()
  }

  /** Реплики одного хода — без побочных пометок, их добавляет resolve(). */
  private actBeats(p: PlayerRecord, plan: NonNullable<PlayerRecord['plan']>): Beat[] {
    const kind = this.roleOf(p)?.ability.kind
    const a = plan.action
    const loc = this.b.LOC.get(plan.locationId)!

    if (a.type === 'search') {
      const spot = this.b.SPOT.get(a.spotId)
      if (!spot || spot.locationId !== plan.locationId) return []
      return this.doSearch(p, spot, kind, !!a.force)
    }
    if (a.type === 'ask') {
      const summon = this.summon(p, a.witnessId, plan.locationId, kind, !!a.remote)
      if (summon === null) return [this.narrate(`na_${p.id}_${this.round}`, `${p.name} — ${loc.name}: ${this.b.WIT.get(a.witnessId)?.name ?? 'свидетеля'} здесь уже нет.`)]
      const out = [...summon, ...this.doAsk(p, a.witnessId, a.questionId, kind, !!a.force)]
      if (a.second && kind === 'investigator') out.push(...this.doAsk(p, a.witnessId, a.second, kind, false))
      return out
    }
    if (a.type === 'present') {
      const summon = this.summon(p, a.witnessId, plan.locationId, kind, !!a.remote)
      if (summon === null) return []
      return [...summon, ...this.doPresent(p, a.witnessId, a.itemId)]
    }
    if (a.type === 'confront') return this.doConfront(p, a.witnessId, a.linkId, plan.locationId, kind)
    if (a.type === 'reporter' && kind === 'reporter' && (p.usesLeft ?? 0) > 0) {
      const bg = this.S.backgrounds[a.witnessId]
      if (!bg) return []
      p.usesLeft!--
      this.addFact(bg.factId, p.id, { witnessId: a.witnessId })
      return [{ ...bg.beat, id: `${bg.beat.id}_${this.round}` }]
    }
    if (a.type === 'intern' && kind === 'intern' && (p.usesLeft ?? 0) > 0) {
      // раунды разговоров заданы на 12-раундовую ночь; берём уже начавшийся и ещё не услышанный, иначе любой неуслышанный
      const scale = this.roundsTotal / 12
      const fresh = this.S.overheard.filter(o => !o.factId || !this.board.has(o.factId))
      const oh = [...fresh].reverse().find(o => this.round >= Math.round(o.rounds[0] * scale)) ?? fresh[0]
      if (!oh) return [this.narrate(`oh_${p.id}_${this.round}`, `${p.name} слушает у дверей, но всё, о чём здесь шепчутся, бригада уже знает.`)]
      p.usesLeft!--
      this.addFact(oh.factId, p.id)
      return [oh.beat]
    }
    if (a.type === 'drone' && kind === 'drone' && (p.usesLeft ?? 0) > 0) {
      const spot = this.b.SPOT.get(a.spotId)
      if (!spot) return []
      p.usesLeft!--
      const out = this.doSearch(p, spot, kind, false)
      return [{ ...this.narrate(`dr_${p.id}_${this.round}`, `${p.name} поднимает дрон — ${this.b.LOC.get(spot.locationId)!.name}.`, ['switch'], 200), locationId: spot.locationId }, ...out.map(b => ({ ...b, locationId: spot.locationId }))]
    }
    if (a.type === 'fixer' && kind === 'fixer' && (p.usesLeft ?? 0) > 0) {
      const deal = (this.S.market ?? []).find(m => !this.items.has(m.itemId))
      if (!deal) return [this.narrate(`fx_${p.id}_${this.round}`, `${p.name} обзванивает контакты. Рынок пуст — всё, что можно достать, у команды уже есть.`)]
      p.usesLeft!--
      this.items.add(deal.itemId)
      const item = this.b.ITEM.get(deal.itemId)!
      return [{ ...this.narrate(`fx_${p.id}_${this.round}`, `${p.name} договаривается с фиксером. ${deal.text} В улики: «${item.name}».`, ['static'], 1400), itemId: item.id, itemName: item.name }]
    }
    if (a.type === 'archivist' && kind === 'archivist' && (p.usesLeft ?? 0) > 0) {
      const card = this.b.FACT.get(a.factId)
      if (!card || !this.board.has(a.factId)) return []
      const lead = this.leadFor(a.factId)
      const who = this.act(p, '{name} поднимает архив')
      if (!lead) return [this.narrate(`arch_${p.id}_${this.round}`, `${who} по карточке «${card.title}». Всё, что с ней расходится, бригада уже нашла.`, ['drawer'])]
      p.usesLeft!--
      return [this.narrate(`arch_${p.id}_${this.round}`, `${who} по карточке «${card.title}». С ней не сходится то, что даст ${lead}.`, ['drawer', 'suspense-01'], 900)]
    }
    if (a.type === 'verify' && kind === 'tracker' && (p.usesLeft ?? 0) > 0) {
      const card = this.b.FACT.get(a.factId), entry = this.board.get(a.factId)
      const said = [...this.S.questions, ...this.S.presentations].find(x => x.factId === a.factId)
      if (!card || !entry) return []
      if (!said) return [this.narrate(`vf_${p.id}_${this.round}`, `${p.name} ищет записи камер по карточке «${card.title}». Это не чьи-то слова — проверять нечего.`)]
      p.usesLeft!--
      entry.verdict = { lie: said.answer.lie, by: this.roleOf(p)?.title ?? 'проверка' }
      return [this.narrate(`vf_${p.id}_${this.round}`, `${p.name} сверяет камеры, метки и платежи с показанием «${card.title}». ${said.answer.lie ? 'Не сходится: это ложь.' : 'Всё сходится: это правда.'}`, ['static', said.answer.lie ? 'suspense-06' : 'switch'], 900)]
    }
    if (a.type === 'coroner' && kind === 'coroner' && (p.usesLeft ?? 0) > 0) {
      const cor = this.S.coroner
      if (!cor || this.board.has(cor.factId)) return [this.narrate(`cor_${p.id}_${this.round}`, `${p.name}: медицинское заключение по делу уже на доске.`)]
      p.usesLeft!--
      const spot = this.b.SPOT.get(cor.spotId)
      this.addFact(cor.factId, p.id, { locationId: spot?.locationId })
      return [{ ...this.narrate(`cor_${p.id}_${this.round}`, `${p.name} ${cor.text}`, ['heartbeat', 'suspense-06'], 900), locationId: spot?.locationId }]
    }
    return []
  }

  /** Чьи это слова: вопрос или предъявление, которые кладут карточку на доску */
  private sourceOf(factId: string) {
    return this.b.SRC.get(factId) ?? null
  }

  /** Противоречия на доске, в которых замешаны слова свидетеля */
  private linksOf(witnessId: string) {
    return this.S.contradictions.filter(c => this.links.has(c.id) && c.facts.some(f => this.sourceOf(f)?.witnessId === witnessId))
  }

  /** Уличить во лжи: солгал — не выдерживает (открывается то, что он скрывал), сказал правду — стоит на своём */
  private doConfront(p: PlayerRecord, witnessId: string, linkId: string, at: string, kind: string | undefined): Beat[] {
    const w = this.b.WIT.get(witnessId), c = this.S.contradictions.find(x => x.id === linkId)
    if (!w || !c || !this.links.has(c.id)) return []
    if (this.witnessAt(w.id) !== at) return [this.narrate(`cf_${p.id}_${this.round}`, `${p.name} ищет ${w.name}, но здесь уже никого нет.`)]
    const key = `${w.id}:${c.id}`
    if (this.confronted.has(key)) return [this.narrate(`cf_${p.id}_${this.round}`, `${w.name} уже слышал(а) это противоречие и больше ничего не скажет.`)]
    this.confronted.add(key)
    const out: Beat[] = []
    if (!this.greeted.has(w.id)) { this.greeted.add(w.id); out.push(w.greeting) }
    const mine = c.facts.map(f => ({ factId: f, src: this.sourceOf(f) })).filter(x => x.src?.witnessId === w.id)
    out.push(this.narrate(`cf_${p.id}_${this.round}`, `${p.name} кладёт перед ${w.name} две карточки. ${c.text}`, ['drawer', 'suspense-04'], 700))
    const lie = mine.find(x => x.src!.answer.lie)
    const by = 'очная ставка'
    if (lie) {
      const e = this.board.get(lie.factId)
      if (e) e.verdict = { lie: true, by }
      // припёртый к стене отвечает на вопрос, который ждал именно этих карточек
      const related = new Set([...c.facts, ...(c.yieldsFactId ? [c.yieldsFactId] : [])])
      const q = this.S.questions.find(x => x.witnessId === w.id && !this.asked.has(x.id) && (x.initial || this.unlocked.has(x.id))
        && (x.requires?.facts ?? []).some(f => related.has(f)) && this.reqOk(x.requires))
      out.push(this.narrate(`cf_${p.id}_${this.round}_lie`, `${w.name} не выдерживает: карточка «${this.b.FACT.get(lie.factId)?.title ?? ''}» — ложь.`, ['suspense-06'], 600))
      if (q) out.push(...this.doAsk(p, w.id, q.id, kind, false).filter(b => b !== w.greeting))
      return out
    }
    for (const x of mine) { const e = this.board.get(x.factId); if (e) e.verdict = { lie: false, by } }
    out.push(this.narrate(`cf_${p.id}_${this.round}_true`, mine.length
      ? `${w.name} спокойно повторяет свои слова, и они сходятся. Похоже, неправда — во второй карточке.`
      : `${w.name} пожимает плечами: к этому противоречию он(а) отношения не имеет.`, ['clock-tick-slow'], 600))
    return out
  }

  /** Свидетель здесь — пустой список. Нет — патрульный вызывает его на допрос (реплика), остальным — null. */
  private summon(p: PlayerRecord, witnessId: string, at: string, kind: string | undefined, remote: boolean): Beat[] | null {
    if (this.witnessAt(witnessId) === at) return []
    if (!remote || kind !== 'patrol' || (p.usesLeft ?? 0) <= 0) return null
    const w = this.b.WIT.get(witnessId)
    if (!w) return null
    p.usesLeft!--
    return [this.narrate(`sum_${p.id}_${this.round}`, this.act(p, 'По вызову {name} на допрос приходит {w}.', w.name), ['door-knock'], 300)]
  }

  /** Архив: откуда можно добыть карточку, которая противоречит этой (место, человек или улика). */
  private leadFor(factId: string): string | null {
    for (const c of this.S.contradictions) {
      if (!c.facts.includes(factId)) continue
      const other = c.facts[0] === factId ? c.facts[1] : c.facts[0]
      if (this.board.has(other)) continue
      const spot = this.S.spots.find(sp => [sp.primary, sp.hidden, sp.memory].some(l => l?.factId === other))
      if (spot) return `осмотр «${spot.name}» (${this.b.LOC.get(spot.locationId)?.name ?? '?'})`
      const q = this.S.questions.find(x => x.factId === other)
      if (q) return `разговор с ${this.b.WIT.get(q.witnessId)?.name ?? '?'}`
      const pr = this.S.presentations.find(x => x.factId === other)
      if (pr) return `если показать ${this.b.WIT.get(pr.witnessId)?.name ?? '?'} «${this.b.ITEM.get(pr.itemId)?.name ?? '?'}»`
      const inner = this.S.contradictions.find(x => x.yieldsFactId === other)
      if (inner) { const deeper = inner.facts.find(f => !this.board.has(f)); if (deeper && deeper !== factId) { const l = this.leadFor(deeper); if (l) return l } }
    }
    return null
  }

  private canForceLock(spot: Spot, kind: string | undefined) {
    if (!spot.locked) return false
    return spot.locked.kind === 'digital' ? kind === 'netrunner' : kind === 'burglar'
  }

  private memoryReadable(spot: Spot, kind: string | undefined) {
    if (!spot.memory || this.memoryDone.has(spot.id)) return false
    return kind === 'braindance' || (!!this.S.memoryItemId && this.items.has(this.S.memoryItemId))
  }

  private doSearch(p: PlayerRecord, spot: Spot, kind: string | undefined, force: boolean): Beat[] {
    const out: Beat[] = []
    // «Коридор, корзина с бельём. Корзина с бельём стоит у ниши» — если находка начинается с того же, название места не повторяем
    const stems = (t: string) => t.toLowerCase().replace(/[^а-яёa-z\s-]/g, ' ').split(/[\s-]+/).filter(w => w.length >= 4).map(w => w.slice(0, 5))
    const nameStems = new Set(stems(spot.name))
    const room = this.b.LOC.get(spot.locationId)!.name
    const where = `${p.name} — ${room}, ${spot.name.toLowerCase()}.`
    const whereFor = (text: string) => stems(text.split(/[.!?]/)[0] ?? '').slice(0, 6).some(w => nameStems.has(w)) ? `${p.name} — ${room}.` : where
    if (spot.locked && !this.searched.has(spot.id)) {
      const hasKey = !!spot.locked.keyItemId && this.items.has(spot.locked.keyItemId)
      const canForce = force && this.canForceLock(spot, kind) && (p.usesLeft ?? 0) > 0
      if (!hasKey && !canForce) {
        out.push({ ...this.narrate(`s_${p.id}_${this.round}`, `${whereFor(spot.locked.text)} ${spot.locked.text}`, ['door-knob']), meta: whereFor(spot.locked.text) })
        return out
      }
      if (!hasKey && canForce) { p.usesLeft!--; out.push(this.narrate(`s_${p.id}_${this.round}_f`, `${where} ${this.act(p, spot.locked.kind === 'digital' ? 'Защита сдаётся нетраннеру за минуту.' : 'Замок сдаётся взломщику за минуту.')}`, [spot.locked.kind === 'digital' ? 'static' : 'door-knob'])) }
    }

    const applyFind = (f: Spot['primary'], id: string, prefix: string) => {
      if (f.itemId) this.items.add(f.itemId)
      this.addFact(f.factId, p.id, { locationId: spot.locationId })
      const item = f.itemId ? this.b.ITEM.get(f.itemId) : null
      out.push({ ...this.narrate(id, `${prefix} ${f.text}${item ? ` В улики: «${item.name}».` : ''}`, f.sfx ?? ['drawer'], item ? 1400 : 700), meta: prefix.trim(), itemId: item?.id, itemName: item?.name, facts: f.factId ? [f.factId] : undefined })
    }

    if (!this.searched.has(spot.id)) {
      this.searched.add(spot.id)
      applyFind(spot.primary, `s_${p.id}_${this.round}_1`, whereFor(spot.primary.text))
      if (spot.hidden && kind === 'forensic') { this.hiddenDone.add(spot.id); applyFind(spot.hidden, `s_${p.id}_${this.round}_2`, 'Криминалист смотрит глубже.') }
      else if (spot.hidden && this.smallBrigade) { this.hiddenDone.add(spot.id); applyFind(spot.hidden, `s_${p.id}_${this.round}_2`, 'Рук мало — смотрят сразу внимательно.') }
    } else if (spot.hidden && !this.hiddenDone.has(spot.id)) {
      this.hiddenDone.add(spot.id)
      applyFind(spot.hidden, `s_${p.id}_${this.round}_2`, `${where} Второй осмотр, внимательнее.`)
    } else if (!this.memoryReadable(spot, kind)) {
      out.push({ ...this.narrate(`s_${p.id}_${this.round}`, `${where} Здесь уже всё осмотрено — ничего нового.`), meta: where })
    }

    // запись памяти: читается при любом осмотре, если сыщик — брейнданс-техник или у бригады есть проигрыватель
    if (spot.memory && this.memoryReadable(spot, kind)) {
      this.memoryDone.add(spot.id)
      applyFind(spot.memory, `s_${p.id}_${this.round}_m`, kind === 'braindance' ? this.act(p, 'BD-техник подключается к записи.') : 'Проигрыватель считывает запись.')
    }

    return out
  }

  private doAsk(p: PlayerRecord, witnessId: string, questionId: string, kind: string | undefined, force: boolean): Beat[] {
    const out: Beat[] = []
    const w = this.b.WIT.get(witnessId), q = this.b.Q.get(questionId)
    if (!w || !q || q.witnessId !== witnessId) return out
    if (this.asked.has(q.id)) { out.push(this.narrate(`a_${p.id}_${this.round}`, `${p.name} — ${w.name}: на это уже ответили.`)); return out }
    if (!q.initial && !this.unlocked.has(q.id)) return out
    if (!this.reqOk(q.requires)) {
      if (force && kind === 'inspector' && (p.usesLeft ?? 0) > 0) { p.usesLeft!--; out.push(this.narrate(`a_${p.id}_${this.round}_f`, this.act(p, '{name} смотрит в упор и ждёт. Долго. {w} вспоминает.', w.name), ['clock-tick-slow'])) }
      else return out
    }
    if (!this.greeted.has(w.id)) { this.greeted.add(w.id); out.push(w.greeting) }
    this.asked.add(q.id)
    const honest = this.honestOf(q)
    const from = { witnessId: w.id, locationId: this.witnessAt(w.id) }
    if (honest) for (const f of honest.answer.facts ?? []) this.addFact(f, p.id, from)
    else this.addFact(q.factId, p.id, from)
    for (const u of q.unlocks ?? []) this.unlocked.add(u)
    if (!honest && kind === 'psychologist' && q.factId) { this.lieMarks.set(p.id, { ...(this.lieMarks.get(p.id) ?? {}), [q.factId]: q.answer.lie }); const e = this.board.get(q.factId); if (e) e.verdict = { lie: q.answer.lie, by: this.roleOf(p)?.title ?? 'психолог' } }
    out.push(this.narrate(`ask_${q.id}`, `${p.name} спрашивает: «${q.text}»`, undefined, 200))
    if (honest) out.push(this.proofBeat(`proof_${q.id}`, p, w, honest.proof))
    const a = honest?.answer ?? q.answer
    out.push({ id: honest ? honestBeatId(q.id, honest.index) : q.id, speaker: w.id, text: a.text, voice: a.voice, mood: a.mood, sfx: a.sfx, pauseAfter: 600 })
    return out
  }

  private doPresent(p: PlayerRecord, witnessId: string, itemId: string): Beat[] {
    const out: Beat[] = []
    const w = this.b.WIT.get(witnessId), item = this.b.ITEM.get(itemId)
    const pr = this.S.presentations.find(x => x.witnessId === witnessId && x.itemId === itemId)
    if (!w || !item || !this.items.has(itemId)) return out
    if (!pr) {
      this.presented.add(`${w.id}:${itemId}`)
      out.push(this.narrate(`pr_${p.id}_${this.round}`, `Улика на столе: «${item.name}». ${w.name} пожимает плечами: это ничего не значит.`)); return out
    }
    if (this.presented.has(pr.id)) { out.push(this.narrate(`pr_${p.id}_${this.round}`, `«${item.name}» уже показывали. ${w.name} больше ничего не добавит.`)); return out }
    if (!this.reqOk(pr.requires)) { out.push(this.narrate(`pr_${p.id}_${this.round}`, `Улика на столе: «${item.name}». ${w.name} смотрит на неё и молчит — пока ему нечего к этому добавить.`)); return out }
    if (!this.greeted.has(w.id)) { this.greeted.add(w.id); out.push(w.greeting) }
    this.presented.add(pr.id)
    const honest = this.honestOf(pr)
    const from = { witnessId: w.id, locationId: this.witnessAt(w.id) }
    if (honest) for (const f of honest.answer.facts ?? []) this.addFact(f, p.id, from)
    else this.addFact(pr.factId, p.id, from)
    for (const u of pr.unlocks ?? []) this.unlocked.add(u)
    if (!honest && this.roleOf(p)?.ability.kind === 'psychologist' && pr.factId) { this.lieMarks.set(p.id, { ...(this.lieMarks.get(p.id) ?? {}), [pr.factId]: pr.answer.lie }); const e = this.board.get(pr.factId); if (e) e.verdict = { lie: pr.answer.lie, by: this.roleOf(p)?.title ?? 'психолог' } }
    // сыщик не просто кладёт улику — он что-то говорит; если у бригады есть и карточка, бьющая ложь, она ложится рядом
    const lines = ['«Узнаёте?»', '«Объясните, как это здесь оказалось».', '«Я подожду».', '«Это не наша находка. Это ваша».']
    const line = lines[[...pr.id].reduce((a, c) => a + c.charCodeAt(0), 0) % lines.length]!
    out.push({ ...this.narrate(`show_${pr.id}`, `${p.name} кладёт на стол улику «${item.name}»: ${line} ${w.name} смотрит на неё.`, ['drawer'], 300), itemId: item.id, itemName: item.name })
    if (honest) out.push(this.proofBeat(`proof_${pr.id}`, p, w, honest.proof))
    const a = honest?.answer ?? pr.answer
    out.push({ id: honest ? honestBeatId(pr.id, honest.index) : pr.id, speaker: w.id, text: a.text, voice: a.voice, mood: a.mood, sfx: a.sfx, pauseAfter: 600 })
    return out
  }

  /** Честный ответ вместо лжи, которую бригада уже раскрыла. Лживая карточка при этом не ложится, поэтому вариант годится,
      только если выводы из её противоречий не потеряются: уже на доске, приходят с ответом или добываются другим противоречием,
      которое ещё может сойтись (его карточки не сгорели в чужом честном ответе). */
  private honestOf(x: Question | Presentation): { answer: HonestAnswer; index: number; proof: string } | null {
    if (!x.answer.lie || !x.honest?.length) return null
    const lieFact = x.factId
    const burned = (f: string) => {
      const src = this.sourceOf(f)
      return !!src && !this.board.has(f) && ('text' in src ? this.asked.has(src.id) : this.presented.has(src.id))
    }
    // ложь бьют не только карточки, названные в честных вариантах, но и вторая сторона любого противоречия с ней:
    // если у бригады есть доказательство, свидетель не врёт — карточка ложится на стол сама (22.09.2026)
    const partners = lieFact
      ? this.S.contradictions.filter(c => c.facts.includes(lieFact)).map(c => c.facts[0] === lieFact ? c.facts[1] : c.facts[0]).filter(f => this.board.has(f))
      : []
    for (const [index, h] of x.honest.entries()) {
      const proof = h.when.find(f => this.board.has(f)) ?? partners[0]
      if (!proof) continue
      const safe = !lieFact || this.S.contradictions.every(c => {
        const y = c.yieldsFactId
        if (!y || !c.facts.includes(lieFact) || this.board.has(y) || h.facts?.includes(y)) return true
        return this.S.contradictions.some(o => o.yieldsFactId === y && !o.facts.includes(lieFact) && !o.facts.some(burned))
      })
      if (safe) return { answer: h, index, proof }
    }
    return null
  }

  /** Доказательство ложится на стол само: сыщик кладёт карточку, которая бьёт ложь, и только потом свидетель отвечает */
  private proofBeat(id: string, p: PlayerRecord, w: Witness, proof: string): Beat {
    const title = this.b.FACT.get(proof)?.title ?? ''
    const n = this.proofs.get(w.id) ?? 0
    this.proofs.set(w.id, n + 1)
    const said = [
      `${p.name} кладёт на стол карточку «${title}»: «Прежде чем ответите — вот это».`,
      `${p.name} молча кладёт на стол карточку «${title}».`,
      `${p.name} придвигает карточку «${title}»: «Мы это уже знаем».`
    ]
    return this.narrate(id, `${said[n % said.length]} ${w.name} смотрит на неё и ${n ? 'уже не спорит' : 'долго молчит'}.`, ['drawer', 'suspense-04'], 700)
  }

  /* ── обвинение ──────────────────────────────────────────────── */

  private openAccusation(calledBy: string) {
    if (this.screen === 'field') {
      // часы поиска останавливаются: после неверного обвинения бригада вернётся к ним со штрафом
      const now = Date.now()
      this.fieldLeftMs = calledBy === 'dawn' ? 0 : Math.max(0, (this.deadline ?? now) - now)
      for (const p of this.players.values()) { this.settleWalk(p, now); p.walk = null; p.busy = null }
    }
    this.screen = 'accuse'
    const timed = this.settings.timers === 'on'
    this.accusation = { calledBy, deadline: timed ? Date.now() + ACCUSE_MS : null, votes: {} }
    this.deadline = this.accusation.deadline
    this.phaseMs = timed ? ACCUSE_MS : null
    this.beats = []
    this.emit()
  }

  private majority(field: 'culprit' | 'method' | 'motive'): string | null {
    const tally = new Map<string, number>()
    for (const v of Object.values(this.accusation?.votes ?? {})) { const x = v[field]; if (x) tally.set(x, (tally.get(x) ?? 0) + 1) }
    let best: string | null = null, n = 0
    for (const [k, c] of tally) if (c > n) { best = k; n = c }
    return best
  }

  private judge() {
    const culprit = this.majority('culprit'), method = this.majority('method'), motive = this.majority('motive')
    const sol = this.S.accusation.solution
    if (!culprit) {
      // никто не проголосовал — рассвет наступил, дело не закрыто
      this.attemptsLeft = 0
      this.outcome = 'failed'
      this.verdict = { correct: false, culpritRight: false, methodRight: false, motiveRight: false, accused: '', attemptsLeft: 0,
        beats: [this.narrate('v_none', this.b.info.lines.noName, ['ocean-pier'], 800)] }
    } else {
      const culpritRight = culprit === sol.culprit, methodRight = method === sol.method, motiveRight = motive === sol.motive
      const w = this.b.WIT.get(culprit)!
      const beats: Beat[] = []
      beats.push(this.narrate('v_call', `${this.b.info.stage.gather}. ${cap(SETTINGS[this.b.info.settingId]?.crew ?? 'бригада')} называет имя: ${w.name}.`, ['clock-tick-slow', 'suspense-07'], 1200))
      if (culpritRight) {
        this.outcome = methodRight && motiveRight ? 'solved' : 'partial'
        beats.push(this.S.accusation.defenses[culprit]?.beat ?? this.narrate('v_silent', `${w.name} молчит.`))
        if (!methodRight || !motiveRight) beats.push(this.narrate('v_partial', `Имя названо верно. ${!methodRight ? 'Но чем — ошибка. ' : ''}${!motiveRight ? 'И за что — тоже не то. ' : ''}Дело закрыто с оговорками.`, ['suspense-04'], 800))
        else beats.push(this.narrate('v_full', 'Имя, орудие и причина — всё сходится. Дело закрыто.', ['clock-bell'], 800))
      } else {
        this.attemptsLeft--
        const d = this.S.accusation.defenses[culprit]
        if (d) { beats.push(d.beat); if (this.addFact(d.factId, 'обвинение', { witnessId: culprit }) && d.factId) beats.push({ ...this.narrate('v_fact', `На доску ложится: «${this.b.FACT.get(d.factId)!.title}».`, ['drawer']), facts: [d.factId] }) }
        if (this.attemptsLeft > 0) beats.push(this.narrate('v_wrong', this.b.info.lines.wrong, ['thunder-roll'], 800))
        else { this.outcome = 'failed'; beats.push(this.narrate('v_lost', this.b.info.lines.lost, ['thunder-clap', 'dawn'], 1200)) }
      }
      // вердикт читается там, где собирают всех на обвинение
      this.verdict = { correct: culpritRight, culpritRight, methodRight, motiveRight, accused: culprit, attemptsLeft: this.attemptsLeft, beats: beats.map(b => ({ ...b, locationId: this.b.info.stage.accuse })) }
    }
    this.screen = 'verdict'
    this.beats = this.verdict.beats
    this.accusation = null
    this.phaseMs = null
    this.deadline = this.settings.stepping === 'manual' ? null : Date.now() + estimateBeatsMs(this.beats)
    this.emit()
  }

  private afterVerdict() {
    if (this.outcome) {
      // финал: правда, развилка по журналу, закрытие
      const found = this.items.has(this.S.epilogue.branch.itemId)
      this.beats = [...this.S.epilogue.truth, ...(found ? this.S.epilogue.branch.found : this.S.epilogue.branch.lost), this.S.epilogue.closing]
      this.screen = 'epilogue'
      this.phaseMs = null
      this.deadline = Date.now() + estimateBeatsMs(this.beats)
      this.emit()
      return
    }
    // ошибка: теряем раунд и продолжаем
    this.verdict = null
    if (this.realtime) {
      // «на время»: минус пять минут поиска
      const penalty = Math.min(this.fieldLeftMs, FIELD_ACCUSE_PENALTY_MS)
      this.fieldPenaltyMs += penalty
      this.fieldLeftMs -= penalty
      if (this.fieldLeftMs <= 0) { this.openAccusation('dawn'); return }
      this.beginField(this.fieldLeftMs)
      return
    }
    if (this.round + 1 >= this.roundsTotal) { this.openAccusation('dawn'); return }
    this.round++
    this.beginPlan()
  }

  /* ── публичные срезы ────────────────────────────────────────── */

  private cards(): BoardCard[] {
    return [...this.board.entries()].map(([id, e]) => {
      const f = this.b.FACT.get(id)!
      const itemId = this.b.FACT_ITEM.get(id)
      return { id, title: f.title, detail: f.detail, kind: f.kind, by: this.players.get(e.by)?.name ?? e.by, round: e.round, witnessId: e.witnessId, locationId: e.locationId, itemId: itemId && this.items.has(itemId) ? itemId : undefined, pinned: this.pins.has(id), verdict: e.verdict, time: e.time }
    }).sort((a, b) => a.round - b.round)
  }

  private linkCards(): BoardLink[] {
    return [...this.links].map(id => { const c = this.S.contradictions.find(x => x.id === id)!; return { id, facts: c.facts, text: c.text } })
  }

  private planLabel(p: PlayerRecord): PlanSummary | null {
    if (!p.plan) return null
    const a = p.plan.action, loc = this.b.LOC.get(p.plan.locationId)!.name
    const label = a.type === 'search' ? `осмотр: ${this.b.SPOT.get(a.spotId)?.name ?? '?'}`
      : a.type === 'ask' ? `вопрос: ${this.b.WIT.get(a.witnessId)?.name ?? '?'}`
      : a.type === 'present' ? `улика → ${this.b.WIT.get(a.witnessId)?.name ?? '?'}`
      : a.type === 'wait' ? 'наблюдает'
      : a.type === 'drone' ? `дрон → ${this.b.LOC.get(this.b.SPOT.get(a.spotId)?.locationId ?? '')?.name ?? '?'}`
      : a.type === 'archivist' ? 'архив: где искать'
      : a.type === 'verify' ? 'проверка показания'
      : a.type === 'coroner' ? 'медицинское заключение'
      : a.type === 'reporter' ? `прошлое: ${this.b.WIT.get(a.witnessId)?.name ?? '?'}`
      : a.type === 'confront' ? `уличить: ${this.b.WIT.get(a.witnessId)?.name ?? '?'}`
      : 'способность'
    const kind = a.type === 'search' || a.type === 'ask' || a.type === 'present' || a.type === 'confront' || a.type === 'wait' ? a.type : 'ability'
    return { playerId: p.id, locationId: p.plan.locationId, kind, label: `${loc} · ${label}`, bonus: this.bonusLabel(p) ?? undefined }
  }

  private bonusLabel(p: PlayerRecord): string | null {
    const a = p.bonus
    if (!a) return null
    return a.type === 'drone' ? `дрон → ${this.b.LOC.get(this.b.SPOT.get(a.spotId)?.locationId ?? '')?.name ?? '?'}`
      : a.type === 'ask' || a.type === 'present' ? `вызов на допрос: ${this.b.WIT.get(a.witnessId)?.name ?? '?'}`
      : a.type === 'archivist' ? 'архив: где искать'
      : a.type === 'verify' ? 'проверка показания'
      : a.type === 'coroner' ? 'медицинское заключение'
      : a.type === 'reporter' ? `прошлое: ${this.b.WIT.get(a.witnessId)?.name ?? '?'}`
      : a.type === 'intern' ? 'подслушать разговор'
      : a.type === 'fixer' ? 'сделка с фиксером'
      : 'способность'
  }

  publicState(): PublicState {
    const players = [...this.players.values()].sort((a, b) => a.order - b.order)
    return {
      build: BUILD,
      screen: this.screen,
      round: this.round,
      roundsTotal: this.screen === 'lobby' ? roundsFor(Math.max(2, this.players.size)) : this.roundsTotal,
      phaseMs: this.phaseMs,
      smallBrigade: this.smallBrigade,
      clock: this.clock(),
      deadline: this.paused ? null : this.deadline,
      paused: this.paused,
      settings: this.settings,
      players: players.map(p => ({
        id: p.id, name: p.name, ink: p.ink, photo: p.photo, connected: p.connected, ready: p.ready,
        detectiveId: p.detectiveId, locationId: p.locationId, planned: !!p.plan, usesLeft: p.usesLeft
      })),
      detectives: this.S.detectives,
      locations: this.S.locations.map(l => ({
        ...l,
        unsearched: this.S.spots.filter(s => s.locationId === l.id && !this.gone.has(s.id) && (!this.searched.has(s.id) || (s.hidden && !this.hiddenDone.has(s.id)))).length,
        open: this.canEnter(l)
      })),
      // «на время»: кто сидит за запертой дверью, не видно, пока дверь не открыта
      witnesses: this.S.witnesses.map(w => ({ id: w.id, name: w.name, role: w.role, age: w.age, bio: w.bio, locationId: this.witnessVisible(w.id) ? this.witnessAt(w.id) : '' })),
      board: { cards: this.cards(), links: this.linkCards() },
      beats: this.beats,
      beatIndex: this.beatIndex,
      plans: players.map(p => this.planLabel(p)).filter((x): x is PlanSummary => !!x),
      proceedVotes: this.proceedVotes.size,
      tutorialStep: this.tutorialStep,
      accusation: this.accusation,
      verdict: this.verdict,
      attemptsLeft: this.attemptsLeft,
      hintsUsed: this.hintsUsed,
      floors: this.S.floors,
      caseInfo: this.b.info,
      setting: SETTINGS[this.b.info.settingId]!,
      catalog: catalog(),
      history: (this.screen === 'lobby' || this.screen === 'menu') ? this.store.history().slice(-30).reverse() : [],
      accusationOptions: { methods: this.S.accusation.methods, motives: this.S.accusation.motives },
      outcome: this.outcome,
      standings: null,
      field: this.realtime && ['field', 'accuse', 'verdict', 'epilogue', 'final'].includes(this.screen) ? this.fieldState() : null
    }
  }

  youState(playerId: string): YouState | null {
    const p = this.players.get(playerId)
    if (!p) return null
    const role = this.roleOf(p)
    const kind = role?.ability.kind
    const options: LocationOptions[] = this.S.locations.map(l => ({
      locationId: l.id,
      spots: this.S.spots.filter(s => s.locationId === l.id && !this.gone.has(s.id)).map(s => ({
        id: s.id, name: s.name, glance: s.glance,
        searched: this.searched.has(s.id) && (!s.hidden || this.hiddenDone.has(s.id)) && !this.memoryReadable(s, kind),
        locked: s.locked && !this.searched.has(s.id) && !(s.locked.keyItemId && this.items.has(s.locked.keyItemId)) ? s.locked.text : null,
        canUnlock: this.canForceLock(s, kind) && (p.usesLeft ?? 0) > 0,
        memory: this.memoryReadable(s, kind),
        stage: !this.searched.has(s.id) ? 'new' as const : s.hidden && !this.hiddenDone.has(s.id) ? 'second' as const : this.memoryReadable(s, kind) ? 'memory' as const : 'done' as const
      })),
      witnesses: this.S.witnesses.filter(w => this.witnessAt(w.id) === l.id && this.witnessVisible(w.id)).map(w => ({
        id: w.id, name: w.name,
        questions: this.S.questions.filter(q => q.witnessId === w.id && (q.initial || this.unlocked.has(q.id))).map(q => {
          const locked = this.asked.has(q.id) ? null : this.reqHint(q.requires)
          // текст закрытого вопроса — сам по себе подсказка: до открытия телефон его не получает
          return { id: q.id, text: locked ? '' : q.text, asked: this.asked.has(q.id), locked, canForce: kind === 'inspector' && (p.usesLeft ?? 0) > 0, fresh: !locked && this.isFresh(q.id) }
        }),
        presents: [...this.items].reverse().map(itemId => {
          const pr = this.S.presentations.find(x => x.witnessId === w.id && x.itemId === itemId)
          return { itemId, name: this.b.ITEM.get(itemId)?.name ?? '?', done: this.presented.has(pr ? pr.id : `${w.id}:${itemId}`), locked: pr && !this.presented.has(pr.id) ? this.reqHint(pr.requires) : null }
        }),
        confronts: this.linksOf(w.id).map(c => ({ linkId: c.id, text: c.text, done: this.confronted.has(`${w.id}:${c.id}`) }))
      }))
    }))
    // патрульному и аналитику больше не нужны подсказки о соседях и прогнозы: их способности — действия
    const peeks: YouState['peeks'] = []
    const forecast: YouState['forecast'] = []
    const market = kind === 'fixer' && (p.usesLeft ?? 0) > 0
      ? (this.S.market ?? []).filter(m => !this.items.has(m.itemId)).slice(0, 1).map(m => ({ itemId: m.itemId, name: this.b.ITEM.get(m.itemId)?.name ?? '?' }))
      : []
    return {
      id: p.id, name: p.name, ink: p.ink, photo: p.photo, ready: p.ready,
      detectiveId: p.detectiveId, ability: role?.ability ?? null, usesLeft: p.usesLeft,
      locationId: p.locationId, planned: this.planLabel(p), bonus: p.bonus ? { playerId: p.id, locationId: p.locationId, kind: 'ability', label: this.bonusLabel(p)! } : null,
      proceeded: this.proceedVotes.has(p.id),
      options,
      items: [...this.items].map(i => this.b.ITEM.get(i)!).filter(Boolean),
      lieMarks: this.lieMarks.get(p.id) ?? {},
      peeks, forecast, market,
      field: this.realtime ? { walk: p.walk ?? null, busy: p.busy ? { label: p.busy.label, startedAt: p.busy.startedAt, until: p.busy.until } : null, log: (p.log ?? []).slice(-FIELD_LOG) } : null
    }
  }

  /* ── режим «на время» ───────────────────────────────────────── */

  /** дело играется «на время»: все ходят одновременно, время настоящее */
  private get realtime() { return this.b.info.mode === 'realtime' && !!this.S.realtime }

  private beginField(leftMs?: number) {
    this.screen = 'field'
    this.beats = []
    this.verdict = null
    if (leftMs === undefined) { this.fieldTotalMs = Number(this.settings.duration) * 60_000 || 45 * 60_000; leftMs = this.fieldTotalMs }
    this.phaseMs = this.fieldTotalMs
    this.deadline = Date.now() + leftMs
    this.fieldTick(Date.now())
    this.emit()
  }

  /** доля прошедшего времени поиска, 0…1 (штрафы приближают конец) */
  private fieldShare(now = Date.now()) {
    if (!this.fieldTotalMs) return 0
    const left = this.screen !== 'field' ? this.fieldLeftMs
      : this.paused ? this.pauseLeft
      : Math.max(0, (this.deadline ?? now) - now)
    return Math.min(1, Math.max(0, 1 - left / this.fieldTotalMs))
  }

  /** свидетель на виду: не за запертой дверью */
  private witnessVisible(witnessId: string) {
    const loc = this.b.LOC.get(this.witnessAt(witnessId))
    return !loc || this.canEnter(loc)
  }

  /** войти можно: замка нет, ключ у бригады или дверь вскрыли */
  private canEnter(l: Location) {
    return !l.locked || this.openedLocs.has(l.id) || (!!l.locked.keyItemId && this.items.has(l.locked.keyItemId))
  }

  /** кратчайший путь по соседям; запертые места обходятся, кроме цели */
  private route(from: string, to: string): string[] | null {
    if (from === to) return []
    const prev = new Map<string, string>([[from, '']])
    const queue = [from]
    while (queue.length) {
      const at = queue.shift()!
      for (const next of this.b.LOC.get(at)?.adjacent ?? []) {
        if (prev.has(next)) continue
        const loc = this.b.LOC.get(next)
        if (!loc || (next !== to && !this.canEnter(loc))) continue
        prev.set(next, at)
        if (next === to) {
          const path = [to]
          for (let x = at; x !== from; x = prev.get(x)!) path.unshift(x)
          return path
        }
        queue.push(next)
      }
    }
    return null
  }

  /** дошёл ли сыщик до очередного места; true — что-то изменилось */
  private settleWalk(p: PlayerRecord, now: number) {
    const w = p.walk
    if (!w) return false
    let t = w.startedAt, changed = false
    for (let i = 0; i < w.path.length; i++) {
      t += w.legs[i] ?? 0
      if (now < t) break
      if (p.locationId !== w.path[i]) { p.locationId = w.path[i]!; changed = true }
      if (i === w.path.length - 1) { p.walk = null; changed = true }
    }
    return changed
  }

  private fieldGo(p: PlayerRecord, locationId: string, force: boolean) {
    const dest = this.b.LOC.get(locationId)
    if (!dest || this.screen !== 'field' || this.paused) return
    const now = Date.now()
    this.settleWalk(p, now)
    p.busy = null
    if (locationId === p.locationId) { p.walk = null; this.emit(); return }
    if (!this.canEnter(dest)) {
      const kind = this.roleOf(p)?.ability.kind
      const canForce = force && (dest.locked!.kind === 'digital' ? kind === 'netrunner' : kind === 'burglar') && (p.usesLeft ?? 0) > 0
      if (!canForce) {
        this.logTo(p, [this.narrate(`door_${dest.id}`, `${dest.name}. ${dest.locked!.text}`, ['door-knob'])])
        p.walk = null
        this.emit()
        return
      }
      p.usesLeft!--
      this.openedLocs.add(dest.id)
      this.pushFeed({ kind: 'door', playerId: p.id, locationId: dest.id, text: `${p.name} вскрывает дверь: ${dest.name}` })
    }
    const path = this.route(p.locationId, dest.id)
    if (!path) return
    let prev = this.b.LOC.get(p.locationId)!
    const legs = path.map(id => { const next = this.b.LOC.get(id)!; const ms = next.floor === prev.floor ? FIELD_STEP_MS : FIELD_FLOOR_MS; prev = next; return ms })
    p.walk = { from: p.locationId, path, legs, startedAt: now }
    this.emit()
  }

  private fieldAct(p: PlayerRecord, action: PlanAction) {
    if (this.screen !== 'field' || this.paused || !action || typeof action !== 'object') return
    const now = Date.now()
    this.settleWalk(p, now)
    if (p.walk || p.busy) return
    const kind = this.roleOf(p)?.ability.kind
    let ms = FIELD_ABILITY_MS, label = ''
    switch (action.type) {
      case 'search': {
        const sp = this.b.SPOT.get(action.spotId)
        if (!sp || sp.locationId !== p.locationId || this.gone.has(sp.id)) return
        ms = (this.searched.has(sp.id) ? FIELD_SECOND_MS : FIELD_SEARCH_MS) + (action.force ? FIELD_FORCE_MS : 0)
        label = `осматривает: ${sp.name}`
        break
      }
      case 'ask': case 'present': {
        const w = this.b.WIT.get(action.witnessId)
        if (!w) return
        if (!action.remote && this.witnessAt(w.id) !== p.locationId) return
        ms = kind === 'investigator' ? Math.round(FIELD_TALK_MS / 2) : FIELD_TALK_MS
        label = `${action.remote ? 'вызывает на допрос' : action.type === 'ask' ? 'говорит' : 'показывает улику'}: ${w.name}`
        break
      }
      case 'drone': {
        const sp = this.b.SPOT.get(action.spotId)
        if (!sp || this.gone.has(sp.id)) return
        label = this.bonusLabel({ ...p, bonus: action }) ?? 'способность'
        break
      }
      case 'reporter': case 'intern': case 'fixer': case 'archivist': case 'verify': case 'coroner':
        label = this.bonusLabel({ ...p, bonus: action }) ?? 'способность'
        break
      default: return
    }
    p.busy = { action, startedAt: now, until: now + ms, label }
    this.emit()
  }

  /** действие закончилось: реплики — в журнал сыщика, находки — в ленту экрана */
  private fieldFinish(p: PlayerRecord, action: PlanAction) {
    const before = new Set(this.board.keys()), itemsBefore = new Set(this.items)
    const beats = this.actBeats(p, { locationId: p.locationId, action })
    const fresh = [...this.board.keys()].filter(k => !before.has(k))
    // что легло на доску за это действие — к последней реплике, телефон покажет плашками
    if (beats.length && fresh.length) { const last = beats[beats.length - 1]!; last.facts = [...new Set([...(last.facts ?? []), ...fresh])] }
    if (beats.length) this.logTo(p, beats.map(b => ({ ...b, locationId: b.locationId ?? p.locationId, playerId: p.id })))
    const newItems = [...this.items].filter(i => !itemsBefore.has(i))
    const talk = action.type === 'ask' || action.type === 'present'
    const kind: FieldFeedEntry['kind'] = talk ? 'talk' : action.type === 'search' || action.type === 'drone' ? 'find' : 'ability'
    for (const f of fresh) this.pushFeed({ kind, playerId: p.id, locationId: p.locationId, text: `${p.name}: «${this.b.FACT.get(f)!.title}»` })
    for (const i of newItems) this.pushFeed({ kind: 'find', playerId: p.id, locationId: p.locationId, text: `${p.name} забирает улику «${this.b.ITEM.get(i)?.name ?? ''}»` })
    if (!fresh.length && !newItems.length && talk) this.pushFeed({ kind: 'talk', playerId: p.id, locationId: p.locationId, text: `${p.name} говорит: ${this.b.WIT.get(action.witnessId)?.name ?? ''}` })
    // противоречия в делах «на время» тоже натягиваются сами
    for (const c of this.S.contradictions) {
      if (this.links.has(c.id) || !this.board.has(c.facts[0]) || !this.board.has(c.facts[1])) continue
      this.links.add(c.id)
      this.addFact(c.yieldsFactId, 'доска')
      this.pushFeed({ kind: 'solve', text: `Противоречие: ${c.text}` })
    }
  }

  /** карточка к вопросу по одной: подходит хоть к одному набору вместе с уже приколотыми — остаётся, набралось slots — вопрос решён;
      не подходит — штраф команде и короткое остывание вопроса */
  private fieldPin(p: PlayerRecord, questionId: string, factId: string) {
    if (this.screen !== 'field' || this.paused) return
    const q = this.S.realtime?.board.find(x => x.id === questionId)
    if (!q || this.solved.has(q.id) || !this.reqOk(q.requires) || !this.board.has(factId)) return
    const now = Date.now()
    if ((this.solveCooldown.get(q.id) ?? 0) > now) return
    const pinned = this.qpins.get(q.id) ?? []
    if (pinned.includes(factId)) return
    const title = this.b.FACT.get(factId)?.title ?? ''
    if (q.answers.some(a => a.includes(factId) && pinned.every(f => a.includes(f)))) {
      const next = [...pinned, factId]
      if (next.length >= q.slots) {
        this.qpins.delete(q.id)
        this.solved.add(q.id)
        this.addFact(q.yieldsFactId, p.id)
        this.pushMoment({ ...q.beat, facts: [q.yieldsFactId] }, q.title)
        this.pushFeed({ kind: 'solve', playerId: p.id, text: `${p.name} закрывает вопрос «${q.title}»: ${this.b.FACT.get(q.yieldsFactId)?.title ?? ''}` })
      } else {
        this.qpins.set(q.id, next)
        this.pushFeed({ kind: 'pin', playerId: p.id, text: `${p.name} прикалывает «${title}» к вопросу «${q.title}» — подходит, нужна ещё ${q.slots - next.length === 1 ? 'одна' : String(q.slots - next.length)}.` })
      }
    } else {
      this.solveCooldown.set(q.id, now + FIELD_COOLDOWN_MS)
      this.fieldPenaltyMs += FIELD_WRONG_MS
      if (this.deadline) this.deadline -= FIELD_WRONG_MS
      this.pushFeed({ kind: 'fail', playerId: p.id, text: `${p.name}: «${title}» к вопросу «${q.title}» не подходит. Минус ${FIELD_WRONG_MS / 1000} секунд.` })
    }
    this.emit()
  }

  private fieldUnpin(questionId: string, factId: string) {
    if (this.screen !== 'field') return
    const pinned = this.qpins.get(questionId)
    if (!pinned?.includes(factId)) return
    const next = pinned.filter(f => f !== factId)
    if (next.length) this.qpins.set(questionId, next); else this.qpins.delete(questionId)
    this.emit()
  }

  private fieldSolve(p: PlayerRecord, questionId: string, factIds: unknown) {
    if (this.screen !== 'field' || this.paused || !Array.isArray(factIds)) return
    const q = this.S.realtime?.board.find(x => x.id === questionId)
    if (!q || this.solved.has(q.id) || !this.reqOk(q.requires)) return
    const now = Date.now()
    if ((this.solveCooldown.get(q.id) ?? 0) > now) return
    const set = new Set(factIds.filter((f): f is string => typeof f === 'string' && this.board.has(f)))
    if (set.size !== q.slots) return
    if (q.answers.some(a => a.length === set.size && a.every(f => set.has(f)))) {
      this.solved.add(q.id)
      this.addFact(q.yieldsFactId, p.id)
      this.pushMoment({ ...q.beat, facts: [q.yieldsFactId] }, q.title)
      this.pushFeed({ kind: 'solve', playerId: p.id, text: `${p.name} закрывает вопрос «${q.title}»: ${this.b.FACT.get(q.yieldsFactId)?.title ?? ''}` })
    } else {
      this.solveCooldown.set(q.id, now + FIELD_COOLDOWN_MS)
      this.fieldPenaltyMs += FIELD_WRONG_MS
      if (this.deadline) this.deadline -= FIELD_WRONG_MS
      this.pushFeed({ kind: 'fail', playerId: p.id, text: `${p.name}: к вопросу «${q.title}» эти карточки не подходят. Минус ${FIELD_WRONG_MS / 1000} секунд.` })
    }
    this.emit()
  }

  private fieldTick(now: number) {
    let changed = false
    const share = this.fieldShare(now)
    const slot = Math.min(this.roundsTotal - 1, Math.floor(share * this.roundsTotal))
    if (slot !== this.round) { this.round = slot; changed = true }
    // события утра: доля времени round/12
    for (const [i, ev] of (this.S.events ?? []).entries()) {
      if (this.eventsFired.has(i) || share < ev.round / 12) continue
      this.eventsFired.add(i)
      if (ev.itemId) this.items.add(ev.itemId)
      this.addFact(ev.factId, 'событие')
      for (const sp of ev.spotsGone ?? []) this.gone.add(sp)
      const item = ev.itemId ? this.b.ITEM.get(ev.itemId) : null
      this.pushMoment({ ...ev.beat, itemId: item?.id, itemName: item?.name, facts: ev.factId ? [ev.factId] : undefined })
      this.pushFeed({ kind: 'event', locationId: ev.beat.locationId, text: ev.beat.text })
      changed = true
    }
    // звонки инспектора: если бригада до сих пор не нашла ничего из нужного
    if (this.settings.hints === 'soft') {
      for (const h of this.S.hints) {
        if (this.hintsFired.has(h.round) || share < h.round / 12) continue
        this.hintsFired.add(h.round)
        if (h.missingAll.some(f => this.board.has(f))) continue
        this.hintsUsed++
        this.pushMoment(h.beat, this.b.info.helper.name)
        this.pushFeed({ kind: 'hint', text: `${this.b.info.helper.name}: ${h.beat.text}` })
        changed = true
      }
    }
    for (const p of this.players.values()) {
      if (this.settleWalk(p, now)) changed = true
      if (p.busy && now >= p.busy.until) {
        const action = p.busy.action
        p.busy = null
        this.fieldFinish(p, action)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  /** запись в журнал телефона; у реплик рассказчика, начинающихся с имени сыщика, первое предложение — техническое («Клод осматривает тело.») */
  private logTo(p: PlayerRecord, beats: Beat[]) {
    const split = beats.map(b => {
      if (b.speaker !== 'narrator' || b.meta || !b.text.startsWith(p.name)) return b
      // цитата в реплике («спрашивает: «…»») — техническая целиком
      const m = b.text.includes(': «') ? b.text : /^[^.!?]*[.!?]/.exec(b.text)?.[0]
      return m ? { ...b, meta: m.trim() } : b
    })
    p.log = [...(p.log ?? []), { seq: ++this.seq, at: this.clock(), beats: split }].slice(-FIELD_LOG)
  }
  private pushFeed(e: Omit<FieldFeedEntry, 'seq' | 'at'>) {
    this.feed = [...this.feed, { ...e, seq: ++this.seq, at: this.clock() }].slice(-FIELD_FEED)
  }
  private pushMoment(beat: Beat, title?: string) {
    this.moments = [...this.moments, { seq: ++this.seq, beat, title }].slice(-FIELD_MOMENTS)
  }

  /** какие карточки нужны вопросу доски — по типам первого подходящего набора */
  private slotHint(q: BoardQuestion) {
    const kinds = new Map<string, number>()
    for (const f of q.answers[0] ?? []) { const k = this.b.FACT.get(f)?.kind ?? 'physical'; kinds.set(k, (kinds.get(k) ?? 0) + 1) }
    return [...kinds].map(([k, n]) => `${KIND_HINT[k] ?? 'факты'}${n > 1 ? ` ×${n}` : ''}`).join(' + ')
  }

  private fieldState(): FieldState {
    const now = Date.now()
    return {
      serverNow: now,
      totalMs: this.fieldTotalMs,
      penaltyMs: this.fieldPenaltyMs,
      players: [...this.players.values()].map(p => ({ id: p.id, walk: p.walk ?? null, busy: p.busy ? { label: p.busy.label, startedAt: p.busy.startedAt, until: p.busy.until } : null })),
      questions: (this.S.realtime?.board ?? []).filter(q => this.solved.has(q.id) || this.reqOk(q.requires)).map(q => {
        const cd = this.solveCooldown.get(q.id) ?? 0
        return { id: q.id, group: q.group, title: q.title, slots: q.slots, solved: this.solved.has(q.id), yieldsFactId: this.solved.has(q.id) ? q.yieldsFactId : null, cooldownUntil: cd > now ? cd : null, pinned: this.qpins.get(q.id) ?? [], hint: this.slotHint(q) }
      }),
      feed: this.feed.slice(-30),
      moments: this.moments.slice(-6),
      gone: [...this.gone]
    }
  }

  /* ── снимок на диск: партия переживает перезапуск ───────────── */

  private emit() {
    this.markOpened()
    this.onChange()
    this.persist()
  }

  /** шаг партии: план раунда — чётный, разбор и совещание после него — нечётный */
  private get step() { return this.round * 2 + (['resolve', 'discuss', 'accuse', 'verdict'].includes(this.screen) ? 1 : 0) }

  /** запоминаем, когда вопрос открылся: «новое» — только у тех, что появились в прошлом разборе, а не у всех незаданных */
  private markOpened() {
    if (this.screen === 'menu') return
    const now = Date.now()
    for (const q of this.S.questions) {
      if (this.openedAt.has(q.id) || !(q.initial || this.unlocked.has(q.id)) || !this.reqOk(q.requires)) continue
      this.openedAt.set(q.id, { step: this.step, at: this.screen === 'field' ? now : 0 })
    }
  }

  private isFresh(questionId: string) {
    const o = this.openedAt.get(questionId)
    if (!o || this.asked.has(questionId)) return false
    if (this.realtime) return o.at > 0 && Date.now() - o.at < FIELD_FRESH_MS
    return o.step === this.step - 1 || (o.step === this.step && this.step % 2 === 1)
  }

  /** комнату закрыли: таймер больше не нужен, снимок дописан */
  dispose() {
    clearInterval(this.timer)
    this.store.flush()
  }

  private persist() {
    try {
      const data = {
        players: [...this.players.values()].map(p => ({ ...p, connected: false })),
        caseId: this.S.id, screen: this.screen, round: this.round, roundsTotal: this.roundsTotal, brigade: this.brigade, phaseMs: this.phaseMs, startedAt: this.startedAt, deadline: this.deadline, paused: this.paused, pauseLeft: this.pauseLeft,
        settings: this.settings, board: [...this.board.entries()], pins: [...this.pins], links: [...this.links], items: [...this.items],
        searched: [...this.searched], hiddenDone: [...this.hiddenDone], memoryDone: [...this.memoryDone], asked: [...this.asked], presented: [...this.presented],
        unlocked: [...this.unlocked], greeted: [...this.greeted], lieMarks: [...this.lieMarks.entries()], confronted: [...this.confronted], openedAt: [...this.openedAt], tutorialStep: this.tutorialStep,
        beats: this.beats, beatIndex: this.beatIndex, proceedVotes: [...this.proceedVotes], accusation: this.accusation, verdict: this.verdict,
        attemptsLeft: this.attemptsLeft, hintsUsed: this.hintsUsed, hintsFired: [...this.hintsFired], eventsFired: [...this.eventsFired], outcome: this.outcome, pausedAt: this.pausedAt,
        fieldTotalMs: this.fieldTotalMs, fieldPenaltyMs: this.fieldPenaltyMs, fieldLeftMs: this.fieldLeftMs, solved: [...this.solved], solveCooldown: [...this.solveCooldown], qpins: [...this.qpins],
        gone: [...this.gone], openedLocs: [...this.openedLocs], feed: this.feed, moments: this.moments, seq: this.seq, savedAt: Date.now()
      }
      this.store.save(data)
    } catch (e) { console.warn('снимок партии не записался:', (e as Error).message) }
  }

  private restore() {
    try {
      const d = this.store.load() as any
      if (!d || !Array.isArray(d.players)) return
      // дело из снимка убрали из папки дел — партию не продолжить, игроки остаются в меню
      if (d.caseId && !CASES[d.caseId]) {
        for (const p of d.players) this.players.set(p.id, { ...p, connected: false, plan: null, bonus: null, detectiveId: null, usesLeft: null, ready: false, locationId: this.startLoc() })
        this.store.log(`дело ${d.caseId} не найдено — комната возвращена в меню`)
        return
      }
      if (d.caseId) this.loadCase(d.caseId)
      for (const p of d.players) this.players.set(p.id, { ...p, connected: false, plan: p.plan ?? null, bonus: p.bonus ?? null, walk: p.walk ?? null, busy: p.busy ?? null, log: p.log ?? [], locationId: this.b.LOC.has(p.locationId) ? p.locationId : this.startLoc() })
      this.screen = d.screen ?? 'menu'; this.round = d.round ?? 0; this.roundsTotal = d.roundsTotal ?? roundsFor(6); this.brigade = d.brigade ?? 0; this.phaseMs = d.phaseMs ?? null; this.startedAt = d.startedAt ?? 0
      this.paused = !!d.paused; this.pauseLeft = d.pauseLeft ?? 0
      for (const k of Object.keys(this.settings) as (keyof PublicState['settings'])[]) if (d.settings?.[k]) (this.settings as Record<string, string>)[k] = d.settings[k]
      this.board = new Map(d.board ?? []); this.pins = new Set(d.pins ?? []); this.links = new Set(d.links ?? []); this.items = new Set(d.items ?? [])
      this.searched = new Set(d.searched ?? []); this.hiddenDone = new Set(d.hiddenDone ?? []); this.memoryDone = new Set(d.memoryDone ?? []); this.asked = new Set(d.asked ?? [])
      this.presented = new Set(d.presented ?? []); this.unlocked = new Set(d.unlocked ?? []); this.greeted = new Set(d.greeted ?? []); this.confronted = new Set(d.confronted ?? []); this.openedAt = new Map(d.openedAt ?? []); this.tutorialStep = d.tutorialStep ?? 0
      this.lieMarks = new Map(d.lieMarks ?? []); this.beats = d.beats ?? []; this.beatIndex = d.beatIndex ?? 0; this.proceedVotes = new Set(d.proceedVotes ?? [])
      this.accusation = d.accusation ?? null; this.verdict = d.verdict ?? null
      this.attemptsLeft = d.attemptsLeft ?? 2; this.hintsUsed = d.hintsUsed ?? 0; this.hintsFired = new Set(d.hintsFired ?? []); this.eventsFired = new Set(d.eventsFired ?? []); this.outcome = d.outcome ?? null
      this.fieldTotalMs = d.fieldTotalMs ?? 0; this.fieldPenaltyMs = d.fieldPenaltyMs ?? 0; this.fieldLeftMs = d.fieldLeftMs ?? 0; this.solved = new Set(d.solved ?? []); this.solveCooldown = new Map(d.solveCooldown ?? []); this.qpins = new Map(d.qpins ?? [])
      this.gone = new Set(d.gone ?? []); this.openedLocs = new Set(d.openedLocs ?? []); this.feed = d.feed ?? []; this.moments = d.moments ?? []; this.seq = d.seq ?? 0
      // после перезапуска фаза с таймером ставится на паузу — ведущий продолжит, когда все вернутся;
      // простой сервера в оставшееся время не засчитывается
      if (this.screen !== 'lobby' && this.screen !== 'final' && d.deadline) {
        const savedAt = d.savedAt ?? Date.now()
        this.pauseLeft = d.paused ? (d.pauseLeft ?? 10_000) : Math.max(10_000, d.deadline - savedAt)
        this.paused = true
        this.pausedAt = d.paused && d.pausedAt ? d.pausedAt : savedAt
        this.deadline = d.deadline
      }
      this.store.log(`партия восстановлена: ${this.screen}, раунд ${this.round + 1}, игроков ${this.players.size}`)
    } catch (e) { console.warn('снимок партии не прочитался:', (e as Error).message) }
  }
}
