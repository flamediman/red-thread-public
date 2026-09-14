/* Проверка одиночной истории («Туман»): ссылки, замки, достижимость мест и концовок, файлы картинок и звуков.
     STORY=<история> node_modules/.bin/jiti tools/check-solo.ts
   Достижимость считается грубо и с запасом: всё полученное остаётся навсегда (без «забрать» и расхода ключей),
   условия «ещё нет» считаются выполнимыми. Если здесь что-то недостижимо — в игре тем более. */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { SOLO_STORIES } from '../server/scenario'
import { caseDir } from './paths.mjs'
import type { SoloCond, SoloEffect, SoloLine, SoloStory } from '../shared/types'

const id = process.env.STORY || Object.keys(SOLO_STORIES)[0]
const entry = id ? SOLO_STORIES[id] : null
if (!entry) { console.error('истории нет:', id, '— есть:', Object.keys(SOLO_STORIES).join(', ')); process.exit(1) }
const S: SoloStory = entry.story
const errors: string[] = []
const warns: string[] = []
const err = (m: string) => errors.push(m)
const warn = (m: string) => warns.push(m)

/* ── уникальность ── */
const ids = new Map<string, string>()
const table = { place: S.places, hotspot: S.hotspots, item: S.items, note: S.notes, monster: S.monsters, spawn: S.spawns, npc: S.npcs, dialogue: S.dialogues, ending: S.endings, area: S.areas }
for (const [kind, list] of Object.entries(table)) {
  for (const x of list as { id: string }[]) {
    const key = `${kind}:${x.id}`
    if (ids.has(key)) err(`повтор id ${key}`)
    ids.set(key, kind)
  }
}
const has = (kind: keyof typeof table, x: string) => ids.has(`${kind}:${x}`)

/* ── ссылки ── */
const setFlags = new Set<string>(S.start.flags ?? [])
const usedFlags = new Map<string, string>()
const sfxUsed = new Map<string, string>()
const artUsed = new Map<string, string>()

function cond(c: SoloCond | undefined, where: string) {
  if (!c) return
  for (const f of [...(c.flags ?? []), ...(c.notFlags ?? [])]) if (!f.startsWith('solved:')) usedFlags.set(f, where)
  for (const i of [...(c.items ?? []), ...(c.notItems ?? [])]) if (!has('item', i)) err(`${where}: условие на неизвестный предмет ${i}`)
}
function lines(ls: SoloLine[] | undefined, where: string) {
  for (const l of ls ?? []) {
    if (l.speaker !== 'narrator' && l.speaker !== 'hero' && !has('npc', l.speaker)) err(`${where}: говорит неизвестный ${l.speaker}`)
    if (l.art && l.art !== 'letter') artUsed.set(l.art, where)
    for (const s of l.sfx ?? []) sfxUsed.set(s, where)
  }
}
function effect(e: SoloEffect | undefined, where: string) {
  if (!e) return
  for (const i of [...(e.give ?? []), ...(e.take ?? [])]) if (!has('item', i)) err(`${where}: неизвестный предмет ${i}`)
  for (const f of e.set ?? []) setFlags.add(f)
  if (e.note && !has('note', e.note)) err(`${where}: неизвестная записка ${e.note}`)
  if (e.encounter && !has('spawn', e.encounter)) err(`${where}: неизвестное появление ${e.encounter}`)
  if (e.goto && !has('place', e.goto)) err(`${where}: переход в неизвестное место ${e.goto}`)
  if (e.ending && e.ending !== 'auto' && !has('ending', e.ending)) err(`${where}: неизвестная концовка ${e.ending}`)
  for (const s of e.sfx ?? []) sfxUsed.set(s, where)
  lines(e.scene, where)
}

if (!has('place', S.start.place)) err(`старт: нет места ${S.start.place}`)
for (const i of S.start.items) if (!has('item', i)) err(`старт: нет предмета ${i}`)
for (const n of S.start.notes ?? []) if (!has('note', n)) err(`старт: нет записки ${n}`)
lines(S.start.scene, 'пролог')

for (const p of S.places) {
  const w = `место ${p.id}`
  if (!has('area', p.area)) err(`${w}: нет района ${p.area}`)
  if (p.x < 0 || p.y < 0 || p.x + p.w > 100 || p.y + p.h > 100) warn(`${w}: прямоугольник на плане выходит за край`)
  for (const q of S.places) {
    if (q === p || q.area !== p.area || q.id < p.id) continue
    if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) warn(`план: ${p.id} и ${q.id} наезжают друг на друга`)
  }
  if (!p.text.length) err(`${w}: нет описания`)
  p.text.forEach((t, i) => cond(t.when, `${w} текст ${i}`))
  effect(p.enter, `${w} первый вход`)
  artUsed.set(`l_${p.art ?? p.id}`, w)
  if (p.other) artUsed.set(`o_${p.art ?? p.id}`, w)
  for (const s of p.ambience ?? []) sfxUsed.set(s, w)
  sfxUsed.set(`step-${p.surface ?? 'asphalt'}`, w)
  for (const x of p.exits) {
    const wx = `${w} → ${x.to}`
    if (!has('place', x.to)) { err(`${wx}: нет такого места`); continue }
    cond(x.when, wx)
    if (x.lock?.item && !has('item', x.lock.item)) err(`${wx}: замок на неизвестный предмет ${x.lock.item}`)
    if (x.lock?.flag) usedFlags.set(x.lock.flag, wx)
    effect(x.lock?.open, `${wx} открытие`)
    for (const s of x.sfx ?? []) sfxUsed.set(s, wx)
    const back = S.places.find(q => q.id === x.to)?.exits.some(y => y.to === p.id)
    if (!back) warn(`${wx}: обратного пути нет (так задумано?)`)
  }
}

for (const h of S.hotspots) {
  const w = `осмотр ${h.id}`
  if (!has('place', h.place)) err(`${w}: нет места ${h.place}`)
  cond(h.when, w); cond(h.hideWhen, w)
  effect(h.look, w)
  for (const u of h.use ?? []) { if (!has('item', u.item)) err(`${w}: применяют неизвестный ${u.item}`); effect(u.effect, `${w} + ${u.item}`) }
  if (h.talk && !S.dialogues.some(d => d.id === h.talk)) err(`${w}: нет разговора ${h.talk}`)
  const p = h.puzzle
  if (p) {
    effect(p.success, `${w} решение`)
    setFlags.add(`solved:${h.id}`)
    if (p.kind === 'code') {
      if (p.answer.length !== p.length) err(`${w}: ответ «${p.answer}» не той длины (${p.length})`)
      if (p.alphabet === 'digits' && !/^\d+$/.test(p.answer)) err(`${w}: в цифровом замке ответ не из цифр`)
    }
    if (p.kind === 'dials') p.answer.forEach((a, i) => { if (!p.dials[i]?.values.includes(a)) err(`${w}: на диске ${i + 1} нет значения «${a}»`) })
    if (p.kind === 'dials' && p.answer.length !== p.dials.length) err(`${w}: ответов не столько, сколько дисков`)
    if (p.kind === 'sequence') for (const a of p.answer) if (!p.buttons.some(b => b.id === a)) err(`${w}: в последовательности нет кнопки ${a}`)
    if (p.kind === 'word' && !p.answers.length) err(`${w}: у слова нет ответов`)
  }
  if (!h.look && !h.puzzle && !h.talk && !h.use?.length) err(`${w}: с ним ничего нельзя сделать`)
}

for (const it of S.items) {
  for (const c of it.combine ?? []) {
    if (!has('item', c.with)) err(`предмет ${it.id}: соединяют с неизвестным ${c.with}`)
    if (!has('item', c.result)) err(`предмет ${it.id}: получается неизвестный ${c.result}`)
  }
  if (it.kind === 'weapon' && !it.weapon) err(`предмет ${it.id}: оружие без характеристик`)
  if (!it.icon) warn(`предмет ${it.id}: нет своего значка — в карманах будет общий по виду`)
}

for (const m of S.monsters) {
  for (const s of Object.values(m.sfx)) sfxUsed.set(s, `существо ${m.id}`)
  artUsed.set(`m_${m.id}`, `существо ${m.id}`)
  if (m.windowMs < 2500) warn(`существо ${m.id}: на решение меньше 2,5 с — на планшете не успеть`)
}
for (const s of S.spawns) {
  if (!has('monster', s.monster)) err(`появление ${s.id}: нет существа ${s.monster}`)
  if (!has('place', s.place)) err(`появление ${s.id}: нет места ${s.place}`)
  cond(s.when, `появление ${s.id}`)
}
for (const n of S.npcs) artUsed.set(`n_${n.id}`, `персонаж ${n.id}`)

for (const d of S.dialogues) {
  const w = `разговор ${d.id}`
  if (!has('npc', d.npc)) err(`${w}: нет персонажа ${d.npc}`)
  if (!d.nodes[d.start]) err(`${w}: нет начального узла ${d.start}`)
  const reached = new Set([d.start])
  const queue = [d.start]
  while (queue.length) {
    const node = d.nodes[queue.shift()!]
    for (const c of node?.choices ?? []) if (c.to && !reached.has(c.to)) { reached.add(c.to); queue.push(c.to) }
  }
  for (const [nid, node] of Object.entries(d.nodes)) {
    const wn = `${w}/${nid}`
    if (!reached.has(nid)) warn(`${wn}: до узла не дойти`)
    lines(node.lines, wn)
    effect(node.effect, wn)
    for (const c of node.choices ?? []) {
      if (c.to && !d.nodes[c.to]) err(`${wn}: вариант ведёт в несуществующий узел ${c.to}`)
      cond(c.when, wn); effect(c.effect, `${wn} «${c.text.slice(0, 20)}»`)
    }
  }
}

for (const e of S.endings) lines(e.scene, `концовка ${e.id}`)
for (const r of S.endingRules) { if (!has('ending', r.ending)) err(`правило концовки: нет ${r.ending}`); cond(r.when, `правило ${r.ending}`) }
if (S.endingRules.length && S.endingRules.at(-1)!.when) warn('последнее правило концовок с условием — если ничего не подойдёт, возьмётся последняя концовка списка')

for (const [f, where] of usedFlags) if (!setFlags.has(f)) err(`${where}: флаг «${f}» нигде не ставится`)

/* ── достижимость: всё полученное — навсегда ── */
const got = { flags: new Set<string>(S.start.flags ?? []), items: new Set<string>(S.start.items), places: new Set<string>([S.start.place]), endings: new Set<string>(), score: {} as Record<string, number> }
const okCond = (c?: SoloCond) => !c || ((c.flags ?? []).every(f => got.flags.has(f)) && (c.items ?? []).every(i => got.items.has(i)))
const taken = new Set<string>()
function take(key: string, e: SoloEffect | undefined) {
  if (!e || taken.has(key)) return false
  taken.add(key)
  for (const i of e.give ?? []) got.items.add(i)
  for (const f of e.set ?? []) got.flags.add(f)
  if (e.goto) got.places.add(e.goto)
  if (e.ending) got.endings.add(e.ending)
  return true
}
let changed = true
let rounds = 0
while (changed && rounds++ < 200) {
  changed = false
  for (const p of S.places) {
    if (!got.places.has(p.id)) continue
    if (take(`enter:${p.id}`, p.enter)) changed = true
    for (const x of p.exits) {
      if (!okCond(x.when) || got.places.has(x.to)) continue
      const open = !x.lock || (x.lock.item && got.items.has(x.lock.item)) || (x.lock.flag && got.flags.has(x.lock.flag))
      if (open) { got.places.add(x.to); take(`open:${p.id}>${x.to}`, x.lock?.open); changed = true }
    }
  }
  for (const h of S.hotspots) {
    if (!got.places.has(h.place) || !okCond(h.when)) continue
    if (h.look && take(`look:${h.id}`, h.look)) changed = true
    if (h.puzzle && take(`solve:${h.id}`, { ...h.puzzle.success, set: [...(h.puzzle.success.set ?? []), `solved:${h.id}`] })) changed = true
    for (const u of h.use ?? []) if (got.items.has(u.item) && take(`use:${h.id}:${u.item}`, u.effect)) changed = true
    const d = h.talk ? S.dialogues.find(x => x.id === h.talk) : null
    for (const [nid, node] of Object.entries(d?.nodes ?? {})) {
      if (take(`node:${d!.id}:${nid}`, node.effect)) changed = true
      node.choices?.forEach((c, i) => { if (okCond(c.when) && take(`choice:${d!.id}:${nid}:${i}`, c.effect)) changed = true })
    }
  }
  for (const it of S.items) for (const c of it.combine ?? []) if (got.items.has(it.id) && got.items.has(c.with) && !got.items.has(c.result)) { got.items.add(c.result); changed = true }
}
for (const p of S.places) if (!got.places.has(p.id)) err(`до места ${p.id} не добраться`)
const endingReach = got.endings.has('auto') ? new Set(S.endingRules.map(r => r.ending)) : new Set<string>()
for (const e of got.endings) if (e !== 'auto') endingReach.add(e)
for (const e of S.endings) if (!endingReach.has(e.id)) err(`концовка ${e.id} недостижима`)
for (const x of S.places.flatMap(p => p.exits)) if (x.lock?.item && !got.items.has(x.lock.item)) err(`ключ ${x.lock.item} не получить`)
for (const it of S.items) if (!got.items.has(it.id)) warn(`предмет ${it.id} не получить`)
const notesGiven = new Set([...taken].length ? collectNotes() : [])
for (const n of S.notes) if (!notesGiven.has(n.id)) warn(`записку ${n.id} нигде не дают`)
function collectNotes() {
  const out = new Set<string>(S.start.notes ?? [])
  const add = (e?: SoloEffect) => { if (e?.note) out.add(e.note) }
  for (const p of S.places) { add(p.enter); p.exits.forEach(x => add(x.lock?.open)) }
  for (const h of S.hotspots) { add(h.look); add(h.puzzle?.success); h.use?.forEach(u => add(u.effect)) }
  for (const d of S.dialogues) for (const node of Object.values(d.nodes)) { add(node.effect); node.choices?.forEach(c => add(c.effect)) }
  return out
}

/* ── метрики концовок: максимум, который можно набрать (в разговоре — лучший вариант в каждом узле) ── */
const maxScore: Record<string, number> = {}
const addScore = (e?: SoloEffect) => { for (const [k, v] of Object.entries(e?.score ?? {})) if (v > 0) maxScore[k] = (maxScore[k] ?? 0) + v }
for (const p of S.places) addScore(p.enter)
for (const h of S.hotspots) { addScore(h.look); addScore(h.puzzle?.success); h.use?.forEach(u => addScore(u.effect)) }
for (const d of S.dialogues) for (const node of Object.values(d.nodes)) {
  addScore(node.effect)
  const best: Record<string, number> = {}
  for (const c of node.choices ?? []) for (const [k, v] of Object.entries(c.effect?.score ?? {})) best[k] = Math.max(best[k] ?? 0, v)
  for (const [k, v] of Object.entries(best)) maxScore[k] = (maxScore[k] ?? 0) + v
}
for (const r of S.endingRules) for (const [k, v] of Object.entries(r.score ?? {})) if ((maxScore[k] ?? 0) < v) err(`концовка ${r.ending}: нужно ${k} ≥ ${v}, а набрать можно максимум ${maxScore[k] ?? 0}`)

/* ── файлы ── */
const artDir = resolve(caseDir(S.id), 'art')
const missingArt = [...artUsed.keys()].filter(a => !existsSync(resolve(artDir, `${a}.jpg`)))
if (!artUsed.has('cover') && !existsSync(resolve(artDir, 'cover.jpg'))) missingArt.push('cover')
const sfxDir = resolve(import.meta.dirname, '../public/sfx')
const missingSfx = [...sfxUsed.keys()].filter(s => !existsSync(resolve(sfxDir, entry.info.settingId, `${s}.m4a`)) && !existsSync(resolve(sfxDir, `${s}.m4a`)))

console.log(`«${S.title}»: мест ${S.places.length}, осмотров ${S.hotspots.length}, предметов ${S.items.length}, записок ${S.notes.length}, существ ${S.monsters.length}, разговоров ${S.dialogues.length}, концовок ${S.endings.length}`)
console.log(`максимум метрик: ${Object.entries(maxScore).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`)
if (missingArt.length) console.log(`нет картинок (${missingArt.length}): ${missingArt.join(', ')}`)
if (missingSfx.length) console.log(`нет звуков (${missingSfx.length}): ${missingSfx.join(', ')}`)
for (const w of warns) console.log('  ! ' + w)
for (const e of errors) console.log('  ✗ ' + e)
console.log(errors.length ? `ошибок: ${errors.length}` : 'ошибок нет')
if (errors.length) process.exitCode = 1
