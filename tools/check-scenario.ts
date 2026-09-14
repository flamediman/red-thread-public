/* Проверка честности сценария. Запуск: node --no-warnings tools/check-scenario.ts
   Печатает только числа и id — ни одной реплики, чтобы отчёт не спойлерил. */
import { SCENARIO as S } from '../server/scenario/index'
import type { Requirement } from '../shared/types'

const errors: string[] = []
const warn: string[] = []
const has = <T extends { id: string }>(arr: T[]) => new Set(arr.map(x => x.id))

const locs = has(S.locations), wits = has(S.witnesses), spots = has(S.spots), items = has(S.items)
const qs = has(S.questions), facts = has(S.facts), dets = has(S.detectives)

/* ── ссылки ── */
for (const w of S.witnesses) {
  if (w.schedule.length < S.scheduleLength) errors.push(`расписание ${w.id}: ${w.schedule.length} < ${S.scheduleLength}`)
  for (const l of w.schedule) if (!locs.has(l)) errors.push(`расписание ${w.id}: нет локации ${l}`)
}
for (const l of S.locations) for (const a of l.adjacent) if (!locs.has(a)) errors.push(`соседи ${l.id}: нет ${a}`)
for (const sp of S.spots) {
  if (!locs.has(sp.locationId)) errors.push(`место ${sp.id}: нет локации ${sp.locationId}`)
  for (const f of [sp.primary, sp.hidden, sp.memory]) {
    if (!f) continue
    if (f.itemId && !items.has(f.itemId)) errors.push(`место ${sp.id}: нет предмета ${f.itemId}`)
    if (f.factId && !facts.has(f.factId)) errors.push(`место ${sp.id}: нет факта ${f.factId}`)
  }
  if (sp.locked?.keyItemId && !items.has(sp.locked.keyItemId)) errors.push(`место ${sp.id}: нет ключа ${sp.locked.keyItemId}`)
}
const checkReq = (owner: string, r?: Requirement) => {
  for (const i of r?.items ?? []) if (!items.has(i)) errors.push(`${owner}: requires предмет ${i} не существует`)
  for (const f of r?.facts ?? []) if (!facts.has(f)) errors.push(`${owner}: requires факт ${f} не существует`)
}
for (const q of S.questions) {
  if (!wits.has(q.witnessId)) errors.push(`вопрос ${q.id}: нет свидетеля ${q.witnessId}`)
  if (q.factId && !facts.has(q.factId)) errors.push(`вопрос ${q.id}: нет факта ${q.factId}`)
  for (const u of q.unlocks ?? []) if (!qs.has(u)) errors.push(`вопрос ${q.id}: unlocks ${u} не существует`)
  checkReq(`вопрос ${q.id}`, q.requires)
}
for (const p of S.presentations) {
  if (!wits.has(p.witnessId)) errors.push(`предъявление ${p.id}: нет свидетеля`)
  if (!items.has(p.itemId)) errors.push(`предъявление ${p.id}: нет предмета ${p.itemId}`)
  if (p.factId && !facts.has(p.factId)) errors.push(`предъявление ${p.id}: нет факта ${p.factId}`)
  for (const u of p.unlocks ?? []) if (!qs.has(u)) errors.push(`предъявление ${p.id}: unlocks ${u} не существует`)
  checkReq(`предъявление ${p.id}`, p.requires)
}
// честные варианты: только у лжи, карточки существуют, id реплик не пересекаются
for (const x of [...S.questions, ...S.presentations]) {
  if (!x.honest?.length) continue
  if (!x.answer.lie) errors.push(`${x.id}: честный вариант у правдивого ответа`)
  for (const h of x.honest) {
    if (!h.when.length) errors.push(`${x.id}: у честного варианта пустой when`)
    for (const f of [...h.when, ...(h.facts ?? [])]) if (!facts.has(f)) errors.push(`${x.id}: честный вариант ссылается на несуществующий факт ${f}`)
    if (x.factId && h.when.includes(x.factId)) errors.push(`${x.id}: честный вариант ждёт собственную лживую карточку`)
  }
}
// режим «на время»: вопросы доски и запертые места
const board = S.realtime?.board ?? []
for (const q of board) {
  if (!facts.has(q.yieldsFactId)) errors.push(`вопрос доски ${q.id}: нет факта ${q.yieldsFactId}`)
  if (!q.answers.length) errors.push(`вопрос доски ${q.id}: нет ни одного ответа`)
  for (const a of q.answers) {
    if (a.length !== q.slots) errors.push(`вопрос доски ${q.id}: набор из ${a.length} карточек, а мест ${q.slots}`)
    for (const f of a) if (!facts.has(f)) errors.push(`вопрос доски ${q.id}: нет факта ${f}`)
    if (a.includes(q.yieldsFactId)) errors.push(`вопрос доски ${q.id}: вывод среди собственных карточек`)
  }
  checkReq(`вопрос доски ${q.id}`, q.requires)
}
for (const l of S.locations) if (l.locked?.keyItemId && !items.has(l.locked.keyItemId)) errors.push(`место ${l.id}: нет ключа ${l.locked.keyItemId}`)
for (const e of S.events ?? []) for (const sp of e.spotsGone ?? []) if (!spots.has(sp)) errors.push(`событие ${e.beat.id}: нет места ${sp}`)
if (S.realtime && !S.realtime.board.length) warn.push('дело «на время» без вопросов доски')
for (const c of S.contradictions) {
  for (const f of c.facts) if (!facts.has(f)) errors.push(`противоречие ${c.id}: нет факта ${f}`)
  if (c.yieldsFactId && !facts.has(c.yieldsFactId)) errors.push(`противоречие ${c.id}: нет факта ${c.yieldsFactId}`)
}
for (const h of S.hints) for (const f of h.missingAll) if (!facts.has(f)) errors.push(`подсказка ${h.beat.id}: нет факта ${f}`)
for (const o of S.overheard) if (o.factId && !facts.has(o.factId)) errors.push(`подслушанное ${o.beat.id}: нет факта`)
for (const [w, b] of Object.entries(S.backgrounds)) {
  if (!wits.has(w)) errors.push(`прошлое: нет свидетеля ${w}`)
  if (!facts.has(b.factId)) errors.push(`прошлое ${w}: нет факта ${b.factId}`)
}
for (const w of S.witnesses) if (!S.backgrounds[w.id]) warn.push(`у ${w.id} нет факта из прошлого для репортёра`)
const acc = S.accusation
if (!wits.has(acc.solution.culprit)) errors.push('обвинение: виновный не существует')
if (!acc.methods.some(m => m.id === acc.solution.method)) errors.push('обвинение: способа нет в списке')
if (!acc.motives.some(m => m.id === acc.solution.motive)) errors.push('обвинение: мотива нет в списке')
for (const w of S.witnesses) if (!acc.defenses[w.id]) errors.push(`обвинение: нет защиты для ${w.id}`)
for (const [w, d] of Object.entries(acc.defenses)) if (d.factId && !facts.has(d.factId)) errors.push(`защита ${w}: нет факта`)
if (!items.has(S.epilogue.branch.itemId)) errors.push('финал: предмет развилки не существует')
if (S.memoryItemId && !items.has(S.memoryItemId)) errors.push('проигрыватель памяти: предмета нет')
if (S.spots.some(sp => sp.memory) && !S.memoryItemId) errors.push('есть слои памяти, но нет memoryItemId — без брейнданс-техника они недостижимы')
for (const m of S.market ?? []) {
  if (!items.has(m.itemId)) errors.push(`рынок: нет предмета ${m.itemId}`)
  const elsewhere = S.spots.some(sp => [sp.primary, sp.hidden, sp.memory].some(l => l?.itemId === m.itemId)) || (S.events ?? []).some(e => e.itemId === m.itemId)
  if (!elsewhere) errors.push(`рынок: предмет ${m.itemId} достаётся только у фиксера — способность запирает контент`)
}
for (const e of S.events ?? []) {
  if (e.factId && !facts.has(e.factId)) errors.push(`событие ${e.beat.id}: нет факта ${e.factId}`)
  if (e.itemId && !items.has(e.itemId)) errors.push(`событие ${e.beat.id}: нет предмета ${e.itemId}`)
}
if (S.coroner && !facts.has(S.coroner.factId)) errors.push('судмедэксперт: нет факта')

/* ── факты без источника ── */
const sources = new Map<string, string[]>()
const src = (f: string | undefined, by: string) => { if (f) sources.set(f, [...(sources.get(f) ?? []), by]) }
for (const sp of S.spots) { src(sp.primary.factId, 'осмотр ' + sp.id); src(sp.hidden?.factId, 'скрытый ' + sp.id); src(sp.memory?.factId, 'память ' + sp.id) }
for (const e of S.events ?? []) src(e.factId, 'событие')
for (const q of S.questions) src(q.factId, 'вопрос ' + q.id)
for (const p of S.presentations) src(p.factId, 'предъявление ' + p.id)
for (const x of [...S.questions, ...S.presentations]) for (const h of x.honest ?? []) for (const f of h.facts ?? []) src(f, 'честный ответ ' + x.id)
for (const c of S.contradictions) src(c.yieldsFactId, 'противоречие ' + c.id)
for (const q of board) src(q.yieldsFactId, 'доска ' + q.id)
for (const o of S.overheard) src(o.factId, 'подслушано')
for (const b of Object.values(S.backgrounds)) src(b.factId, 'прошлое')
for (const d of Object.values(acc.defenses)) src(d.factId, 'защита')
if (S.coroner) src(S.coroner.factId, 'судмедэксперт')
for (const f of S.facts) if (!sources.has(f.id)) errors.push(`факт ${f.id} ниоткуда не берётся`)

/* ── дубли id ── */
const dup = (arr: { id: string }[], name: string) => {
  const seen = new Set<string>()
  for (const x of arr) { if (seen.has(x.id)) errors.push(`дубль id в ${name}: ${x.id}`); seen.add(x.id) }
}
dup(S.questions, 'вопросах'); dup(S.presentations, 'предъявлениях'); dup(board, 'вопросах доски'); dup(S.facts, 'фактах'); dup(S.spots, 'местах'); dup(S.items, 'предметах')
const beatIds = [...S.prologue, ...S.epilogue.truth, ...S.epilogue.branch.found, ...S.epilogue.branch.lost, S.epilogue.closing,
  ...S.hints.map(h => h.beat), ...S.overheard.map(o => o.beat), ...Object.values(S.backgrounds).map(b => b.beat),
  ...Object.values(acc.defenses).map(d => d.beat), ...S.witnesses.flatMap(w => [w.greeting, w.idle]), ...(S.events ?? []).map(e => e.beat)]
dup(beatIds, 'репликах')

/* ── достижимость: жадный обход без способностей ──
   Состояние: предметы, факты, открытые вопросы. Каждый шаг — одно действие бригады.
   Считаем, за сколько действий достижимы все ключевые факты и признание. */
/** грузовик уехал: места, которые исчезают по ходу партии */
const GONE = new Set((S.events ?? []).flatMap(e => e.spotsGone ?? []))
const LOC = new Map(S.locations.map(l => [l.id, l]))

function solve(opts: { forensic: boolean; burglar: boolean; withoutGone?: boolean }) {
  const have = { items: new Set<string>(), facts: new Set<string>(), asked: new Set<string>(), presented: new Set<string>(), searched: new Set<string>(), hidden: new Set<string>(), unlocked: new Set<string>() }
  const reqOk = (r?: Requirement) => (r?.items ?? []).every(i => have.items.has(i)) && (r?.facts ?? []).every(f => have.facts.has(f))
  // запертое место («на время»): войти с ключом или взломщику
  const open = (locId: string) => { const l = LOC.get(locId); return !l?.locked || opts.burglar || (!!l.locked.keyItemId && have.items.has(l.locked.keyItemId)) }
  const reachable = (witnessId: string) => S.witnesses.find(w => w.id === witnessId)?.schedule.some(open) ?? false
  const applyContradictions = () => {
    let changed = true
    while (changed) {
      changed = false
      for (const c of S.contradictions) {
        if (c.yieldsFactId && !have.facts.has(c.yieldsFactId) && have.facts.has(c.facts[0]) && have.facts.has(c.facts[1])) { have.facts.add(c.yieldsFactId); changed = true }
      }
      // доска дела: команда прикалывает подходящий набор
      for (const q of board) {
        if (have.facts.has(q.yieldsFactId) || !reqOk(q.requires)) continue
        if (q.answers.some(a => a.every(f => have.facts.has(f)))) { have.facts.add(q.yieldsFactId); changed = true }
      }
    }
  }
  let actions = 0
  // события ночи случаются сами — считаем их полученными
  for (const e of S.events ?? []) { if (e.itemId) have.items.add(e.itemId); if (e.factId) have.facts.add(e.factId) }
  const memoryDone = new Set<string>()
  for (let step = 0; step < 400; step++) {
    let did = false
    // осмотр: первый — верхний слой, второй (или криминалист сразу) — скрытый, память — с проигрывателем
    for (const sp of S.spots) {
      if (!open(sp.locationId) || (opts.withoutGone && GONE.has(sp.id))) continue
      const grab = (f: typeof sp.primary) => { if (f.itemId) have.items.add(f.itemId); if (f.factId) have.facts.add(f.factId) }
      if (sp.memory && have.searched.has(sp.id) && !memoryDone.has(sp.id) && S.memoryItemId && have.items.has(S.memoryItemId)) { memoryDone.add(sp.id); actions++; grab(sp.memory); did = true; break }
      if (!have.searched.has(sp.id)) {
        if (sp.locked && !(sp.locked.keyItemId && have.items.has(sp.locked.keyItemId)) && !opts.burglar) continue
        have.searched.add(sp.id); actions++
        grab(sp.primary)
        if (opts.forensic && sp.hidden) { have.hidden.add(sp.id); grab(sp.hidden) }
        did = true; break
      }
      if (sp.hidden && !have.hidden.has(sp.id)) { have.hidden.add(sp.id); actions++; grab(sp.hidden); did = true; break }
    }
    if (did) { applyContradictions(); continue }
    for (const q of S.questions) {
      if (have.asked.has(q.id)) continue
      if (!q.initial && !have.unlocked.has(q.id)) continue
      if (!reqOk(q.requires) || !reachable(q.witnessId)) continue
      have.asked.add(q.id); actions++
      if (q.factId) have.facts.add(q.factId)
      for (const u of q.unlocks ?? []) have.unlocked.add(u)
      did = true; break
    }
    if (did) { applyContradictions(); continue }
    for (const p of S.presentations) {
      if (have.presented.has(p.id) || !have.items.has(p.itemId) || !reqOk(p.requires) || !reachable(p.witnessId)) continue
      have.presented.add(p.id); actions++
      if (p.factId) have.facts.add(p.factId)
      for (const u of p.unlocks ?? []) have.unlocked.add(u)
      did = true; break
    }
    if (did) { applyContradictions(); continue }
    break
  }
  const keyFacts = S.facts.filter(f => f.key).map(f => f.id)
  const missingKey = keyFacts.filter(f => !have.facts.has(f))
  const unreachableQ = S.questions.filter(q => !have.asked.has(q.id)).map(q => q.id)
  const unreachableP = S.presentations.filter(p => !have.presented.has(p.id)).map(p => p.id)
  const unreachableSpots = S.spots.filter(s => !have.searched.has(s.id) && !(opts.withoutGone && GONE.has(s.id))).map(s => s.id)
  const unreachableMemory = S.spots.filter(sp => sp.memory && !memoryDone.has(sp.id)).map(sp => sp.id)
  const goal = S.checks?.goal
  const missingChain = (S.checks?.chain ?? []).filter(f => !have.facts.has(f))
  return { actions, facts: have.facts.size, factSet: have.facts, items: have.items.size, missingKey, missingChain, unreachableQ, unreachableP, unreachableSpots, unreachableMemory, confession: goal ? have.facts.has(goal) : true, logbook: have.items.has(S.epilogue.branch.itemId) }
}

const plain = solve({ forensic: false, burglar: false })
const full = solve({ forensic: true, burglar: true })
/* то, что уезжает (грузовик в семь), ускоряет, но не запирает: без этих мест цель и цепочка всё равно достижимы */
const noGone = GONE.size ? solve({ forensic: false, burglar: false, withoutGone: true }) : null

/* ── минимальный путь до обвинения: сколько действий нужно до признания ── */
function shortest(target: string) {
  type Have = { items: Set<string>; facts: Set<string>; asked: Set<string>; presented: Set<string>; searched: Set<string>; hidden: Set<string>; unlocked: Set<string> }
  const have: Have = { items: new Set(), facts: new Set(), asked: new Set(), presented: new Set(), searched: new Set(), hidden: new Set(), unlocked: new Set() }
  for (const e of S.events ?? []) { if (e.itemId) have.items.add(e.itemId); if (e.factId) have.facts.add(e.factId) }
  const reqOk = (r?: Requirement) => (r?.items ?? []).every(i => have.items.has(i)) && (r?.facts ?? []).every(f => have.facts.has(f))
  const contr = () => { let c = true; while (c) { c = false
    for (const k of S.contradictions) if (k.yieldsFactId && !have.facts.has(k.yieldsFactId) && have.facts.has(k.facts[0]) && have.facts.has(k.facts[1])) { have.facts.add(k.yieldsFactId); c = true }
    for (const q of board) if (!have.facts.has(q.yieldsFactId) && reqOk(q.requires) && q.answers.some(a => a.every(x => have.facts.has(x)))) { have.facts.add(q.yieldsFactId); c = true } } }

  // что нужно (факты и предметы), раскручиваем назад от цели
  const need = new Set<string>([target]); const queue = [target]
  const push = (x?: string) => { if (x && !need.has(x)) { need.add(x); queue.push(x) } }
  const unlockersOf = (qid: string) => [...S.questions.filter(q => q.unlocks?.includes(qid)), ...S.presentations.filter(p => p.unlocks?.includes(qid))]
  while (queue.length) {
    const f = queue.shift()!
    for (const q of S.questions) if (q.factId === f) {
      for (const r of q.requires?.facts ?? []) push(r); for (const r of q.requires?.items ?? []) push(r)
      if (!q.initial) for (const u of unlockersOf(q.id)) { push(u.factId); if ('itemId' in u) push(u.itemId) }
    }
    for (const p of S.presentations) if (p.factId === f) { push(p.itemId); for (const r of p.requires?.facts ?? []) push(r); for (const r of p.requires?.items ?? []) push(r) }
    for (const c of S.contradictions) if (c.yieldsFactId === f) for (const r of c.facts) push(r)
    for (const q of board) if (q.yieldsFactId === f) { for (const r of q.answers[0] ?? []) push(r); for (const r of q.requires?.facts ?? []) push(r) }
    for (const sp of S.spots) for (const layer of [sp.primary, sp.hidden, sp.memory]) if (layer && (layer.factId === f || layer.itemId === f)) { if (sp.locked?.keyItemId) push(sp.locked.keyItemId); if (layer === sp.memory && S.memoryItemId) push(S.memoryItemId) }
  }

  let actions = 0
  const gives = (f?: { itemId?: string; factId?: string }, unlocks?: string[]) =>
    !!((f?.factId && need.has(f.factId)) || (f?.itemId && need.has(f.itemId)) || (unlocks ?? []).some(u => { const q = S.questions.find(x => x.id === u); return q?.factId && need.has(q.factId) }))
  for (let step = 0; step < 400 && !have.facts.has(target) && !have.items.has(target); step++) {
    let did = false
    for (const q of S.questions) {
      if (have.asked.has(q.id) || (!q.initial && !have.unlocked.has(q.id)) || !reqOk(q.requires) || !gives({ factId: q.factId }, q.unlocks)) continue
      have.asked.add(q.id); actions++; if (q.factId) have.facts.add(q.factId); for (const u of q.unlocks ?? []) have.unlocked.add(u); did = true; break
    }
    if (did) { contr(); continue }
    for (const p of S.presentations) {
      if (have.presented.has(p.id) || !have.items.has(p.itemId) || !reqOk(p.requires) || !gives({ factId: p.factId }, p.unlocks)) continue
      have.presented.add(p.id); actions++; if (p.factId) have.facts.add(p.factId); for (const u of p.unlocks ?? []) have.unlocked.add(u); did = true; break
    }
    if (did) { contr(); continue }
    for (const sp of S.spots) {
      const grab = (f: typeof sp.primary) => { if (f.itemId) have.items.add(f.itemId); if (f.factId) have.facts.add(f.factId) }
      if (!have.searched.has(sp.id)) {
        if (sp.locked && !(sp.locked.keyItemId && have.items.has(sp.locked.keyItemId))) continue
        if (!gives(sp.primary) && !(sp.hidden && gives(sp.hidden))) continue
        have.searched.add(sp.id); actions++; grab(sp.primary); did = true; break
      }
      if (sp.hidden && !have.hidden.has(sp.id) && gives(sp.hidden)) { have.hidden.add(sp.id); actions++; grab(sp.hidden); did = true; break }
      if (sp.memory && !have.hidden.has('m:' + sp.id) && S.memoryItemId && have.items.has(S.memoryItemId) && gives(sp.memory)) { have.hidden.add('m:' + sp.id); actions++; grab(sp.memory); did = true; break }
    }
    if (did) { contr(); continue }
    break
  }
  return have.facts.has(target) || have.items.has(target) ? actions : -1
}

const toConfession = S.checks ? shortest(S.checks.goal) : -1
const toLogbook = shortest(S.epilogue.branch.itemId)
const chain = S.checks?.chain ?? []
for (const f of chain) if (!facts.has(f)) errors.push(`цепочка проверки: нет факта ${f}`)
if (S.checks && !facts.has(S.checks.goal)) errors.push('цель проверки: нет факта')
const chainSteps = chain.map(f => `${f}: ${shortest(f)}`)

/* ── отчёт ── */
console.log('── Сценарий:', S.title)
console.log(`локаций ${S.locations.length} · свидетелей ${S.witnesses.length} · мест осмотра ${S.spots.length} (скрытых слоёв ${S.spots.filter(s => s.hidden).length}, запертых ${S.spots.filter(s => s.locked).length})`)
console.log(`предметов ${S.items.length} · вопросов ${S.questions.length} · предъявлений ${S.presentations.length} · фактов ${S.facts.length} (ключевых ${S.facts.filter(f => f.key).length}) · противоречий ${S.contradictions.length}`)
console.log(`единиц контента: ${S.spots.length + S.spots.filter(s => s.hidden).length + S.questions.length + S.presentations.length}`)
const lies = [...S.questions, ...S.presentations].filter(x => x.answer.lie)
console.log(`лживых ответов ${lies.length} · с честным вариантом ${lies.filter(x => x.honest?.length).length}`)
console.log()
console.log('── Достижимость без способностей')
console.log(`  действий до исчерпания: ${plain.actions} · фактов ${plain.facts} · предметов ${plain.items}`)
console.log(`  недостающих ключевых фактов: ${plain.missingKey.length}${plain.missingKey.length ? ' → ' + plain.missingKey.join(', ') : ''}`)
console.log(`  недостижимых вопросов: ${plain.unreachableQ.length}${plain.unreachableQ.length ? ' → ' + plain.unreachableQ.join(', ') : ''}`)
console.log(`  недостижимых предъявлений: ${plain.unreachableP.length}${plain.unreachableP.length ? ' → ' + plain.unreachableP.join(', ') : ''}`)
console.log(`  недостижимых мест: ${plain.unreachableSpots.length}${plain.unreachableSpots.length ? ' → ' + plain.unreachableSpots.join(', ') : ''}`)
console.log(`  недостижимых записей памяти: ${plain.unreachableMemory.length}${plain.unreachableMemory.length ? ' → ' + plain.unreachableMemory.join(', ') : ''}`)
if (plain.unreachableMemory.length || plain.unreachableSpots.length || plain.unreachableQ.length || plain.unreachableP.length) errors.push('без способностей часть контента недостижима (см. выше)')
if (!plain.confession) errors.push('без способностей цель недостижима')
// ключевые факты, которые дают только способности (подслушанное, прошлое, судмедэксперт), — бонус, не ошибка
console.log(`  цель достижима: ${plain.confession} · предмет развилки достижим: ${plain.logbook}`)
if (noGone) {
  console.log(`── Без мест, которые исчезают по ходу партии (${[...GONE].join(', ')})`)
  console.log(`  цель достижима: ${noGone.confession} · звенья цепочки без них: ${noGone.missingChain.length ? 'нет ' + noGone.missingChain.join(', ') : 'все'}`)
  if (!noGone.confession || noGone.missingChain.length) errors.push('исчезающие места запирают цель или цепочку обвинения — нужен второй путь')
}
if (board.length) console.log(`── Доска дела: вопросов ${board.length}, решаемых без способностей: ${board.filter(q => plain.factSet.has(q.yieldsFactId)).length}`)
for (const q of board) if (!plain.factSet.has(q.yieldsFactId)) errors.push(`вопрос доски ${q.id} не решается без способностей`)
console.log('── С криминалистом и взломщиком')
console.log(`  действий: ${full.actions} · фактов ${full.facts} · недостающих ключевых: ${full.missingKey.length}`)
console.log('── Кратчайший путь (целевой обход)')
console.log(`  до цели: ${toConfession} действий · до предмета развилки: ${toLogbook} действий`)
console.log('  цепочка обвинения, действий до каждого звена:\n    ' + chainSteps.join('\n    '))
console.log()
if (warn.length) console.log('Предупреждения:\n  ' + warn.join('\n  '))
if (errors.length) { console.log('ОШИБКИ:\n  ' + errors.join('\n  ')); process.exit(1) }
console.log('Ошибок нет.')
