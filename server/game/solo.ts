/* Одиночная игра («Туман»): один игрок, одна партия на жетон. История и её тайны — на сервере;
   телефону или компьютеру уходит только то, что герой видит, слышит и носит с собой.
   Встречи с существами идут в настоящем времени: на решение — секунды, потом существо бьёт само. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DATA_DIR } from '../utils/data-dir'
import { assignVoiceIds } from './solo-lines'
import type {
  SoloChase, SoloClientMessage, SoloCond, SoloDialogue, SoloEffect, SoloExit, SoloHotspot, SoloInfo, SoloItem, SoloLine, SoloMonster,
  SoloPlace, SoloSpawn, SoloStory, SoloView
} from '../../shared/types'

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
export const SOLO_TOKEN = /^[a-z0-9]{12,40}$/

interface Encounter { spawn: string; hp: number; round: number; startedAt: number; deadline: number; windowMs: number; text: string; hit: [number, number][]; flee: [number, number] | null }
interface Chase { id: string; step: number; startedAt: number; deadline: number; text: string }

/** всё, что переживает перезагрузку страницы и сохранения */
interface Run {
  story: string
  place: string
  prev: string | null
  visited: string[]
  flags: string[]
  items: Record<string, number>
  notes: string[]
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
}

interface Live {
  encounter: Encounter | null
  chase?: Chase | null
  puzzle: string | null
  dialogue: { id: string; node: string } | null
  scene: { seq: number; lines: SoloLine[] } | null
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
  private DIALOG: Map<string, SoloDialogue>

  private run: Run | null = null
  private live: Live = { encounter: null, chase: null, puzzle: null, dialogue: null, scene: null, dead: false }
  private slots: (Slot | null)[] = Array(SAVE_SLOTS).fill(null)
  private feed: SoloView['feed'] = []
  /** номера событий растут и после перезапуска сервера: клиент по ним решает, что уже прозвучало */
  private seq = Math.floor(Date.now() / 1000)
  private timer: ReturnType<typeof setTimeout> | null = null
  private activeSince = Date.now()
  private file: string

  constructor(private info: SoloInfo, story: SoloStory, private token: string, private onChange: () => void, private random = Math.random) {
    this.S = story
    this.PLACE = byId(story.places); this.ITEM = byId(story.items); this.HOT = byId(story.hotspots)
    this.MON = byId(story.monsters); this.SPAWN = byId(story.spawns); this.DIALOG = byId(story.dialogues)
    this.CHASE = byId(story.chases ?? [])
    assignVoiceIds(story)
    this.file = resolve(DATA_DIR, 'solo', story.id, `${token}.json`)
    this.load()
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    this.persist()
  }

  /** последняя вкладка закрыта или ушла в фон: существо не бьёт, пока игрока нет у экрана */
  detached() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.tickPlay()
    this.persist()
  }

  /** игрок вернулся: у него снова полное окно на решение */
  attached() {
    this.activeSince = Date.now()
    this.refreshWindow()
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
      case 'run': return this.run_(msg.index)
    }
    // остальное — только когда герой свободен: не в бою, не в погоне, не в разговоре, не над головоломкой, не в сцене
    if (this.live.encounter || this.live.chase || this.live.scene) return
    if (msg.type === 'choose') return this.choose(msg.index)
    if (msg.type === 'closePuzzle') { this.live.puzzle = null; return this.changed() }
    if (msg.type === 'solve') return this.solve(msg.hotspot, msg.answer)
    if (this.live.dialogue || this.live.puzzle) return
    switch (msg.type) {
      case 'go': return this.go(msg.to)
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
    this.live = { encounter: null, chase: null, puzzle: null, dialogue: null, scene: null, dead: false }
    this.feed = []
    this.activeSince = Date.now()
    if (this.timer) clearTimeout(this.timer)
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
    return true
  }

  private say(text?: string, sfx?: string[], voice?: string, extra: { art?: string; found?: SoloView['feed'][number]['found'] } = {}) {
    if (!text && !sfx?.length && !extra.art && !extra.found) return
    this.feed = [...this.feed, { seq: ++this.seq, text: text ?? '', sfx, voice, ...extra }].slice(-FEED)
  }
  private artOf(item: SoloItem) { return item.art ?? `i_${item.id}` }

  private showScene(lines?: SoloLine[]) {
    if (!lines?.length) return
    this.live.scene = { seq: ++this.seq, lines }
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
    if (e.note && !r.notes.includes(e.note)) r.notes.push(e.note)
    if (e.heal) r.health = clamp(r.health + e.heal)
    if (e.battery) r.battery = clamp(r.battery + e.battery)
    if (e.ammo) r.ammo = Math.max(0, r.ammo + e.ammo)
    for (const [k, v] of Object.entries(e.score ?? {})) r.score[k] = (r.score[k] ?? 0) + v
    if (e.otherworld !== undefined) r.otherworld = e.otherworld
    this.say(e.text, e.sfx, e.voice, { art: e.art })
    this.showScene(e.scene)
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
    if (this.live.dead || this.live.encounter || this.live.chase) return
    const spawn = this.S.spawns.find(s => s.place === to && this.spawnActive(s))
    if (spawn) this.startEncounter(spawn.id)
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
    this.changed()
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
    if (p.kind === 'code') right = norm(answer.join('')) === norm(p.answer)
    else if (p.kind === 'word') right = p.answers.map(norm).includes(norm(answer[0]))
    else right = answer.length === p.answer.length && answer.every((a, i) => norm(a) === norm(p.answer[i]))
    if (!right) { this.say(p.fail, ['solo-wrong']); return this.changed() }
    this.live.puzzle = null
    this.apply({ set: [`solved:${h.id}`] })
    this.apply(p.success)
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
    const s = this.SPAWN.get(spawnId), m = s && this.MON.get(s.monster)
    if (!s || !m || this.run!.killed.includes(s.id)) return
    const now = Date.now()
    this.live.puzzle = null
    this.live.dialogue = null
    const windowMs = this.roundWindow(m)
    this.live.encounter = { spawn: s.id, hp: m.hp, round: 1, startedAt: now, deadline: now + windowMs, windowMs, text: m.text.appear, ...this.rollZones(m, windowMs) }
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
    if (this.has('radio') && r.radioOn !== false) hideWhy.push('приёмник шипит — выдаст')
    const lightHint = !p.dark ? 'Здесь и так светло — фонарь ничего не меняет'
      : r.light ? `Погасить: темнота прячет${m.seesLight ? ' от неё' : ''}, но окна удара станут уже`
      : `Зажечь: окна удара шире${m.seesLight ? ', но она идёт на свет — раунды короче, не спрятаться' : ''}`
    return [
      { id: 'fight', label: melee ? `Ударить: ${melee.name}` : 'Отбиваться руками', enabled: true,
        hint: `${melee ? '' : 'Голыми руками — слабо и окно узкое. '}Бить, когда бегунок в красном окне${dim ? '; в темноте оно уже' : ''}.` },
      // стрелять не из чего — варианта нет вовсе; есть оружие без патронов — вариант виден, но закрыт
      ...(gun ? [{ id: 'shoot' as const, label: r.ammo ? `Стрелять (${r.ammo})` : 'Стрелять: патронов нет', enabled: r.ammo > 0,
        hint: r.ammo ? 'Почти на всё здоровье существа; раунд длиннее.' : 'Патроны кончились.' }] : []),
      { id: 'flee', label: 'Бежать назад', enabled: !!r.prev, hint: prev ? `Назад: ${prev}. В синем окне — уйдёте без удара.` : 'Отступать некуда.' },
      { id: 'hide', label: p.hide ? `Спрятаться: ${p.hide}` : 'Спрятаться', enabled: !!p.hide,
        hint: !p.hide ? 'Здесь негде.' : hideWhy.length ? `Не выйдет: ${hideWhy.join(', ')}.` : 'Существо пройдёт мимо и уйдёт.' },
      ...(this.has('flashlight') ? [{ id: 'light' as const, label: r.light ? 'Погасить фонарь' : 'Включить фонарь', enabled: r.light || r.battery > 0, hint: lightHint }] : [])
    ]
  }

  /** длина раунда: оружие замедляет (tempo), существо, идущее на свет, при зажжённом фонаре торопится */
  private roundWindow(m: SoloMonster) {
    return Math.round(m.windowMs * (this.zoneWeapon().tempo ?? 1) * (m.seesLight && this.run!.light ? 0.75 : 1))
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

  /** окна раунда в миллисекундах от его начала: удар — по оружию и вёрткости существа, побег — по его evade */
  private rollZones(m: SoloMonster, windowMs: number): { hit: [number, number][]; flee: [number, number] | null } {
    const r = this.run!
    const w = this.zoneWeapon()
    const count = Math.max(1, w.zones ?? 1)
    const share = Math.min(0.6, (0.08 + 0.3 * w.accuracy) * (1 - (m.guard ?? 0)) * (this.dim() ? 0.55 : 1))
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
    return { hit, flee: [Math.round(fa * windowMs), Math.round((fa + fleeShare) * windowMs)] }
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer)
    const e = this.live.chase ?? this.live.encounter
    if (!e) return
    this.timer = setTimeout(() => this.onTimeout(), Math.max(0, e.deadline - Date.now()) + 50)
    this.timer.unref?.()
  }

  /** время вышло — существо бьёт само */
  private onTimeout() {
    if (this.live.chase) return this.chaseTimeout()
    const e = this.live.encounter
    if (!e || Date.now() < e.deadline) return this.arm()
    if (this.live.scene) return this.refreshWindow()
    const m = this.MON.get(this.SPAWN.get(e.spawn)!.monster)!
    this.nextRound(m, m.text.attack, [m.sfx.attack], m.damage)
    this.changed()
  }

  /** полное окно на решение с этой секунды */
  private refreshWindow() {
    const now = Date.now()
    const c = this.live.chase
    const spec = c && this.CHASE.get(c.id)
    if (c && spec) { c.startedAt = now; c.deadline = now + spec.windowMs; return this.arm() }
    const e = this.live.encounter
    const m = e && this.MON.get(this.SPAWN.get(e.spawn)?.monster ?? '')
    if (!e || !m) return
    e.startedAt = now
    e.deadline = now + e.windowMs
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
    e.windowMs = this.roundWindow(m)
    e.deadline = now + e.windowMs
    Object.assign(e, this.rollZones(m, e.windowMs))
    this.say('', sfx)
    this.arm()
  }

  private endEncounter(text: string, sfx: string[]) {
    this.live.encounter = null
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.say(text, sfx)
  }

  /** бой на время: удар и побег засчитываются, если нажали, пока бегунок в своём окне (время нажатия — по часам клиента, если они не разошлись) */
  private act(action: 'fight' | 'shoot' | 'flee' | 'hide', at?: number) {
    const e = this.live.encounter
    const r = this.run!
    if (!e) return
    const s = this.SPAWN.get(e.spawn)!, m = this.MON.get(s.monster)!
    const now = Date.now()
    const rel = (typeof at === 'number' && Math.abs(at - now) <= AT_DRIFT ? at : now) - e.startedAt
    const inZone = (z: [number, number] | null) => !!z && rel >= z[0] - ZONE_TOL && rel <= z[1] + ZONE_TOL
    const hit = (dmg: number, loud: boolean) => {
      if (e.hit.some(inZone)) {
        e.hp -= dmg
        if (e.hp <= 0) {
          r.killed.push(s.id); r.kills++
          this.endEncounter(m.text.die, [m.sfx.die])
          return
        }
        // крепкое существо отвечает на удар: голыми руками такой бой выматывает
        if (this.random() > 1 - (m.riposte ?? 0)) this.nextRound(m, `${m.text.hit} ${m.text.attack}`, [loud ? 'solo-shot' : 'solo-swing', m.sfx.hurt, m.sfx.attack], m.damage)
        else this.nextRound(m, m.text.hit, [loud ? 'solo-shot' : 'solo-swing', m.sfx.hurt], 0)
      } else {
        this.nextRound(m, `${m.text.miss} ${m.text.attack}`, [loud ? 'solo-shot' : 'solo-swing', m.sfx.attack], m.damage)
      }
    }
    switch (action) {
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
        if (!p.hide) return
        // укрытие надёжно, если ничем себя не выдать: ни светом (для тех, кто идёт на свет), ни шипящим приёмником
        if (m.seesLight && r.light) { this.nextRound(m, 'Свет фонаря выдаёт укрытие.', [m.sfx.attack], m.damage); break }
        if (this.has('radio') && r.radioOn !== false) { this.nextRound(m, 'Приёмник шипит из-под куртки — и голова существа поворачивается на звук.', ['radio-static', m.sfx.attack], m.damage); break }
        r.passed.push(s.id)
        this.endEncounter(m.text.hide, ['solo-hide'])
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
    if (!option.right) { this.chaseHit(spec, option.text ?? spec.late); return this.changed() }
    this.say('', [spec.sfx.run])
    c.step++
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
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  /* ── сохранения ───────────────────────────────────────────── */

  private saveSlot(slot: number) {
    const r = this.run
    if (!r || !Number.isInteger(slot) || slot < 0 || slot >= SAVE_SLOTS) return
    if (!this.place().save || this.live.encounter || this.live.chase || this.live.dead || r.ending) return
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
    this.live = { encounter: null, chase: null, puzzle: null, dialogue: null, scene: null, dead: false }
    this.feed = []
    this.activeSince = Date.now()
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
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
    if (this.live.encounter || this.live.chase) return 2
    const here = this.place()
    const active = (placeId: string) => this.S.spawns.some(s => s.place === placeId && this.spawnActive(s))
    if (active(here.id)) return 2
    return here.exits.some(x => this.ok(x.when) && active(x.to)) ? 1 : 0
  }

  view(): SoloView {
    const r = this.run
    const empty: SoloView = {
      build: BUILD, info: this.info, speakers: Object.fromEntries(this.S.npcs.map(n => [n.id, n.name])), artFocus: this.S.artFocus ?? {}, started: false, place: null, exits: [], hotspots: [], inventory: [], notes: [], health: 100, battery: 0, light: false,
      ammo: 0, radio: 0, radioOn: true, otherworld: false, weapon: null, map: { areas: this.S.areas, places: [], links: [] }, feed: [], scene: null, encounter: null, chase: null, puzzle: null,
      dialogue: null, dead: false, ending: null, saves: this.saveList(), canSave: false
    }
    if (!r) return empty
    const p = this.place()
    const lit = !p.dark || r.light
    const art = `${r.otherworld && p.other ? 'o' : 'l'}_${p.art ?? p.id}`
    const texts = p.text.filter(t => this.ok(t.when)).map(t => t.text)
    if (p.dark && !r.light) texts.push('Темно. Без света здесь ничего не разглядеть.')
    const now = Date.now()
    const e = this.live.encounter
    const m = e ? this.MON.get(this.SPAWN.get(e.spawn)!.monster)! : null
    const gun = Object.keys(r.items).map(i => this.ITEM.get(i)).find(i => i?.weapon?.usesAmmo && this.has(i.id))
    const dl = this.live.dialogue
    const dNode = dl ? this.DIALOG.get(dl.id)!.nodes[dl.node] : null
    const ph = this.live.puzzle ? this.HOT.get(this.live.puzzle) : null
    const ending = r.ending ? this.S.endings.find(x => x.id === r.ending) : null
    const visited = new Set(r.visited)
    return {
      ...empty,
      started: true,
      place: { id: p.id, area: p.area, name: p.name, art, text: texts, dark: !!p.dark, lit, outdoor: !!p.outdoor, save: p.save ?? null, hide: p.hide ?? null, ambience: (r.otherworld && p.otherAmbience) || p.ambience || [], surface: p.surface ?? 'asphalt' },
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
        return { id, name: it.name, description: it.description, kind: it.kind, icon: it.icon ? `item-${it.icon}` : `kind-${it.kind}`, art: this.artOf(it), count, equipped: r.weapon === id, usable: it.kind === 'heal' || it.kind === 'battery' || it.kind === 'weapon' }
      }),
      notes: r.notes.map(n => this.S.notes.find(x => x.id === n)).filter((x): x is NonNullable<typeof x> => !!x),
      health: r.health, battery: r.battery, light: r.light, ammo: r.ammo, radio: this.radio(), radioOn: r.radioOn !== false, otherworld: r.otherworld,
      weapon: r.weapon ? this.ITEM.get(r.weapon)?.name ?? null : null,
      map: {
        areas: this.S.areas,
        links: this.mapLinks(visited, p),
        places: this.S.places.filter(x => visited.has(x.id) || p.exits.some(ex => ex.to === x.id && this.ok(ex.when))).map(x => ({
          id: x.id, area: x.area, name: x.name, x: x.x, y: x.y, w: x.w, h: x.h, outdoor: !!x.outdoor, surface: x.surface ?? 'asphalt', poi: x.poi ?? (x.outdoor ? 'road' : 'door'), visited: visited.has(x.id), here: x.id === p.id, save: !!x.save,
          locked: r.tried.some(t => t.endsWith(`>${x.id}`)) && !r.opened.some(o => o.split('|').includes(x.id))
        }))
      },
      feed: this.feed,
      scene: this.live.scene,
      encounter: e && m ? {
        monster: m.id, name: m.name, hp: Math.max(0, e.hp), maxHp: m.hp, round: e.round, startedAt: e.startedAt, deadline: e.deadline, serverNow: now, text: e.text,
        windowMs: e.windowMs,
        zones: { hit: e.hit.map(([a, b]) => [e.startedAt + a, e.startedAt + b] as [number, number]), flee: e.flee ? [e.startedAt + e.flee[0], e.startedAt + e.flee[1]] : null },
        options: this.encounterOptions(m, p, gun)
      } : null,
      puzzle: ph?.puzzle ? { hotspot: ph.id, puzzle: this.publicPuzzle(ph) } : null,
      dialogue: dl && dNode ? {
        id: dl.id, npc: this.DIALOG.get(dl.id)!.npc, name: this.S.npcs.find(n => n.id === this.DIALOG.get(dl.id)!.npc)?.name ?? '',
        lines: dNode.lines, choices: (dNode.choices ?? []).filter(c => this.ok(c.when)).map((c, index) => ({ index, text: c.text }))
      } : null,
      chase: this.chaseView(now),
      dead: this.live.dead,
      ending: ending ? { id: ending.id, title: ending.title, lines: ending.scene, stats: { minutes: Math.round(r.playMs / 60000), saves: r.saves, deaths: r.deaths, kills: r.kills } } : null,
      saves: this.saveList(),
      canSave: !!p.save && !e && !this.live.chase && !this.live.dead
    }
  }

  private chaseView(now: number): SoloView['chase'] {
    const c = this.live.chase
    const spec = c && this.CHASE.get(c.id)
    const step = spec?.steps[c!.step]
    if (!c || !spec || !step) return null
    return {
      id: c.id, name: spec.name, art: spec.art, step: c.step, total: spec.steps.length, text: c.text,
      startedAt: c.startedAt, deadline: c.deadline, serverNow: now,
      options: step.options.map((o, index) => ({ index, label: o.label }))
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
        this.refreshWindow()
      }
    } catch (e) { console.warn('одиночная партия не прочиталась:', (e as Error).message) }
  }
}
