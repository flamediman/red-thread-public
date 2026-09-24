/* Бот проходит одиночную историю настоящим движком: осматривает всё, применяет и соединяет вещи, решает головоломки
   (ответы берёт из истории), в разговорах выбирает по линии поведения, дерётся и бежит. Печатает путь и концовку.
     STORY=<история> POLICY=truth|sink|neutral node_modules/.bin/jiti tools/play-solo.ts [--verbose]
   Случайность заменена постоянной (удары всегда попадают), поэтому бот проверяет логику и достижимость, а не баланс боя.
   Разгадки на экран не печатает — только id мест и шаги. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), 'solo-bot-'))
const { SoloGame } = await import('../server/game/solo')
const { SOLO_STORIES } = await import('../server/scenario/index')
type Story = import('../shared/types').SoloStory
type View = import('../shared/types').SoloView

const id = process.env.STORY || Object.keys(SOLO_STORIES)[0]
const entry = id ? SOLO_STORIES[id] : null
if (!entry) { console.error('истории нет:', id, '— есть:', Object.keys(SOLO_STORIES).join(', ')); process.exit(1) }
const policy = (process.env.POLICY ?? 'neutral') as 'truth' | 'sink' | 'neutral'
const verbose = process.argv.includes('--verbose')
const S: Story = entry.story
const g = new SoloGame(entry.info, S, 'bot' + policy.padEnd(12, 'x'), () => {}, () => 0.3) as unknown as {
  handle: (m: import('../shared/types').SoloClientMessage) => void
  view: () => View
  dispose: () => void
}
const V = () => g.view()
const log = (s: string) => { if (verbose) console.log('   ' + s) }

let steps = 0
const looked = new Set<string>()
const usedOn = new Set<string>()
const chosen = new Set<string>()
const encounters: string[] = []
const chases: string[] = []
const bosses: string[] = []
let lastProgress = ''

function skipScene() { let n = 0; while (V().scene && n++ < 20) g.handle({ type: 'sceneDone', seq: V().scene!.seq }) }

function resolveOverlays() {
  let n = 0
  while (n++ < 40) {
    const v = V()
    if (v.ending || v.dead) return
    if (v.scene) { skipScene(); continue }
    if (v.chase) {
      const spec = S.chases!.find(c => c.id === v.chase!.id)!
      const step = spec.steps[v.chase.step]!
      if (!chases.includes(spec.id)) chases.push(spec.id)
      g.handle({ type: 'run', index: step.options.findIndex(o => o.right) })
      continue
    }
    if (v.boss) {
      if (!bosses.includes(v.boss.id)) bosses.push(v.boss.id)
      // серия точек: бот ловит каждую — окна сдвигаем так, чтобы «сейчас» было внутри
      const b = (g as any).live.boss
      const now = Date.now()
      for (const p of b.prompts) { p.from = now - 100; p.to = now + 1000 }
      const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' } as const
      for (const p of [...b.prompts]) g.handle({ type: 'qte', id: p.id, key: p.mirror ? OPP[p.key as keyof typeof OPP] : p.key })
      continue
    }
    if (v.encounter?.dodge) {
      // уворот: бот ловит каждую точку — окна сдвигаем на «сейчас»
      const e = (g as any).live.encounter
      for (const p of e.dodge.prompts) { p.from = Date.now() - 100; p.to = Date.now() + 1000 }
      for (const p of [...e.dodge.prompts]) g.handle({ type: 'qte', id: p.id, key: p.key })
      continue
    }
    if (v.encounter) {
      if (!encounters.includes(v.encounter.monster)) encounters.push(v.encounter.monster)
      const shoot = v.encounter.options.find(o => o.id === 'shoot' && o.enabled)
      // бой на время: бот «нажимает» посреди первого окна удара — сдвигаем начало раунда так, чтобы сейчас было в окне
      const e = (g as any).live.encounter
      if (e?.hit?.length) { e.startedAt = Date.now() - Math.round((e.hit[0][0] + e.hit[0][1]) / 2); e.deadline = e.startedAt + e.windowMs }
      g.handle({ type: 'act', action: shoot && v.encounter.hp > 30 ? 'shoot' : 'fight', gun: shoot?.gun })
      continue
    }
    if (v.dialogue) { choose(v.dialogue); continue }
    if (v.puzzle) { solve(v.puzzle.hotspot); continue }
    return
  }
}

function choose(d: NonNullable<View['dialogue']>) {
  const spec = S.dialogues.find(x => x.id === d.id)!
  const nodeId = Object.entries(spec.nodes).find(([, n]) => n.lines === undefined ? false : n.lines.map(l => l.text).join() === d.lines.map(l => l.text).join())?.[0] ?? ''
  if (!d.choices.length) { g.handle({ type: 'choose', index: 0 }); return }
  const score = (text: string) => {
    const c = Object.values(spec.nodes).flatMap(n => n.choices ?? []).find(x => x.text === text)
    const s = c?.effect?.score ?? {}
    return policy === 'truth' ? (s.truth ?? 0) - (s.sink ?? 0) : policy === 'sink' ? (s.sink ?? 0) - (s.truth ?? 0) : -Math.abs((s.truth ?? 0) + (s.sink ?? 0))
  }
  const leads = (text: string) => !!Object.values(spec.nodes).flatMap(n => n.choices ?? []).find(x => x.text === text)?.to
  const fresh = d.choices.filter(c => !chosen.has(`${d.id}:${nodeId}:${c.text}`))
  const pool = fresh.length ? fresh : d.choices
  // сначала выгодные и ведущие дальше по разговору, прощание — последним
  const best = [...pool].sort((a, b) => score(b.text) - score(a.text) || Number(leads(b.text)) - Number(leads(a.text)))[0]!
  chosen.add(`${d.id}:${nodeId}:${best.text}`)
  log(`разговор ${d.id}: «${best.text.slice(0, 40)}»`)
  g.handle({ type: 'choose', index: best.index })
}

function solve(hotspot: string) {
  const p = S.hotspots.find(h => h.id === hotspot)!.puzzle!
  const answer = p.kind === 'code' ? p.answer.split('') : p.kind === 'word' || p.kind === 'grille' ? [p.answers[0]!] : p.kind === 'clock' ? [p.answer] : p.answer
  g.handle({ type: 'solve', hotspot, answer })
  if (V().puzzle) { console.log(`  ✗ головоломка ${hotspot} не приняла ответ из истории`); g.handle({ type: 'closePuzzle' }) }
  else log(`решено: ${hotspot}`)
}

/** всё, что можно сделать на месте; true — что-то изменилось */
function actHere(): boolean {
  let did = false
  const v0 = V()
  if (v0.health < 50) {
    const heal = v0.inventory.find(i => i.kind === 'heal')
    if (heal) { g.handle({ type: 'heal', item: heal.id }); did = true }
  }
  if (v0.place?.dark && !v0.light && v0.inventory.some(i => i.id === 'flashlight')) { g.handle({ type: 'light', on: true }); did = true }
  for (const it of V().inventory) {
    const spec = S.items.find(x => x.id === it.id)
    for (const c of spec?.combine ?? []) if (V().inventory.some(x => x.id === c.with)) { g.handle({ type: 'combine', item: it.id, with: c.with }); resolveOverlays(); did = true; log(`соединил ${it.id} + ${c.with}`) }
  }
  for (const h of V().hotspots) {
    const key = `${V().place!.id}:${h.id}:${h.done}`
    if (!looked.has(key) && !h.done) {
      looked.add(key)
      g.handle({ type: 'look', hotspot: h.id }); resolveOverlays(); did = true
      log(`осмотр: ${h.id}`)
      if (V().ending) return true
    }
    const spec = S.hotspots.find(x => x.id === h.id)
    for (const u of spec?.use ?? []) {
      const k = `${h.id}:${u.item}`
      if (!usedOn.has(k) && V().inventory.some(i => i.id === u.item)) { usedOn.add(k); g.handle({ type: 'use', item: u.item, hotspot: h.id }); resolveOverlays(); did = true; log(`применил ${u.item} → ${h.id}`) }
    }
  }
  return did
}

function progressKey() {
  const v = V()
  return JSON.stringify([v.inventory.map(i => i.id + i.count), v.notes.length, v.otherworld, v.map.places.length, v.hotspots.map(h => h.id + h.done)])
}

/** путь до места по известной карте (только уже видимые места и открытые двери) */
function pathTo(target: string): string[] | null {
  const from = V().place!.id
  const prev = new Map<string, string>([[from, '']])
  const queue = [from]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === target) break
    const place = S.places.find(p => p.id === cur)!
    for (const x of place.exits) if (!prev.has(x.to)) { prev.set(x.to, cur); queue.push(x.to) }
  }
  if (!prev.has(target)) return null
  const path: string[] = []
  for (let at = target; at !== from; at = prev.get(at)!) path.unshift(at)
  return path
}

g.handle({ type: 'new' })
resolveOverlays()
const stale = new Set<string>()
while (!V().ending && !V().dead && steps++ < 600) {
  resolveOverlays()
  if (V().ending || V().dead) break
  const before = progressKey()
  actHere()
  resolveOverlays()
  if (V().ending || V().dead) break
  if (progressKey() !== before) { stale.clear(); lastProgress = V().place!.id }
  stale.add(V().place!.id)
  // куда идти: ближайший выход в место, где ещё не всё сделано
  const here = V()
  const candidates = here.exits.filter(x => !x.locked && !stale.has(x.to))
  let next = candidates.find(x => !here.map.places.find(p => p.id === x.to)?.visited) ?? candidates[0]
  if (!next) {
    // всё рядом исчерпано — к ближайшему ещё не «застоявшемуся» месту; путь считается по всей карте,
    // но первый шаг должен быть открыт отсюда прямо сейчас (некоторые выходы закрываются по условиям истории)
    const targets = S.places.filter(p => here.map.places.some(m => m.id === p.id) && !stale.has(p.id) && p.id !== here.place!.id)
    const paths = targets.map(t => pathTo(t.id)).filter((p): p is string[] => !!p).sort((a, b) => a.length - b.length)
    for (const path of paths) {
      const x = here.exits.find(e => e.to === path[0] && !e.locked)
      if (x) { next = x; break }
    }
    next ??= here.exits.find(x => x.locked && !stale.has(`lock:${x.to}`))
    if (next?.locked) stale.add(`lock:${next.to}`)
    if (!next) { console.log(`  ✗ бот застрял в ${here.place!.id}: все выходы исчерпаны`); break }
  }
  log(`→ ${next.to}`)
  g.handle({ type: 'go', to: next.to })
}
const v = V()
const score = (g as unknown as { run: { score: Record<string, number>; deaths: number; kills: number } }).run
console.log(`${policy}: ${v.ending ? `концовка «${v.ending.title}»` : v.dead ? 'смерть' : 'не дошёл'} · шагов ${steps} · мест ${v.map.places.filter(p => p.visited).length}/${S.places.length} · записок ${v.notes.length}/${S.notes.length}`)
console.log(`  метрики ${Object.entries(score.score).map(([k, n]) => `${k} ${n}`).join(', ') || '—'} · встречи: ${encounters.join(', ') || '—'} · боссы: ${bosses.join(', ') || '—'} · погони: ${chases.join(', ') || '—'} · последнее продвижение: ${lastProgress}`)
if (!v.ending) process.exitCode = 1
g.dispose()
rmSync(process.env.DATA_DIR!, { recursive: true, force: true })
