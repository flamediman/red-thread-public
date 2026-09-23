/* Одиночная игра («Туман»): один игрок, одна партия на жетон. История и её тайны — на сервере;
   телефону или компьютеру уходит только то, что герой видит, слышит и носит с собой.
   Встречи с существами идут в настоящем времени: на решение — секунды, потом существо бьёт само. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DATA_DIR } from '../utils/data-dir'
import { CASES_DIR } from '../utils/media'
import { assignVoiceIds } from './solo-lines'
import type {
  SoloBoss, SoloChase, SoloClientMessage, SoloCond, SoloDialogue, SoloEffect, SoloExit, SoloHotspot, SoloInfo, SoloItem, SoloLine, SoloMonster,
  SoloPlace, SoloQteKey, SoloSpawn, SoloStory, SoloView, SoloWeather, SoloWeatherRule
} from '../../shared/types'

/** есть ли у дела такая картинка: погодные версии кадров дорисовываются позже — без файла остаётся обычный кадр */
const artSeen = new Map<string, boolean>()
function artExists(story: string, art: string) {
  const key = `${story}/${art}`
  if (!artSeen.has(key)) artSeen.set(key, existsSync(resolve(CASES_DIR, story, 'art', `${art}.jpg`)))
  return artSeen.get(key)!
}

const BUILD = process.env.BUILD_ID || (existsSync('/app/build-id') ? readFileSync('/app/build-id', 'utf8').trim() : 'dev')
const FEED = 14
const SAVE_SLOTS = 3
/* голые руки: слабо и узкое окно — бить ими можно только самых хлипких, остальных лучше обойти */
const HANDS: NonNullable<SoloItem['weapon']> = { damage: 6, accuracy: 0.4 }
/** запас на окно удара: нажатие чуть раньше или позже края всё ещё засчитывается */
const ZONE_TOL = 130
/** насколько часы клиента могут разойтись с серверными, чтобы верить его времени нажатия */
const AT_DRIFT = 800
/** фонарь садится на столько процентов за переход (до нуля — дальше только тлеет) */
const LIGHT_DRAIN = 2
/** босс: стрелки точек и пауза между точками серии, мс */
const QTE_KEYS: SoloQteKey[] = ['up', 'down', 'left', 'right']
const QTE_GAP = 340
export const SOLO_TOKEN = /^[a-z0-9]{12,40}$/

interface Encounter { spawn: string; hp: number; round: number; startedAt: number; deadline: number; windowMs: number; text: string; hit: [number, number][]; flee: [number, number] | null; dodge?: Dodge | null; strikeAt: number; stun?: number; dazed?: number; grapple?: Grapple | null; mode?: 'normal' | 'guard' | 'press' | 'circle'; streak?: number; comboed?: boolean }
interface Chase { id: string; step: number; startedAt: number; deadline: number; text: string; tried?: number[] }
interface Prompt { id: number; key: SoloQteKey; x: number; y: number; from: number; to: number; result: 'hit' | 'miss' | null; mirror?: boolean; blink?: number }
const OPPOSITE: Record<SoloQteKey, SoloQteKey> = { up: 'down', down: 'up', left: 'right', right: 'left' }
/** существо бьёт: точки уворота, и что случится, если их не поймать */
interface Dodge { prompts: Prompt[]; damage: number; text: string; sfx: string[]; deadline: number }
/** захват: сколько раз уже нажали, сколько нужно, что будет */
interface Grapple { deadline: number; presses: number; need: number; damage: number; free: string; held: string; sfx: string[] }
/** бой с боссом: серия точек prompts, итог прошлой серии last, phase — какая фаза уже объявлена */
interface Boss { spawn: string; hp: number; round: number; startedAt: number; deadline: number; text: string; prompts: Prompt[]; last: 'hit' | 'miss' | null; phase: number; kind?: 'strike' | 'defend'; open?: boolean }

/** всё, что переживает перезагрузку страницы и сохранения */
interface Run {
  story: string
  place: string
  prev: string | null
  visited: string[]
  flags: string[]
  items: Record<string, number>
  notes: string[]
  /** правило погоды, о котором игрок уже знает (номер в SoloStory.weather): о смене говорим один раз */
  weatherSeen?: number
  /** прочитанные записки (открывали в журнале) */
  read?: string[]
  /** где нашли записку: id записки → id места */
  notesAt?: Record<string, string>
  /** предметы, которые уже осматривали внимательно */
  examined?: string[]
  health: number
  battery: number
  light: boolean
  ammo: number
  weapon: string | null
  /** приёмник выключен игроком; в старых сохранениях поля нет — значит включён */
  radioOn?: boolean
  looked: string[]
  used: string[]
  killed: string[]
  /** существа, от которых спрятались: ушли и не вернутся, если появление не караулит место (stays) */
  passed: string[]
  opened: string[]
  tried: string[]
  otherworld: boolean
  score: Record<string, number>
  playMs: number
  deaths: number
  kills: number
  saves: number
  ending: string | null
  /** здоровье существ, от которых ушли или спрятались: при новой встрече раны на месте (id появления → hp) */
  wounds?: Record<string, number>
}

interface Live {
  encounter: Encounter | null
  chase?: Chase | null
  boss?: Boss | null
  /** существо, которое выйдет, если игрок задержится здесь: at — когда */
  linger?: { spawn: string; at: number } | null
  puzzle: string | null
  dialogue: { id: string; node: string } | null
  scene: { seq: number; lines: SoloLine[]; music?: string } | null
  dead: boolean
}

interface Slot { run: Run; place: string; at: string }
interface Disk { run: Run | null; live: Live | null; slots: (Slot | null)[]; savedAt: number }

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map(x => [x.id, x]))
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

export class SoloGame {
  private S: SoloStory
  private PLACE: Map<string, SoloPlace>
  private ITEM: Map<string, SoloItem>
  private HOT: Map<string, SoloHotspot>
  private MON: Map<string, SoloMonster>
  private SPAWN: Map<string, SoloSpawn>
  private CHASE: Map<string, SoloChase>
  private BOSS: Map<string, SoloBoss>
  private DIALOG: Map<string, SoloDialogue>

  private run: Run | null = null
  private live: Live = { encounter: null, chase: null, puzzle: null, dialogue: null, scene: null, dead: false }
  private slots: (Slot | null)[] = Array(SAVE_SLOTS).fill(null)
  private feed: SoloView['feed'] = []
  /** номера событий растут и после перезапуска сервера: клиент по ним решает, что уже прозвучало */
  private seq = Math.floor(Date.now() / 1000)
  private timer: ReturnType<typeof setTimeout> | null = null
  private lingerTimer: ReturnType<typeof setTimeout> | null = null
  private activeSince = Date.now()
  private file: string

  constructor(private info: SoloInfo, story: SoloStory, private token: string, private onChange: () => void, private random = Math.random) {
    this.S = story
    this.PLACE = byId(story.places); this.ITEM = byId(story.items); this.HOT = byId(story.hotspots)
    this.MON = byId(story.monsters); this.SPAWN = byId(story.spawns); this.DIALOG = byId(story.dialogues)
    this.CHASE = byId(story.chases ?? [])
    this.BOSS = byId(story.bosses ?? [])
    assignVoiceIds(story)
    this.file = resolve(DATA_DIR, 'solo', story.id, `${token}.json`)
    this.load()
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    if (this.lingerTimer) clearTimeout(this.lingerTimer)
    this.persist()
  }

  /** последняя вкладка закрыта или ушла в фон: существо не бьёт, пока игрока нет у экрана */
  detached() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.lingerTimer) { clearTimeout(this.lingerTimer); this.lingerTimer = null }
    this.tickPlay()
    this.persist()
  }

  /** игрок вернулся: у него снова полное окно на решение; то, что ждало его в этом месте, ждёт ещё пару секунд */
  attached() {
    this.activeSince = Date.now()
    this.refreshWindow()
    const l = this.live.linger
    if (l && !this.lingerTimer) this.armLinger(l.spawn, Math.max(2500, l.at - Date.now()))
  }

  /* ── сообщения ─────────────────────────────────────────────── */

  handle(msg: SoloClientMessage) {
    const r = this.run
    switch (msg.type) {
      case 'new': return this.newGame()
      case 'load': return this.loadSlot(msg.slot)
      case 'save': return this.saveSlot(msg.slot)
      case 'sceneDone':
        if (this.live.scene && this.live.scene.seq === msg.seq) {
          this.live.scene = null
          // пока шла сцена, существо ждало: окно на решение начинается, когда игрок видит встречу
          this.refreshWindow()
          this.changed()
        }
        return
    }
    if (!r || this.live.dead || r.ending) return
    switch (msg.type) {
      case 'light': return this.setLight(!!msg.on)
      case 'radio': r.radioOn = !!msg.on; return this.changed()
      case 'heal': return this.healWith(msg.item)
      case 'equip': return this.equip(msg.item)
      case 'act': return this.act(msg.action, msg.at)
      case 'bossShoot': return this.bossShoot()
      case 'run': return this.run_(msg.index)
      case 'qte': return this.qte(msg.id, msg.key, msg.at)
      case 'mash': return this.mash()
    }
    // остальное — только когда герой свободен: не в бою, не в погоне, не в разговоре, не над головоломкой, не в сцене
    if (this.live.encounter || this.live.chase || this.live.boss || this.live.scene) return
    if (msg.type === 'choose') return this.choose(msg.index)
    if (msg.type === 'closePuzzle') { this.live.puzzle = null; return this.changed() }
    if (msg.type === 'solve') return this.solve(msg.hotspot, msg.answer)
    if (this.live.dialogue || this.live.puzzle) return
    switch (msg.type) {
      case 'go': return this.go(msg.to)
      case 'examine': return this.examine(msg.item)
      case 'noteRead': {
        const r = this.run
        if (r && r.notes.includes(msg.id) && !(r.read ?? []).includes(msg.id)) { r.read = [...(r.read ?? []), msg.id]; this.changed() }
        return
      }
      case 'look': return this.look(msg.hotspot)
      case 'use': return this.use(msg.item, msg.hotspot)
      case 'combine': return this.combine(msg.item, msg.with)
    }
  }

  /* ── партия ───────────────────────────────────────────────── */

  private newGame() {
    const st = this.S.start
    this.run = {
      story: this.S.id, place: st.place, prev: null, visited: [st.place], flags: [...(st.flags ?? [])],
      items: Object.fromEntries(st.items.map(i => [i, 1])), notes: [...(st.notes ?? [])], health: st.health, battery: st.battery, light: false,
      ammo: st.ammo, weapon: null, looked: [], used: [], killed: [], passed: [], opened: [], tried: [], otherworld: false,
      score: {}, playMs: 0, deaths: 0, kills: 0, saves: 0, ending: null
    }
    this.live = { encounter: null, chase: null, boss: null, linger: null, puzzle: null, dialogue: null, scene: null, dead: false }
    this.feed = []
    this.activeSince = Date.now()
    if (this.timer) clearTimeout(this.timer)
    this.clearLinger()
    this.showScene(st.scene)
    const enter = this.place().enter
    if (enter) this.apply(enter)
    this.changed()
  }

  private place() { return this.PLACE.get(this.run!.place)! }
  private has(item: string) { return (this.run!.items[item] ?? 0) > 0 }
  private flag(f: string) { return this.run!.flags.includes(f) }

  private ok(c?: SoloCond) {
    if (!c) return true
    const r = this.run!
    if (c.flags && !c.flags.every(f => r.flags.includes(f))) return false
    if (c.notFlags && c.notFlags.some(f => r.flags.includes(f))) return false
    if (c.items && !c.items.every(i => this.has(i))) return false
    if (c.notItems && c.notItems.some(i => this.has(i))) return false
    if (c.otherworld !== undefined && c.otherworld !== r.otherworld) return false
    if (c.score && !Object.entries(c.score).every(([k, v]) => (r.score[k] ?? 0) >= v)) return false
    if (c.scoreBelow && !Object.entries(c.scoreBelow).every(([k, v]) => (r.score[k] ?? 0) < v)) return false
    if (c.notes && !c.notes.every(n => r.notes.includes(n))) return false
    if (c.weather && !c.weather.includes(this.weather())) return false
    return true
  }

  /** погода сейчас: последнее подходящее правило истории (условия правил о погоде не спрашивают — иначе круг) */
  private weatherRule(): { rule: SoloWeatherRule | null; index: number } {
    let rule: SoloWeatherRule | null = null, index = -1
    ;(this.S.weather ?? []).forEach((w, i) => { if (this.ok({ ...w.when, weather: undefined })) { rule = w; index = i } })
    return { rule, index }
  }
  private weather(): SoloWeather { return this.weatherRule().rule?.level ?? 'fog' }

  /** погода сменилась с прошлого раза — одна строка рассказчика, чтобы игрок заметил перемену */
  private noticeWeather() {
    const r = this.run!
    const { rule, index } = this.weatherRule()
    if ((r.weatherSeen ?? -1) === index) return
    r.weatherSeen = index
    const p = this.PLACE.get(r.place)
    // в подвале перемену не заметить: скажем, когда герой выйдет под небо или под крышу
    if (p?.deep) { r.weatherSeen = -2; return }
    const line = p?.outdoor ? rule?.text : rule?.indoor ?? rule?.text
    if (line) this.say(line, rule?.level === 'storm' ? ['thunder-far'] : undefined)
  }

  private say(text?: string, sfx?: string[], voice?: string, extra: { art?: string; found?: SoloView['feed'][number]['found']; note?: SoloView['feed'][number]['note']; melody?: SoloView['feed'][number]['melody'] } = {}) {
    if (!text && !sfx?.length && !extra.art && !extra.found && !extra.note && !extra.melody) return
    this.feed = [...this.feed, { seq: ++this.seq, text: text ?? '', sfx, voice, ...extra }].slice(-FEED)
  }
  private artOf(item: SoloItem) { return item.art ?? `i_${item.id}` }

  private showScene(lines?: SoloLine[], music?: string) {
    if (!lines?.length) return
    this.live.scene = { seq: ++this.seq, lines, music }
  }

  /** последствия: порядок — предметы и флаги, потом текст и сцена, потом переход, встреча, финал */
  private apply(e: SoloEffect) {
    const r = this.run!
    for (const i of e.take ?? []) { r.items[i] = Math.max(0, (r.items[i] ?? 0) - 1); if (r.weapon === i && !this.has(i)) r.weapon = null }
    for (const i of e.give ?? []) {
      const item = this.ITEM.get(i)
      if (!item) continue
      if (item.kind === 'ammo') r.ammo += item.amount ?? 1
      else r.items[i] = (r.items[i] ?? 0) + 1
      if (item.kind === 'weapon' && !r.weapon) r.weapon = i
      // карточка находки: клиент покажет её, когда закончатся сцена и разговор
      this.say(undefined, undefined, undefined, { found: { id: item.id, name: item.name, description: item.description, art: this.artOf(item) } })
    }
    for (const f of e.set ?? []) if (!r.flags.includes(f)) r.flags.push(f)
    if (e.unset) r.flags = r.flags.filter(f => !e.unset!.includes(f))
    if (e.melody) this.say(undefined, undefined, undefined, { melody: e.melody })
    if (e.note && !r.notes.includes(e.note)) {
      r.notes.push(e.note)
      r.notesAt = { ...(r.notesAt ?? {}), [e.note]: r.place }
      // записка показывается карточкой, как находка: иначе о ней узнаёшь только из ленты
      const n = this.S.notes.find(x => x.id === e.note)
      if (n) this.say(undefined, undefined, undefined, { note: { id: n.id, title: n.title, text: n.text } })
    }
    if (e.heal) r.health = clamp(r.health + e.heal)
    if (e.battery) r.battery = clamp(r.battery + e.battery)
    if (e.ammo) r.ammo = Math.max(0, r.ammo + e.ammo)
    for (const [k, v] of Object.entries(e.score ?? {})) r.score[k] = (r.score[k] ?? 0) + v
    if (e.otherworld !== undefined) r.otherworld = e.otherworld
    this.say(e.text, e.sfx, e.voice, { art: e.art })
    this.showScene(e.scene, e.music)
    if (e.hurt) this.hurt(e.hurt)
    if (this.live.dead) return
    if (e.goto && this.PLACE.has(e.goto)) this.enter(e.goto, false)
    if (e.encounter) this.startEncounter(e.encounter)
    if (e.chase) this.startChase(e.chase)
    if (e.talk) this.startTalk(e.talk)
    if (e.ending) this.finish(e.ending)
  }

  private hurt(n: number) {
    const r = this.run!
    r.health = clamp(r.health - n)
    if (r.health > 0) return
    r.deaths++
    this.live.dead = true
    this.live.encounter = null
    this.live.chase = null
    this.live.boss = null
    this.clearLinger()
    this.live.puzzle = null
    this.live.dialogue = null
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  /* ── ходьба ───────────────────────────────────────────────── */

  private lockKey(a: string, b: string) { return [a, b].sort().join('|') }

  private exitOpen(from: string, x: SoloExit) {
    const r = this.run!
    if (!x.lock) return true
    if (r.opened.includes(this.lockKey(from, x.to))) return true
    return false
  }

  private go(to: string) {
    const r = this.run!
    const here = this.place()
    const exit = here.exits.find(x => x.to === to && this.ok(x.when))
    if (!exit || !this.PLACE.has(to)) return
    const pending = this.pendingActSpawn()
    if (pending) { this.clearLinger(); this.startSpawn(pending); return this.changed() }
    if (exit.lock && !this.exitOpen(here.id, exit)) {
      const byItem = exit.lock.item && this.has(exit.lock.item)
      const byFlag = exit.lock.flag && this.flag(exit.lock.flag)
      if (!byItem && !byFlag) {
        const key = `${here.id}>${to}`
        if (!r.tried.includes(key)) r.tried.push(key)
        this.say(exit.lock.text, ['door-locked'])
        return this.changed()
      }
      r.opened.push(this.lockKey(here.id, to))
      if (byItem && exit.lock.consume) this.apply({ take: [exit.lock.item!] })
      if (exit.lock.open) this.apply(exit.lock.open)
      if (byItem) this.dropSpent()
      if (this.live.dead) return this.changed()
    }
    this.enter(to, true, exit.sfx)
    this.changed()
  }

  private enter(to: string, walked: boolean, sfx?: string[]) {
    const r = this.run!
    r.prev = r.place
    r.place = to
    // севшая батарейка не гасит фонарь совсем: он еле тлеет, в темноте видно только вплотную — но игра не запирается
    if (walked && r.light) {
      const before = r.battery
      r.battery = clamp(r.battery - LIGHT_DRAIN)
      if (before > 0 && r.battery === 0) this.say('Батарейка села. Фонарь еле тлеет — видно только то, что под самым носом.', ['flashlight-off'])
    }
    if (sfx?.length) this.say('', sfx)
    const first = !r.visited.includes(to)
    if (first) r.visited.push(to)
    const p = this.PLACE.get(to)!
    if (first && p.enter) this.apply(p.enter)
    this.noticeWeather()
    this.clearLinger()
    if (this.live.dead || this.live.encounter || this.live.chase || this.live.boss) return
    // кто ждёт у входа — выходит сразу; кто караулит внутри — через время, если игрок задержится
    const atOnce = this.S.spawns.find(s => s.place === to && (s.trigger ?? 'enter') === 'enter' && this.spawnActive(s))
    if (atOnce) return this.startSpawn(atOnce)
    const later = this.S.spawns.find(s => s.place === to && s.trigger === 'linger' && this.spawnActive(s))
    if (later) this.armLinger(later.id, later.afterMs ?? 20_000)
  }

  /* ── появления не сразу: после осмотра или через время ────── */

  private startSpawn(s: SoloSpawn) { if (s.boss) this.startBoss(s.id); else this.startEncounter(s.id) }

  /** после осмотра, действия или решённой головоломки здесь: существо, которое ждало именно этого;
      с afterMs — через паузу (текст находки успеть прочитать), но не позже, чем игрок соберётся уходить */
  private actSpawn(hotspotId: string) {
    const r = this.run!
    if (this.live.dead || this.live.encounter || this.live.chase || this.live.boss || r.ending) return
    const s = this.S.spawns.find(s => s.place === r.place && s.trigger === 'act' && this.spawnActive(s)
      && (!s.after || s.after === hotspotId || r.looked.includes(s.after) || this.flag(`solved:${s.after}`)))
    if (!s) return
    if (s.afterMs) this.armLinger(s.id, s.afterMs)
    else { this.clearLinger(); this.startSpawn(s) }
  }

  /** игрок уходит, а то, что вышло бы после осмотра, ещё не вышло: оно встаёт между ним и выходом */
  private pendingActSpawn(): SoloSpawn | null {
    const l = this.live.linger
    const s = l && this.SPAWN.get(l.spawn)
    return s && s.trigger === 'act' && s.place === this.run!.place && this.spawnActive(s) ? s : null
  }

  private armLinger(spawnId: string, ms: number) {
    this.clearLinger()
    this.live.linger = { spawn: spawnId, at: Date.now() + ms }
    this.lingerTimer = setTimeout(() => this.lingerFire(), ms)
    this.lingerTimer.unref?.()
  }

  private clearLinger() {
    if (this.lingerTimer) { clearTimeout(this.lingerTimer); this.lingerTimer = null }
    this.live.linger = null
  }

  /** время вышло: игрок всё ещё здесь — существо выходит; занят сценой, разговором или головоломкой — ещё секунда */
  private lingerFire() {
    this.lingerTimer = null
    const l = this.live.linger
    const s = l && this.SPAWN.get(l.spawn)
    const r = this.run
    if (!l || !s || !r || r.place !== s.place || r.ending || this.live.dead || !this.spawnActive(s)) { this.live.linger = null; return }
    if (this.live.encounter || this.live.chase || this.live.boss) { this.live.linger = null; return }
    if (this.live.scene || this.live.dialogue || this.live.puzzle) {
      this.lingerTimer = setTimeout(() => this.lingerFire(), 1000)
      this.lingerTimer.unref?.()
      return
    }
    this.live.linger = null
    this.startSpawn(s)
    this.changed()
  }

  private spawnActive(s: SoloSpawn) {
    const r = this.run!
    return !r.killed.includes(s.id) && (s.stays || !r.passed.includes(s.id)) && this.ok(s.when)
  }

  /* ── свет, лечение, оружие ────────────────────────────────── */

  private setLight(on: boolean) {
    const r = this.run!
    if (on && !this.has('flashlight')) { this.say('Фонаря нет.'); return this.changed() }
    if (r.light === on) return
    r.light = on
    this.say('', [on ? 'flashlight-on' : 'flashlight-off'])
    this.changed()
  }

  private healWith(itemId: string) {
    const r = this.run!
    const item = this.ITEM.get(itemId)
    if (!item || !this.has(itemId)) return
    if (item.kind === 'heal') {
      if (r.health >= 100) { this.say('Сейчас это не нужно.'); return this.changed() }
      r.items[itemId]!--
      r.health = clamp(r.health + (item.amount ?? 30))
      this.say(`${item.name}: стало легче.`, ['solo-heal'])
    } else if (item.kind === 'battery') {
      if (!this.has('flashlight')) { this.say('Батарейка есть, а фонаря нет.'); return this.changed() }
      r.items[itemId]!--
      r.battery = clamp(r.battery + (item.amount ?? 50))
      this.say('Новая батарейка — фонарь светит ровнее.', ['battery-in'])
    } else return
    this.changed()
  }

  private equip(itemId: string) {
    const item = this.ITEM.get(itemId)
    if (!item || item.kind !== 'weapon' || !this.has(itemId)) return
    if (this.run!.weapon !== itemId) this.say('', [item.weapon?.usesAmmo ? 'flaregun-load' : 'pipe-pick'])
    this.run!.weapon = itemId
    this.changed()
  }

  /* ── места осмотра, предметы, головоломки, разговоры ─────── */

  private visibleHotspots() {
    const r = this.run!
    const p = this.place()
    const lit = !p.dark || r.light
    return this.S.hotspots.filter(h => h.place === p.id && this.ok(h.when) && !(h.hideWhen && this.ok(h.hideWhen)) && (lit || !h.needsLight))
  }

  private look(id: string) {
    const r = this.run!
    const h = this.visibleHotspots().find(x => x.id === id)
    if (!h) return
    if (h.puzzle) {
      if (this.flag(`solved:${h.id}`)) { this.say(h.look?.after ?? 'Здесь уже всё сделано.'); return this.changed() }
      if (h.look && !r.looked.includes(h.id)) { r.looked.push(h.id); this.apply(h.look) }
      this.live.puzzle = h.id
      return this.changed()
    }
    if (h.talk) {
      this.startTalk(h.talk)
      return this.changed()
    }
    if (!h.look) return
    if (h.look.once && r.looked.includes(h.id)) { this.say(h.look.after ?? 'Больше здесь ничего нет.', undefined, undefined, { art: h.look.art }); return this.changed() }
    if (!r.looked.includes(h.id)) r.looked.push(h.id)
    this.apply(h.look)
    this.actSpawn(h.id)
    this.changed()
  }

  private use(itemId: string, hotspotId?: string) {
    const r = this.run!
    const item = this.ITEM.get(itemId)
    if (!item || !this.has(itemId)) return
    if (!hotspotId) {
      if (item.kind === 'heal' || item.kind === 'battery') return this.healWith(itemId)
      if (item.kind === 'weapon') return this.equip(itemId)
      this.say(item.description)
      return this.changed()
    }
    const h = this.visibleHotspots().find(x => x.id === hotspotId)
    if (!h) return
    const u = h.use?.find(x => x.item === itemId)
    if (!u) { this.say(h.wrong ?? `«${item.name}» здесь не пригодится.`); return this.changed() }
    const key = `${h.id}:${itemId}`
    if (u.once && r.used.includes(key)) { this.say('Это уже сделано.'); return this.changed() }
    if (!r.used.includes(key)) r.used.push(key)
    this.apply(u.effect)
    this.dropSpent()
    this.actSpawn(h.id)
    this.changed()
  }

  /** осмотреть вещь внимательнее: первый раз — её эффект (надпись на обороте, что-то внутри), потом — короткое after */
  private examine(itemId: string) {
    const r = this.run!
    const item = this.ITEM.get(itemId)
    if (!item || !this.has(itemId)) return
    if (!item.examine) { this.say(item.description); return this.changed() }
    if ((r.examined ?? []).includes(itemId)) { this.say(item.examine.after ?? item.description); return this.changed() }
    r.examined = [...(r.examined ?? []), itemId]
    const { after: _after, ...effect } = item.examine
    this.apply(effect)
    this.changed()
  }

  /** ключ или инструмент, который открыл всё, что мог, уходит из карманов — как в старых хоррорах: «больше не нужен» */
  private dropSpent() {
    const r = this.run!
    for (const [id, n] of Object.entries(r.items)) {
      if (!n) continue
      const it = this.ITEM.get(id)
      if (!it || (it.kind !== 'key' && it.kind !== 'tool')) continue
      const doors = this.S.places.flatMap(pl => pl.exits.filter(x => x.lock?.item === id).map(x => this.lockKey(pl.id, x.to)))
      const uses = this.S.hotspots.flatMap(h => (h.use ?? []).filter(u => u.item === id).map(u => ({ key: `${h.id}:${id}`, once: !!u.once })))
      if (!doors.length && !uses.length) continue
      if (it.combine?.length) continue
      const spent = doors.every(k => r.opened.includes(k)) && uses.every(u => u.once && r.used.includes(u.key))
      if (!spent) continue
      r.items[id] = 0
      if (r.weapon === id) r.weapon = null
      this.say(`«${it.name}» больше не нужен. Вы оставляете его здесь.`)
    }
  }

  private combine(a: string, b: string) {
    const ia = this.ITEM.get(a), ib = this.ITEM.get(b)
    if (!ia || !ib || !this.has(a) || !this.has(b)) return
    const c = ia.combine?.find(x => x.with === b) ?? ib.combine?.find(x => x.with === a)
    if (!c) { this.say('Одно с другим не соединить.'); return this.changed() }
    this.apply({ take: [a, b], give: [c.result], text: c.text, sfx: ['solo-combine'] })
    this.changed()
  }

  private solve(hotspotId: string, answer: string[]) {
    const h = this.HOT.get(hotspotId)
    const p = h?.puzzle
    if (!h || !p || this.live.puzzle !== hotspotId || !Array.isArray(answer)) return
    const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replaceAll('ё', 'е')
    let right = false
    // часы: двенадцатичасовой циферблат — 0:30 и 12:30 одно и то же
    const clock = (t: unknown) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim()); return m ? (Number(m[1]) % 12) * 60 + Number(m[2]) : -1 }
    if (p.kind === 'code') right = norm(answer.join('')) === norm(p.answer)
    else if (p.kind === 'word') right = p.answers.map(norm).includes(norm(answer[0]))
    // решётку читают целой фразой: пробелы и знаки не считаются
    else if (p.kind === 'grille') { const only = (x: unknown) => norm(x).replace(/[^a-zа-я0-9]/g, ''); right = p.answers.map(only).includes(only(answer[0])) }
    else if (p.kind === 'clock') right = clock(answer[0]) >= 0 && clock(answer[0]) === clock(p.answer)
    else right = answer.length === p.answer.length && answer.every((a, i) => norm(a) === norm(p.answer[i]))
    if (!right) { this.say(p.fail, ['solo-wrong']); return this.changed() }
    this.live.puzzle = null
    this.apply({ set: [`solved:${h.id}`] })
    this.apply(p.success)
    this.actSpawn(h.id)
    this.changed()
  }

  private startTalk(id: string) {
    const d = this.DIALOG.get(id)
    if (!d || this.live.dead) return
    // второй разговор начинается с узла again: приветствие уже было
    const met = `met:${d.id}`
    const start = d.again && this.flag(met) && d.nodes[d.again] ? d.again : d.start
    if (!this.flag(met)) this.run!.flags.push(met)
    this.live.dialogue = { id: d.id, node: start }
    const node = d.nodes[start]
    if (node?.effect) this.apply(node.effect)
  }

  private choose(index: number) {
    const dl = this.live.dialogue
    if (!dl) return
    const d = this.DIALOG.get(dl.id)!
    const node = d.nodes[dl.node]
    const choices = (node?.choices ?? []).filter(c => this.ok(c.when))
    // без вариантов — «дальше»: разговор кончается
    if (!choices.length) { this.live.dialogue = null; return this.changed() }
    const c = choices[index]
    if (!c) return
    if (c.effect) this.apply(c.effect)
    if (!c.to || !d.nodes[c.to] || this.live.dead) { this.live.dialogue = null; return this.changed() }
    this.live.dialogue = { id: d.id, node: c.to }
    const next = d.nodes[c.to]!
    if (next.effect) this.apply(next.effect)
    this.changed()
  }

  /* ── встречи ──────────────────────────────────────────────── */

  private startEncounter(spawnId: string) {
    const s = this.SPAWN.get(spawnId), m = s?.monster ? this.MON.get(s.monster) : undefined
    if (!s || !m || this.run!.killed.includes(s.id)) return
    const now = Date.now()
    this.live.puzzle = null
    this.live.dialogue = null
    const windowMs = this.roundWindow(m, 1)
    const zones = this.rollZones(m, windowMs)
    this.live.encounter = { spawn: s.id, hp: this.woundedHp(s.id, m), round: 1, startedAt: now, deadline: now + zones.strikeAt, windowMs, text: m.text.appear, ...zones }
    this.say('', [m.sfx.near])
    this.arm()
  }

  /** варианты во встрече с подсказками: что делает действие и что ему мешает */
  private encounterOptions(m: SoloMonster, p: SoloPlace, gun: SoloItem | undefined): NonNullable<SoloView['encounter']>['options'] {
    const r = this.run!
    const dim = this.dim()
    const melee = this.melee()
    const prev = r.prev ? this.PLACE.get(r.prev)?.name : null
    const hideWhy: string[] = []
    if (m.seesLight && r.light) hideWhy.push('фонарь горит, а она идёт на свет')
    if (this.has('radio') && r.radioOn !== false) hideWhy.push('приёмник шипит — шанс вдвое ниже')
    const chance = this.hideChance(m)
    const charm = this.luck()
    const hideHint = !p.hide ? 'Здесь негде.'
      : m.noHide ? 'От этого не спрятаться.'
      : chance <= 0 ? `Не выйдет: ${hideWhy.join(', ')}.`
      : `Бросок: шанс ≈ ${Math.round(chance * 100)} %${hideWhy.length ? ` (${hideWhy.join(', ')})` : dim ? ' (темнота прячет)' : ''}.${charm ? ` ${charm.name} даст второй бросок.` : ''}`
    const lightHint = !p.dark ? 'Здесь и так светло — фонарь ничего не меняет'
      : r.light ? `Погасить: темнота прячет${m.seesLight ? ' от неё' : ''}, но окна удара станут уже`
      : `Зажечь: окна удара шире${m.seesLight ? ', но она идёт на свет — раунды короче, не спрятаться' : ''}`
    const e = this.live.encounter
    const stunNote = e && (e.stun ?? 0) > 0 ? ' Оно оглушено: окно шире, ответа не будет.' : e && (e.dazed ?? 0) > 0 ? ' В голове звон: окно уже.' : ''
    return [
      { id: 'fight', label: melee ? `Ударить: ${melee.name}` : 'Отбиваться руками', enabled: true,
        hint: `${melee ? '' : 'Голыми руками — слабо и окно узкое. '}Бить, когда бегунок в красном окне${dim ? '; в темноте оно уже' : ''}.${stunNote}` },
      // стрелять не из чего — варианта нет вовсе; есть оружие без патронов — вариант виден, но закрыт
      ...(gun ? [{ id: 'shoot' as const, label: r.ammo ? `Стрелять (${r.ammo})` : 'Стрелять: патронов нет', enabled: r.ammo > 0,
        hint: r.ammo ? 'Почти на всё здоровье существа; раунд длиннее.' : 'Патроны кончились.' }] : []),
      // оглушённое и измотанное — добить одним ударом, как в старых хоррорах
      ...(e && (e.stun ?? 0) > 0 && e.hp <= m.hp * 0.35 ? [{ id: 'finish' as const, label: 'Добить', enabled: true, hint: 'Оно лежит. Один удар — и всё.' }] : []),
      { id: 'flee', label: 'Бежать назад', enabled: !!r.prev && !(e && (e.dazed ?? 0) > 0), hint: e && (e.dazed ?? 0) > 0 ? 'Ноги не слушаются — переждите раунд.' : prev ? `Назад: ${prev}. В синем окне — уйдёте без удара.` : 'Отступать некуда.' },
      { id: 'hide', label: p.hide ? `Спрятаться: ${p.hide}` : 'Спрятаться', enabled: !!p.hide && !m.noHide, hint: hideHint },
      ...(this.has('flashlight') ? [{ id: 'light' as const, label: r.light ? 'Погасить фонарь' : 'Включить фонарь', enabled: r.light || r.battery > 0, hint: lightHint }] : [])
    ]
  }

  /** длина раунда: оружие замедляет (tempo), существо, идущее на свет, при зажжённом фонаре торопится,
      торопливое (hurry) с каждым раундом даёт всё меньше времени */
  private roundWindow(m: SoloMonster, round: number) {
    const hurry = m.hurry ? Math.pow(m.hurry, Math.max(0, round - 1)) : 1
    return Math.max(3500, Math.round(m.windowMs * (this.zoneWeapon().tempo ?? 1) * (m.seesLight && this.run!.light ? 0.75 : 1) * hurry))
  }

  /** шанс, что укрытие сработает: в темноте без фонаря выше, с шипящим приёмником вдвое ниже,
      на свету от того, кто идёт на свет, — никакого */
  private hideChance(m: SoloMonster) {
    const r = this.run!
    if (m.noHide || !this.place().hide) return 0
    if (m.seesLight && r.light) return 0
    let c = this.dim() ? 0.9 : 0.7
    if (this.has('radio') && r.radioOn !== false) c *= 0.5
    return c
  }

  /** оберег в карманах: одноразовый второй бросок, если укрытие подвело */
  private luck(): SoloItem | null {
    return Object.keys(this.run!.items).map(i => this.ITEM.get(i)).find((i): i is SoloItem => i?.kind === 'luck' && this.has(i.id)) ?? null
  }
  /** в темноте без фонаря едва видно: окна удара и побега уже */
  private dim() { const p = this.place(); return !!p.dark && !this.run!.light }

  /** оружие, от которого зависят окна удара: то, что в руках (ствол — пока есть патроны), иначе ближний бой или руки */
  private zoneWeapon() {
    const r = this.run!
    const held = r.weapon ? this.ITEM.get(r.weapon)?.weapon : null
    if (held?.usesAmmo && r.ammo > 0) return held
    return this.melee()?.weapon ?? HANDS
  }

  /** окна раунда в миллисекундах от его начала: удар — по оружию и вёрткости существа, побег — по его evade.
      strikeAt — когда существо бьёт само, если игрок так и не ударил: где-то после последнего окна удара, в случайный
      момент до конца полосы; игроку этот момент не показывают (22.09.2026 — удары должны приходить непредсказуемо) */
  private rollZones(m: SoloMonster, windowMs: number): { hit: [number, number][]; flee: [number, number] | null; strikeAt: number } {
    const r = this.run!
    const w = this.zoneWeapon()
    const count = Math.max(1, w.zones ?? 1)
    const e = this.live.encounter
    // оглушённое существо открыто: окна вдвое шире; оглушённый герой едва видит: окна уже, побега нет
    const stun = e && (e.stun ?? 0) > 0 ? 1.7 : e && (e.dazed ?? 0) > 0 ? 0.55 : 1
    const guard = e?.mode === 'guard' ? 0.7 : 1
    const share = Math.min(0.7, (0.08 + 0.3 * w.accuracy) * (1 - (m.guard ?? 0)) * (this.dim() ? 0.55 : 1) * stun * guard)
    const width = share / count
    const hit: [number, number][] = []
    for (let k = 0; k < count; k++) {
      // окна не пересекаются и не липнут к краям: первые секунды — увидеть, последние — успеть
      for (let tries = 0; tries < 30; tries++) {
        const a = 0.1 + this.random() * (0.9 - width - 0.1)
        if (hit.every(([x, y]) => a + width < x / windowMs - 0.06 || a > y / windowMs + 0.06)) { hit.push([Math.round(a * windowMs), Math.round((a + width) * windowMs)]); break }
      }
    }
    hit.sort((x, y) => x[0] - y[0])
    const fleeShare = (0.1 + 0.4 * m.evade * (r.health < 30 ? 0.7 : 1)) * (this.dim() ? 0.7 : 1)
    const fa = 0.15 + this.random() * (0.95 - fleeShare - 0.15)
    const lastHit = Math.max(...hit.map(z => z[1]), Math.round(windowMs * 0.5))
    // торопится — бьёт почти сразу после последнего окна; кружит — в этом раунде не бьёт вовсе
    const strikeAt = e?.mode === 'circle' ? windowMs
      : e?.mode === 'press' ? Math.min(windowMs, lastHit + 150 + Math.round(this.random() * 500))
      : Math.min(windowMs, lastHit + 250 + Math.round(this.random() * Math.max(0, windowMs - lastHit - 250)))
    const dazed = !!e && (e.dazed ?? 0) > 0
    return { hit, flee: dazed ? null : [Math.round(fa * windowMs), Math.round((fa + fleeShare) * windowMs)], strikeAt }
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer)
    const e = this.live.chase ?? this.live.encounter ?? this.live.boss
    if (!e) return
    this.timer = setTimeout(() => this.onTimeout(), Math.max(0, e.deadline - Date.now()) + 50)
    this.timer.unref?.()
  }

  /** время вышло — существо бьёт само */
  private onTimeout() {
    if (this.live.chase) return this.chaseTimeout()
    if (this.live.boss) return this.bossTimeout()
    const e = this.live.encounter
    if (!e || Date.now() < e.deadline) return this.arm()
    if (this.live.scene) return this.refreshWindow()
    const m = this.MON.get(this.SPAWN.get(e.spawn)!.monster ?? '')!
    if (e.dodge) this.resolveDodge(m)
    else if (e.grapple) this.resolveGrapple(m, false)
    else if ((e.stun ?? 0) > 0) this.nextRound(m, m.text.recover ?? 'Оно встряхивается и приходит в себя.', [m.sfx.near], 0)
    else if (e.mode === 'circle') { e.streak = 0; this.nextRound(m, m.text.circle ? 'Оно так и не подошло.' : 'Оно так и не подошло — только кружило.', [m.sfx.near], 0) }
    else this.strike(m, m.text.strike, m.text.attack, [m.sfx.attack], m.damage)
    this.changed()
  }

  /* ── захват: быстрые нажатия ─────────────────────────────── */

  /** удар прошёл, и существо не отпускает: нужно быстро жать, чтобы вырваться. Бывает не в каждом бою (chance) */
  private startGrapple(m: SoloMonster, damage: number) {
    const e = this.live.encounter!
    const g = m.grapple!
    const now = Date.now()
    e.grapple = { deadline: now + g.ms, presses: 0, need: g.presses, damage, free: g.free, held: g.held, sfx: [m.sfx.attack] }
    e.text = g.text
    e.deadline = e.grapple.deadline
    this.say('', [m.sfx.attack])
    this.arm()
  }

  private mash() {
    const e = this.live.encounter
    if (!e?.grapple || this.live.scene) return
    e.grapple.presses++
    if (e.grapple.presses >= e.grapple.need) { const m = this.MON.get(this.SPAWN.get(e.spawn)!.monster ?? '')!; this.resolveGrapple(m, true) }
    this.changed()
  }

  /** вырвались — четверть урона; не успели — полтора */
  private resolveGrapple(m: SoloMonster, free: boolean) {
    const e = this.live.encounter!
    const g = e.grapple!
    e.grapple = null
    e.streak = 0
    if (free) this.nextRound(m, g.free, ['solo-dodge'], Math.round(g.damage * 0.25))
    else this.nextRound(m, g.held, g.sfx, Math.round(g.damage * 1.5))
  }

  /* ── уворот ───────────────────────────────────────────────── */

  /** Существо бьёт — но удар можно увернуть. Через случайную паузу на арене вспыхивает точка со стрелкой (у тяжёлых
      существ — две подряд), окно короткое: смотреть надо на экран, а не ловить ритм. Поймали все — урона нет; нет — удар
      проходит текстом `text` и уроном `damage`. Пока идёт уворот, полоса раунда стоит */
  private strike(m: SoloMonster, pre: string | undefined, text: string, sfx: string[], damage: number, combo = false) {
    const e = this.live.encounter!
    if (!damage) return this.nextRound(m, text, sfx, 0)
    const spec = m.dodge ?? { ms: 1000, points: 1 }
    const now = Date.now()
    let t = now + 350 + Math.round(this.random() * 700)
    const prompts: Prompt[] = []
    let px = 50, py = 50
    for (let k = 0; k < Math.max(1, spec.points ?? 1); k++) {
      let x = 50, y = 50
      // верхняя четверть арены свободна: там надпись «Уворот!», точка под неё не попадает
      for (let tries = 0; tries < 20; tries++) {
        x = Math.round(14 + this.random() * 72); y = Math.round(28 + this.random() * 44)
        if (Math.hypot(x - px, y - py) >= 30) break
      }
      if (Math.hypot(x - px, y - py) < 30) x = 100 - x
      // у второго удара в том же раунде свои номера точек: клиент не спутает их с уже сыгранными
      prompts.push({ id: e.round * 10 + (combo ? 5 : 0) + k, key: QTE_KEYS[Math.min(QTE_KEYS.length - 1, Math.floor(this.random() * QTE_KEYS.length))]!, x, y, from: t, to: t + spec.ms, result: null })
      t += spec.ms + 250; px = x; py = y
    }
    e.dodge = { prompts, damage, text, sfx, deadline: t + ZONE_TOL }
    e.text = pre ?? 'Оно бросается на вас.'
    e.deadline = e.dodge.deadline
    this.say('', [m.sfx.near])
    this.arm()
  }

  /** точки уворота сыграны или время вышло: все пойманы — удар мимо, иначе — проходит */
  private resolveDodge(m: SoloMonster) {
    const e = this.live.encounter!
    const d = e.dodge!
    for (const p of d.prompts) p.result ??= 'miss'
    const dodged = d.prompts.every(p => p.result === 'hit')
    e.dodge = null
    const dodgeText = m.text.dodge ?? 'Вы уходите в сторону — удар приходится в пустоту.'
    // увернулись — а оно не останавливается: вторая рука, второй из отряда. Раз за раунд, чтобы не было бесконечной серии
    if (dodged && m.combo && !e.comboed && this.random() < m.combo) {
      e.comboed = true
      this.say('', ['solo-dodge'])
      this.strike(m, `${dodgeText} ${m.text.combo ?? 'Оно не останавливается — второй замах.'}`, m.text.attack, [m.sfx.attack], m.damage, true)
      return
    }
    if (dodged) this.nextRound(m, dodgeText, ['solo-dodge'], 0)
    else if (m.grapple && this.random() < m.grapple.chance) this.startGrapple(m, d.damage)
    else {
      if (m.stuns) e.dazed = 2
      this.nextRound(m, m.stuns ? `${d.text} ${m.text.daze ?? 'В голове звон, руки не слушаются.'}` : d.text, d.sfx, d.damage)
    }
  }

  private dodgeQte(id: number, key: SoloQteKey, at?: number) {
    const e = this.live.encounter
    const d = e?.dodge
    if (!e || !d || this.live.scene) return
    const p = d.prompts.find(x => x.id === id)
    if (!p || p.result) return
    const now = Date.now()
    const t = typeof at === 'number' && Math.abs(at - now) <= AT_DRIFT ? at : now
    p.result = key === p.key && t >= p.from - ZONE_TOL && t <= p.to + ZONE_TOL ? 'hit' : 'miss'
    const m = this.MON.get(this.SPAWN.get(e.spawn)!.monster ?? '')!
    // один промах — удар уже не увернуть: не тянем, бьём сразу
    if (p.result === 'miss' || d.prompts.every(x => x.result)) this.resolveDodge(m)
    this.changed()
  }

  /** полное окно на решение с этой секунды */
  private refreshWindow() {
    const now = Date.now()
    const c = this.live.chase
    const spec = c && this.CHASE.get(c.id)
    if (c && spec) { c.startedAt = now; c.deadline = now + spec.windowMs; return this.arm() }
    const b = this.live.boss
    const bs = b && this.bossSpec(b)
    if (b && bs) { this.bossRound(bs, 1800); return this.arm() }
    const e = this.live.encounter
    const m = e && this.MON.get(this.SPAWN.get(e.spawn)?.monster ?? '')
    if (!e || !m) return
    // уворот шёл, пока игрока не было: замах заново
    if (e.dodge) { const d = e.dodge; e.dodge = null; this.strike(m, e.text, d.text, d.sfx, d.damage); return }
    if (e.grapple) { e.grapple.presses = 0; e.grapple.deadline = now + (m.grapple?.ms ?? 2500); e.deadline = e.grapple.deadline; return this.arm() }
    e.startedAt = now
    e.deadline = now + (e.strikeAt || e.windowMs)
    this.arm()
  }

  private nextRound(m: SoloMonster, text: string, sfx: string[], damage: number) {
    const e = this.live.encounter!
    if (damage) this.hurt(damage)
    if (this.live.dead) { this.say(text, sfx); return }
    const now = Date.now()
    e.round++
    e.text = text
    e.startedAt = now
    e.comboed = false
    // оглушение живёт один раунд: поставлено на 2, здесь становится 1 (этот раунд), в следующем — 0
    e.stun = Math.max(0, (e.stun ?? 0) - 1)
    e.dazed = Math.max(0, (e.dazed ?? 0) - 1)
    // существо ведёт себя по ситуации: после двух ваших попаданий прикрывается, чуя слабость — торопится,
    // иногда кружит и не бьёт вовсе. Так бой не читается как один и тот же скрипт
    e.mode = 'normal'
    if (!e.stun && !e.dazed) {
      const roll = this.random()
      if ((e.streak ?? 0) >= 2 && roll < 0.5) e.mode = 'guard'
      else if (this.run!.health <= 40 && roll < 0.35) e.mode = 'press'
      else if (roll > 0.85) e.mode = 'circle'
    }
    const cue = e.mode === 'guard' ? m.text.guard ?? 'Оно прикрывается.' : e.mode === 'press' ? m.text.press ?? 'Оно чует слабость и торопится.' : e.mode === 'circle' ? m.text.circle ?? 'Оно кружит, не подходя.' : ''
    if (cue) e.text = `${text} ${cue}`
    e.windowMs = Math.round(this.roundWindow(m, e.round) * (e.mode === 'press' ? 0.8 : 1))
    Object.assign(e, this.rollZones(m, e.windowMs))
    e.deadline = now + e.strikeAt
    this.say('', sfx)
    this.arm()
  }

  /** здоровье существа при новой встрече: раненое возвращается с прежним, лишь отдышавшись — не меньше 35 % от полного */
  private woundedHp(spawn: string, m: SoloMonster) {
    const w = this.run?.wounds?.[spawn]
    return w == null ? m.hp : Math.min(m.hp, Math.max(w, Math.ceil(m.hp * 0.35)))
  }

  private endEncounter(text: string, sfx: string[]) {
    const e = this.live.encounter
    // раны не заживают: убежали или спрятались — существо вернётся с тем же здоровьем (см. woundedHp)
    if (e && this.run) {
      const w = { ...(this.run.wounds ?? {}) }
      if (e.hp > 0) w[e.spawn] = e.hp; else delete w[e.spawn]
      this.run.wounds = w
    }
    this.live.encounter = null
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.say(text, sfx)
  }

  /** бой на время: удар и побег засчитываются, если нажали, пока бегунок в своём окне (время нажатия — по часам клиента, если они не разошлись) */
  private act(action: 'fight' | 'shoot' | 'flee' | 'hide' | 'finish', at?: number) {
    const e = this.live.encounter
    const r = this.run!
    if (!e) return
    const s = this.SPAWN.get(e.spawn)!, m = this.MON.get(s.monster ?? '')!
    if (e.dodge || e.grapple) return
    const now = Date.now()
    const rel = (typeof at === 'number' && Math.abs(at - now) <= AT_DRIFT ? at : now) - e.startedAt
    const inZone = (z: [number, number] | null) => !!z && rel >= z[0] - ZONE_TOL && rel <= z[1] + ZONE_TOL
    const hit = (dmg: number, loud: boolean) => {
      const zone = e.hit.find(inZone)
      if (zone) {
        e.hp -= dmg
        e.streak = (e.streak ?? 0) + 1
        if (e.hp <= 0) {
          r.killed.push(s.id); r.kills++
          this.endEncounter(m.text.die, [m.sfx.die])
          return
        }
        const landed = loud ? 'solo-shot' : 'solo-hit-land'
        // точный удар — в самую середину окна (или выстрел) — оглушает: раунд без ответа, окна шире
        const mid = (zone[0] + zone[1]) / 2, half = Math.max(1, (zone[1] - zone[0]) / 2)
        const perfect = loud || Math.abs(rel - mid) <= half * 0.3
        if (perfect && !m.unstunnable && (e.stun ?? 0) === 0) { e.stun = 2; this.nextRound(m, `${m.text.hit} ${m.text.stagger ?? 'Его шатает — на миг оно беззащитно.'}`, [landed, m.sfx.hurt], 0); return }
        // крепкое существо отвечает на удар: голыми руками такой бой выматывает — но ответ можно увернуть; оглушённое не отвечает
        if ((e.stun ?? 0) === 0 && this.random() > 1 - (m.riposte ?? 0)) { this.say('', [landed, m.sfx.hurt]); this.strike(m, `${m.text.hit} ${m.text.strike ?? ''}`.trim(), `${m.text.hit} ${m.text.attack}`, [m.sfx.attack], m.damage) }
        else this.nextRound(m, m.text.hit, [landed, m.sfx.hurt], 0)
      } else {
        e.streak = 0
        this.say('', [loud ? 'solo-shot' : 'solo-swing'])
        this.strike(m, `${m.text.miss} ${m.text.strike ?? ''}`.trim(), `${m.text.miss} ${m.text.attack}`, [m.sfx.attack], m.damage)
      }
    }
    switch (action) {
      case 'finish': {
        if (!((e.stun ?? 0) > 0 && e.hp <= m.hp * 0.35)) return
        r.killed.push(s.id); r.kills++
        this.endEncounter(m.text.finish ?? `Вы бьёте, пока оно не перестаёт шевелиться. ${m.text.die}`, ['solo-hit-land', m.sfx.die])
        break
      }
      case 'fight': {
        const melee = this.melee()?.weapon ?? HANDS
        hit(melee.damage, false)
        break
      }
      case 'shoot': {
        const gun = [...Object.keys(r.items)].map(i => this.ITEM.get(i)).find(i => i?.weapon?.usesAmmo && this.has(i.id))
        if (!gun || r.ammo <= 0) return
        r.ammo--
        hit(gun.weapon!.damage, true)
        break
      }
      case 'flee': {
        if (!r.prev) return
        // в окне — ушли чисто; мимо окна — уходите, но существо успевает достать
        if (inZone(e.flee)) {
          this.endEncounter(m.text.flee, ['solo-run'])
          this.enter(r.prev, true)
        } else {
          this.hurt(m.damage)
          if (this.live.dead) { this.say(m.text.fleeFail, [m.sfx.attack]); break }
          this.endEncounter(`${m.text.fleeFail} ${m.text.flee}`, ['solo-run', m.sfx.attack])
          this.enter(r.prev, true)
        }
        break
      }
      case 'hide': {
        const p = this.place()
        if (!p.hide || m.noHide) return
        // укрытие — бросок кубика: темнота помогает, шипящий приёмник мешает, свет фонаря выдаёт тем, кто идёт на свет;
        // оберег в кармане даёт один второй бросок
        const chance = this.hideChance(m)
        if (chance <= 0) { this.strike(m, `Свет фонаря выдаёт укрытие. ${m.text.strike ?? ''}`.trim(), `Свет фонаря выдаёт укрытие. ${m.text.attack}`, [m.sfx.attack], m.damage); break }
        let hidden = this.random() < chance
        if (!hidden) {
          const charm = this.luck()
          if (charm) {
            r.items[charm.id] = Math.max(0, (r.items[charm.id] ?? 0) - 1)
            this.say(`${charm.name} — в кулак, до боли. Ещё раз, не дыша.`, ['solo-hide'])
            hidden = this.random() < chance
          }
        }
        if (hidden) { r.passed.push(s.id); this.endEncounter(m.text.hide, ['solo-hide']); break }
        const radio = this.has('radio') && r.radioOn !== false
        const found = radio ? 'Приёмник шипит из-под куртки — и голова поворачивается на звук.' : m.text.hideFail ?? 'Оно останавливается у самого укрытия. Пауза — и находит вас.'
        if (radio) this.say('', ['radio-static'])
        this.strike(m, `${found} ${m.text.strike ?? ''}`.trim(), `${found} ${m.text.attack}`, [m.sfx.attack], m.damage)
        break
      }
    }
    this.changed()
  }

  /** чем бить вблизи: то, что в руках, если это не ствол; иначе любое оружие ближнего боя из карманов */
  private melee(): SoloItem | null {
    const r = this.run!
    const held = r.weapon ? this.ITEM.get(r.weapon) : null
    if (held?.weapon && !held.weapon.usesAmmo) return held
    return Object.keys(r.items).map(i => this.ITEM.get(i)).find((i): i is SoloItem => !!i?.weapon && !i.weapon.usesAmmo && this.has(i.id)) ?? null
  }

  /* ── погони ───────────────────────────────────────────────── */

  private startChase(id: string) {
    const spec = this.CHASE.get(id)
    if (!spec || !spec.steps.length) return
    const now = Date.now()
    this.live.puzzle = null
    this.live.dialogue = null
    this.live.encounter = null
    this.live.chase = { id, step: 0, startedAt: now, deadline: now + spec.windowMs, text: spec.steps[0]!.text }
    this.say('', [spec.sfx.near])
    this.arm()
  }

  private chaseTimeout() {
    const c = this.live.chase!
    if (Date.now() < c.deadline) return this.arm()
    if (this.live.scene) return this.refreshWindow()
    const spec = this.CHASE.get(c.id)!
    this.chaseHit(spec, spec.late)
    this.changed()
  }

  /** удар в погоне: шаг тот же, окно заново */
  private chaseHit(spec: SoloChase, text: string) {
    const c = this.live.chase!
    this.hurt(spec.damage)
    this.say('', [spec.sfx.hit])
    if (this.live.dead) { this.say(text); return }
    c.text = `${text} ${spec.steps[c.step]!.text}`
    this.refreshWindow()
  }

  private run_(index: number) {
    const c = this.live.chase
    const spec = c && this.CHASE.get(c.id)
    if (!c || !spec || this.live.scene) return
    const option = spec.steps[c.step]?.options[index]
    if (!option) return
    // неверный выбор бьёт, но запоминается: второй раз в ту же сторону не побежишь
    if (!option.right) { c.tried = [...(c.tried ?? []), index]; this.chaseHit(spec, option.text ?? spec.late); return this.changed() }
    this.say('', [spec.sfx.run])
    c.step++
    c.tried = []
    if (c.step >= spec.steps.length) {
      this.live.chase = null
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      this.apply(spec.success)
      return this.changed()
    }
    c.text = spec.steps[c.step]!.text
    this.refreshWindow()
    this.changed()
  }

  /* ── боссы: серии быстрых нажатий ────────────────────────── */

  private bossSpec(b: Boss) { return this.BOSS.get(this.SPAWN.get(b.spawn)?.boss ?? '') }

  /** темп серии по фазе: действует последняя из фаз, чей порог здоровье уже пробило */
  private bossPhase(spec: SoloBoss, hp: number) {
    let idx = -1
    ;(spec.phases ?? []).forEach((ph, i) => { if (hp <= ph.below * spec.hp) idx = i })
    const ph = idx >= 0 ? spec.phases![idx]! : null
    return { idx, series: ph?.series ?? spec.series, need: ph?.need ?? spec.need, promptMs: ph?.promptMs ?? spec.promptMs, text: ph?.text ?? null, dark: !!ph?.dark, mirror: !!ph?.mirror }
  }

  private startBoss(spawnId: string) {
    const s = this.SPAWN.get(spawnId), spec = s?.boss ? this.BOSS.get(s.boss) : undefined
    if (!s || !spec || this.run!.killed.includes(s.id)) return
    this.live.puzzle = null
    this.live.dialogue = null
    this.live.encounter = null
    // он нападает первым: первая серия — защита
    this.live.boss = { spawn: s.id, hp: spec.hp, round: 1, startedAt: Date.now(), deadline: 0, text: spec.text.appear, prompts: [], last: null, phase: -1, kind: 'defend', open: false }
    this.bossRound(spec, 2600)
    this.say('', [spec.sfx.near])
    this.arm()
  }

  /** новая серия точек: первая — через lead мс (текст надо успеть прочитать), дальше подряд с короткими паузами;
      каждая точка не ближе трети арены к предыдущей */
  private bossRound(spec: SoloBoss, lead: number) {
    const b = this.live.boss!
    const ph = this.bossPhase(spec, b.hp)
    const now = Date.now()
    let t = now + lead, px = 50, py = 50
    const prompts: Prompt[] = []
    for (let k = 0; k < ph.series; k++) {
      let x = 50, y = 50
      for (let tries = 0; tries < 20; tries++) {
        x = Math.round(12 + this.random() * 76); y = Math.round(14 + this.random() * 72)
        if (Math.hypot(x - px, y - py) >= 30) break
      }
      prompts.push({ id: b.round * 10 + k, key: QTE_KEYS[Math.min(QTE_KEYS.length - 1, Math.floor(this.random() * QTE_KEYS.length))]!, x, y, from: t, to: t + ph.promptMs, result: null,
        ...(ph.mirror ? { mirror: true } : {}), ...(ph.dark ? { blink: 420 } : {}) })
      t += ph.promptMs + QTE_GAP
      px = x; py = y
    }
    b.startedAt = now
    b.prompts = prompts
    b.deadline = t
  }

  /** нажатие по точке: своя стрелка вовремя — поймана, иначе промах; серия сыграна целиком — итог сразу */
  private qte(id: number, key: SoloQteKey, at?: number) {
    const b = this.live.boss
    if (!b) return this.dodgeQte(id, key, at)
    if (this.live.scene) return
    const p = b.prompts.find(x => x.id === id)
    if (!p || p.result) return
    const now = Date.now()
    const t = typeof at === 'number' && Math.abs(at - now) <= AT_DRIFT ? at : now
    const want = p.mirror ? OPPOSITE[p.key] : p.key
    p.result = key === want && t >= p.from - ZONE_TOL && t <= p.to + ZONE_TOL ? 'hit' : 'miss'
    this.say('', [p.result === 'hit' ? (b.kind === 'defend' ? 'solo-dodge' : 'solo-swing') : 'solo-wrong'])
    if (b.prompts.every(x => x.result)) this.bossResolve()
    this.changed()
  }

  private bossTimeout() {
    const b = this.live.boss!
    if (Date.now() < b.deadline) return this.arm()
    if (this.live.scene) return this.refreshWindow()
    this.bossResolve()
    this.changed()
  }

  /** серия сыграна. Удар (strike): поймали сколько нужно — босс теряет здоровье (оружие в руках решает, насколько; после
      чистой защиты — вдвое), нет — он отбивается. Защита (defend): каждая пропущенная точка — его удар по вам; ушли от всех —
      он открылся, следующий удар сильнее. Серии чередуются: он бьёт — вы бьёте */
  private bossResolve() {
    const b = this.live.boss!
    const spec = this.bossSpec(b)!
    for (const p of b.prompts) p.result ??= 'miss'
    const ph = this.bossPhase(spec, b.hp)
    const hits = b.prompts.filter(p => p.result === 'hit').length
    if (b.kind === 'defend') {
      const misses = b.prompts.length - hits
      if (misses) {
        this.hurt(Math.round(spec.damage * 0.4) * misses)
        if (this.live.dead) { this.say(spec.text.miss, [spec.sfx.attack]); return }
        b.last = 'miss'; b.open = false
        b.text = spec.text.miss
        this.say('', [spec.sfx.attack])
      } else {
        b.last = null; b.open = true
        b.text = spec.text.dodge ?? 'Он бьёт в пустоту и на миг открывается.'
        this.say('', ['solo-dodge'])
      }
      b.kind = 'strike'
    } else {
      const need = Math.max(1, ph.need - (b.open ? 1 : 0))
      if (hits >= need) {
        b.hp -= Math.round(spec.hit * this.bossWeapon() * (b.open ? 1.5 : 1))
        b.last = 'hit'
        if (this.bossDown(spec)) return
        const next = this.bossPhase(spec, b.hp)
        b.text = next.idx !== b.phase && next.text ? next.text : spec.text.hit
        b.phase = next.idx
        this.say('', [spec.sfx.hurt])
      } else {
        b.last = null
        b.text = spec.text.parry ?? 'Удары уходят в пустоту. Он даже не замечает.'
        this.say('', ['solo-swing'])
      }
      b.open = false
      b.kind = 'defend'
    }
    b.round++
    this.bossRound(spec, 1800)
    this.arm()
  }

  /** чем бьёте босса: труба — как есть, голыми руками — вполовину, что-то тяжелее трубы — сильнее */
  private bossWeapon() {
    const melee = this.melee()?.weapon
    return melee ? Math.max(0.6, Math.min(1.4, melee.damage / 16)) : 0.5
  }

  /** босс повержен: концовка боя; true — бой окончен */
  private bossDown(spec: SoloBoss) {
    const b = this.live.boss!
    if (b.hp > 0) return false
    const r = this.run!
    r.killed.push(b.spawn); r.kills++
    this.live.boss = null
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.say(spec.text.die, [spec.sfx.die])
    if (spec.success) this.apply(spec.success)
    return true
  }

  /** выстрел из ракетницы по боссу — в любой момент боя: почти половина его здоровья, но патронов мало */
  private bossShoot() {
    const b = this.live.boss
    const r = this.run!
    const spec = b && this.bossSpec(b)
    const gun = Object.keys(r.items).map(i => this.ITEM.get(i)).find(i => i?.weapon?.usesAmmo && this.has(i.id))
    if (!b || !spec || !gun || r.ammo <= 0 || this.live.scene) return
    r.ammo--
    b.hp -= gun.weapon!.damage
    b.last = 'hit'
    this.say('', ['solo-shot', spec.sfx.hurt])
    if (this.bossDown(spec)) return this.changed()
    const next = this.bossPhase(spec, b.hp)
    b.text = next.idx !== b.phase && next.text ? next.text : 'Выстрел бьёт ему в грудь огнём. Он шатается — и идёт снова.'
    b.phase = next.idx
    this.changed()
  }

  /* ── финал ─────────────────────────────────────────────────── */

  private finish(id: string) {
    const r = this.run!
    let ending = id
    if (id === 'auto') {
      const rule = this.S.endingRules.find(x => this.ok(x.when) && Object.entries(x.score ?? {}).every(([k, v]) => (r.score[k] ?? 0) >= v))
      ending = rule?.ending ?? this.S.endings[this.S.endings.length - 1]!.id
    }
    r.ending = ending
    this.live.encounter = null
    this.live.chase = null
    this.live.boss = null
    this.clearLinger()
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  /* ── сохранения ───────────────────────────────────────────── */

  private saveSlot(slot: number) {
    const r = this.run
    if (!r || !Number.isInteger(slot) || slot < 0 || slot >= SAVE_SLOTS) return
    if (!this.place().save || this.live.encounter || this.live.chase || this.live.boss || this.live.dead || r.ending) return
    this.tickPlay()
    r.saves++
    this.slots[slot] = { run: structuredClone(r), place: this.place().name, at: new Date().toISOString() }
    this.say('Сохранено.', ['solo-save'])
    this.changed()
  }

  private loadSlot(slot: number) {
    const s = this.slots[slot]
    if (!s) return
    const deaths = this.run?.deaths ?? s.run.deaths
    this.run = structuredClone(s.run)
    this.run.deaths = Math.max(deaths, this.run.deaths)
    this.live = { encounter: null, chase: null, boss: null, linger: null, puzzle: null, dialogue: null, scene: null, dead: false }
    this.feed = []
    this.activeSince = Date.now()
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.clearLinger()
    this.say(`Загружено: ${s.place}.`)
    this.changed()
  }

  /* ── срез для экрана ──────────────────────────────────────── */

  private tickPlay() {
    const now = Date.now()
    if (this.run && !this.run.ending && !this.live.dead) this.run.playMs += Math.min(now - this.activeSince, 10 * 60_000)
    this.activeSince = now
  }

  private radio(): 0 | 1 | 2 {
    const r = this.run!
    if (!this.has('radio') || r.radioOn === false) return 0
    if (this.live.encounter || this.live.chase || this.live.boss) return 2
    const here = this.place()
    // тихие существа приёмник не ловит
    const active = (placeId: string) => this.S.spawns.some(s => s.place === placeId && this.spawnActive(s) && !this.MON.get(s.monster ?? '')?.silent)
    if (active(here.id)) return 2
    return here.exits.some(x => this.ok(x.when) && active(x.to)) ? 1 : 0
  }

  view(): SoloView {
    const r = this.run
    const empty: SoloView = {
      build: BUILD, info: this.info, speakers: Object.fromEntries(this.S.npcs.map(n => [n.id, n.name])), artFocus: this.S.artFocus ?? {}, lights: this.S.lights ?? {}, depth: this.S.depth ?? [], started: false, place: null, exits: [], hotspots: [], inventory: [], notes: [], health: 100, battery: 0, light: false,
      ammo: 0, radio: 0, radioOn: true, otherworld: false, weapon: null, map: { areas: this.S.areas, places: [], links: [] }, feed: [], scene: null, encounter: null, boss: null, chase: null, puzzle: null,
      dialogue: null, dead: false, ending: null, saves: this.saveList(), canSave: false
    }
    if (!r) return empty
    const p = this.place()
    const lit = !p.dark || r.light
    // кадр: изнанка, иначе версия под нынешнюю погоду (место меняется, когда в него возвращаешься), иначе обычный
    const wart = p.weatherArt?.[this.weather()]
    const oart = `o_${p.art ?? p.id}`
    const art = r.otherworld && p.other && artExists(this.info.id, oart) ? oart : wart && artExists(this.info.id, wart) ? wart : `l_${p.art ?? p.id}`
    const texts = p.text.filter(t => this.ok(t.when)).map(t => t.text)
    if (p.dark && !r.light) texts.push('Темно. Без света здесь ничего не разглядеть.')
    const now = Date.now()
    const e = this.live.encounter
    const m = e ? this.MON.get(this.SPAWN.get(e.spawn)!.monster ?? '')! : null
    const b = this.live.boss
    const bs = b ? this.bossSpec(b) : null
    const gun = Object.keys(r.items).map(i => this.ITEM.get(i)).find(i => i?.weapon?.usesAmmo && this.has(i.id))
    const dl = this.live.dialogue
    const dNode = dl ? this.DIALOG.get(dl.id)!.nodes[dl.node] : null
    const ph = this.live.puzzle ? this.HOT.get(this.live.puzzle) : null
    const ending = r.ending ? this.S.endings.find(x => x.id === r.ending) : null
    const visited = new Set(r.visited)
    return {
      ...empty,
      started: true,
      place: { id: p.id, area: p.area, name: p.name, art, text: texts, dark: !!p.dark, lit, outdoor: !!p.outdoor, save: p.save ?? null, hide: p.hide ?? null, ambience: (r.otherworld && p.otherAmbience) || p.ambience || [], surface: p.surface ?? 'asphalt', weather: this.weather(), deep: !!p.deep },
      exits: p.exits.filter(x => this.ok(x.when)).map(x => ({
        to: x.to, label: x.label,
        locked: x.lock && !this.exitOpen(p.id, x) && !(x.lock.item && this.has(x.lock.item)) && !(x.lock.flag && this.flag(x.lock.flag)) ? x.lock.text : null,
        known: visited.has(x.to)
      })),
      hotspots: this.visibleHotspots().map(h => ({
        id: h.id, name: h.name,
        kind: h.puzzle ? 'puzzle' as const : h.talk ? 'talk' as const : 'look' as const,
        // осмотренное гаснет: головоломка — когда решена, разговор — когда состоялся, остальное — после первого осмотра
        done: h.puzzle ? this.flag(`solved:${h.id}`) : h.talk ? this.flag(`met:${h.talk}`) : r.looked.includes(h.id)
      })),
      inventory: Object.entries(r.items).filter(([, n]) => n > 0).map(([id, count]) => {
        const it = this.ITEM.get(id)!
        return { id, name: it.name, description: it.description, kind: it.kind, icon: it.icon ? `item-${it.icon}` : `kind-${it.kind}`, art: this.artOf(it), count, equipped: r.weapon === id, usable: it.kind === 'heal' || it.kind === 'battery' || it.kind === 'weapon', examinable: !!it.examine }
      }),
      notes: r.notes.map(n => this.S.notes.find(x => x.id === n)).filter((x): x is NonNullable<typeof x> => !!x).map(n => ({ ...n, read: (r.read ?? []).includes(n.id), where: this.PLACE.get(r.notesAt?.[n.id] ?? '')?.name ?? null })),
      health: r.health, battery: r.battery, light: r.light, ammo: r.ammo, radio: this.radio(), radioOn: r.radioOn !== false, otherworld: r.otherworld,
      weapon: r.weapon ? this.ITEM.get(r.weapon)?.name ?? null : null,
      map: {
        areas: this.S.areas,
        links: this.mapLinks(visited, p),
        // как на бумажной карте — весь район сразу; потайное (hidden) появляется, когда там побывали
        places: this.S.places.filter(x => !x.hidden || visited.has(x.id)).map(x => ({
          id: x.id, area: x.area, name: x.name, x: x.x, y: x.y, w: x.w, h: x.h, outdoor: !!x.outdoor, surface: x.surface ?? 'asphalt', poi: x.poi ?? (x.outdoor ? 'road' : 'door'), building: x.building,
          visited: visited.has(x.id), known: visited.has(x.id) || p.exits.some(ex => ex.to === x.id && this.ok(ex.when)), here: x.id === p.id, save: !!x.save,
          locked: r.tried.some(t => t.endsWith(`>${x.id}`)) && !r.opened.some(o => o.split('|').includes(x.id)),
          // пометка героя «?»: он здесь был, а загадка так и осталась нерешённой
          puzzle: visited.has(x.id) && this.S.hotspots.some(h => h.place === x.id && h.puzzle && !this.flag(`solved:${h.id}`) && this.ok(h.when) && !(h.hideWhen && this.ok(h.hideWhen)))
        }))
      },
      feed: this.feed,
      scene: this.live.scene,
      encounter: e && m ? {
        monster: m.id, name: m.name, hp: Math.max(0, e.hp), maxHp: m.hp, round: e.round, startedAt: e.startedAt, deadline: e.dodge || e.grapple ? e.deadline : e.startedAt + e.windowMs, serverNow: now, text: e.text,
        windowMs: e.windowMs,
        zones: { hit: e.hit.map(([a, b]) => [e.startedAt + a, e.startedAt + b] as [number, number]), flee: e.flee ? [e.startedAt + e.flee[0], e.startedAt + e.flee[1]] : null },
        dodge: e.dodge ? { prompts: e.dodge.prompts, deadline: e.dodge.deadline } : null,
        stunned: (e.stun ?? 0) > 0, dazed: (e.dazed ?? 0) > 0,
        grapple: e.grapple ? { deadline: e.grapple.deadline, presses: e.grapple.presses, need: e.grapple.need } : null,
        mode: e.mode ?? 'normal',
        options: this.encounterOptions(m, p, gun)
      } : null,
      puzzle: ph?.puzzle ? { hotspot: ph.id, puzzle: this.publicPuzzle(ph) } : null,
      boss: b && bs ? {
        id: bs.id, name: bs.name, art: bs.art ?? bs.id, hp: Math.max(0, b.hp), maxHp: bs.hp, round: b.round, text: b.text,
        startedAt: b.startedAt, deadline: b.deadline, serverNow: now, prompts: b.prompts, last: b.last,
        kind: b.kind ?? 'strike', open: !!b.open, need: b.kind === 'defend' ? b.prompts.length : Math.max(1, this.bossPhase(bs, b.hp).need - (b.open ? 1 : 0)),
        ammo: Object.keys(r.items).some(i => this.ITEM.get(i)?.weapon?.usesAmmo && this.has(i)) ? r.ammo : 0
      } : null,
      dialogue: dl && dNode ? {
        id: dl.id, npc: this.DIALOG.get(dl.id)!.npc, name: this.S.npcs.find(n => n.id === this.DIALOG.get(dl.id)!.npc)?.name ?? '',
        lines: dNode.lines, choices: (dNode.choices ?? []).filter(c => this.ok(c.when)).map((c, index) => ({ index, text: c.text })), music: this.DIALOG.get(dl.id)!.music
      } : null,
      chase: this.chaseView(now),
      dead: this.live.dead,
      ending: ending ? { id: ending.id, title: ending.title, lines: ending.scene, stats: { minutes: Math.round(r.playMs / 60000), saves: r.saves, deaths: r.deaths, kills: r.kills } } : null,
      saves: this.saveList(),
      canSave: !!p.save && !e && !this.live.chase && !this.live.boss && !this.live.dead
    }
  }

  private chaseView(now: number): SoloView['chase'] {
    const c = this.live.chase
    const spec = c && this.CHASE.get(c.id)
    const step = spec?.steps[c!.step]
    if (!c || !spec || !step) return null
    return {
      id: c.id, name: spec.name, art: step.art ?? `m_${spec.art}`, base: `m_${spec.art}`, step: c.step, total: spec.steps.length, text: c.text,
      startedAt: c.startedAt, deadline: c.deadline, serverNow: now,
      options: step.options.map((o, index) => ({ index, label: o.label, tried: (c.tried ?? []).includes(index) }))
    }
  }

  /** дорожки на карте: между местами одного района, если хоть с одного конца герой уже был */
  private mapLinks(visited: Set<string>, here: SoloPlace): [string, string][] {
    const shown = (id: string) => visited.has(id) || here.exits.some(ex => ex.to === id && this.ok(ex.when))
    const seen = new Set<string>()
    const links: [string, string][] = []
    for (const a of this.S.places) {
      if (!visited.has(a.id)) continue
      for (const x of a.exits) {
        const b = this.PLACE.get(x.to)
        if (!b || b.area !== a.area || !shown(b.id) || !this.ok(x.when)) continue
        const key = this.lockKey(a.id, b.id)
        if (seen.has(key)) continue
        seen.add(key)
        links.push([a.id, b.id])
      }
    }
    return links
  }

  private publicPuzzle(h: SoloHotspot): NonNullable<SoloView['puzzle']>['puzzle'] {
    const p = h.puzzle!
    switch (p.kind) {
      case 'code': return { kind: 'code', prompt: p.prompt, length: p.length, alphabet: p.alphabet, fail: p.fail, art: p.art }
      case 'dials': return { kind: 'dials', prompt: p.prompt, dials: p.dials, fail: p.fail, art: p.art }
      case 'sequence': return { kind: 'sequence', prompt: p.prompt, buttons: p.buttons, fail: p.fail, art: p.art }
      case 'word': return { kind: 'word', prompt: p.prompt, fail: p.fail, art: p.art }
      case 'clock': return { kind: 'clock', prompt: p.prompt, start: p.start, fail: p.fail, art: p.art }
      case 'keys': return { kind: 'keys', prompt: p.prompt, keys: p.keys, timbre: p.timbre, fail: p.fail, art: p.art }
      case 'arrange': return { kind: 'arrange', prompt: p.prompt, slots: p.slots, pieces: p.pieces, fail: p.fail, art: p.art }
      case 'grille': return { kind: 'grille', prompt: p.prompt, grid: p.grid, holes: p.holes, fail: p.fail, art: p.art }
    }
  }

  private saveList() {
    return this.slots.map((s, slot) => s ? { slot, place: s.place, at: s.at, minutes: Math.round(s.run.playMs / 60000) } : null).filter((x): x is NonNullable<typeof x> => !!x)
  }

  /* ── диск ─────────────────────────────────────────────────── */

  private changed() {
    this.tickPlay()
    this.persist()
    this.onChange()
  }

  private persist() {
    try {
      mkdirSync(resolve(this.file, '..'), { recursive: true })
      // встреча пишется с оставшимся временем: перезагрузка страницы не спасает от удара
      const data: Disk = { run: this.run, live: this.live, slots: this.slots, savedAt: Date.now() }
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(data))
      renameSync(tmp, this.file)
    } catch (e) { console.warn('одиночная партия не записалась:', (e as Error).message) }
  }

  private load() {
    try {
      if (!existsSync(this.file)) return
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as Disk
      this.run = d.run && this.PLACE.has(d.run.place) ? d.run : null
      // история дописана: концовки, до которой дошёл игрок, больше нет (была промежуточной) — возвращаем его к последнему осмотру
      if (this.run?.ending && !this.S.endings.some(x => x.id === this.run!.ending)) {
        this.run.ending = null
        this.run.looked = this.run.looked.slice(0, -1)
        d.live = null
      }
      this.slots = Array.from({ length: SAVE_SLOTS }, (_, i) => d.slots?.[i] && this.PLACE.has(d.slots[i]!.run.place) ? d.slots[i]! : null)
      if (this.run && d.live) {
        this.live = { ...d.live }
        // простой сервера во встрече не засчитывается: у игрока снова полное окно на решение
        if (this.live.chase && !this.CHASE.has(this.live.chase.id)) this.live.chase = null
        if (this.live.encounter && !this.MON.has(this.SPAWN.get(this.live.encounter.spawn)?.monster ?? '')) this.live.encounter = null
        this.live.chase ??= null
        this.live.boss ??= null
        this.live.linger ??= null
        if (this.live.boss && !this.bossSpec(this.live.boss)) this.live.boss = null
        if (this.live.encounter && !this.live.encounter.strikeAt) this.live.encounter.strikeAt = this.live.encounter.windowMs
        this.refreshWindow()
      }
    } catch (e) { console.warn('одиночная партия не прочиталась:', (e as Error).message) }
  }
}
