// Боты «Красной нити»: node tools/simulate.mjs <число сыщиков>
//   ORIGIN=http://127.0.0.1:3100  MODE=random|smart  GAMES=1  FAST=1 (проматывать реплики сразу)
//   ONLINE=1 — сервер в режиме «в сети»: экран открывает свою комнату, боты входят по её коду
//   (нагрузка: запустить несколько процессов параллельно — у каждого своя комната)
// Отчёт — только числа: раунды, факты, противоречия, исход. Никаких реплик и имён из разгадки.
const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:3100'
const WS = ORIGIN.replace(/^http/, 'ws') + '/_ws'
const COUNT = Number(process.argv[2] || 6)
const MODE = process.env.MODE || 'random'
const GAMES = Number(process.env.GAMES || 1)
const FAST = process.env.FAST !== '0' && !process.env.SLOW
const SLOW = !!process.env.SLOW   // не проматывать: таймеры идут по-настоящему, для осмотра экранов

const NAMES = ['Аня', 'Борис', 'Вера', 'Глеб', 'Дина', 'Егор', 'Жанна', 'Зураб', 'Ира', 'Костя']
const sleep = ms => new Promise(r => setTimeout(r, ms))
const pick = arr => arr[Math.floor(Math.random() * arr.length)]

function connect(onOpen, onMessage) {
  const ws = new WebSocket(WS)
  ws.addEventListener('open', () => onOpen(ws))
  ws.addEventListener('message', e => { let m; try { m = JSON.parse(e.data) } catch { return } onMessage(m, ws) })
  ws.addEventListener('error', e => console.error('сокет:', e.message || e))
  // сервер закрыл соединение (лимиты) — сообщаем, иначе прогон молча зависнет
  ws.addEventListener('close', e => { if (e.code === 1008 || e.code === 1009) { console.error(`сокет закрыт сервером: ${e.code} ${e.reason}`); process.exit(2) } })
  return ws
}

const results = []
let game = 0
const TOKENS = []   // боты переподключаются под теми же жетонами между партиями — лобби не засоряется

function runGame() {
  return new Promise(resolve => {
    let host = null, hostState = null, started = false, finished = false, lastScreen = '', room = null, spawned = false
    const kicked = new Set()
    const bots = []
    const stats = { rounds: 0, wrongAccusations: 0 }

    host = connect(
      ws => ws.send(JSON.stringify(process.env.ONLINE ? { type: 'hello', role: 'host', create: true } : { type: 'hello', role: 'host' })),
      (m, ws) => {
        if (m.type === 'room') { room = m.code; return }
        if (m.type === 'hostAuth') {
          if (!m.ok) { console.error(`экран не пустили: ${m.reason ?? ''}`); process.exit(1) }
          if (!spawned) { spawned = true; spawnBots() }
          return
        }
        if (m.type !== 'state') return
        hostState = m.state
        const s = hostState
        if (s.screen !== lastScreen) { lastScreen = s.screen; if (process.env.VERBOSE) console.log(`  → ${s.screen} r${s.round + 1}`) }

        // меню: выбрать дело (CASE или первое готовое)
        if (s.screen === 'menu' && !s.caseSent) {
          s.caseSent = true
          const want = process.env.CASE || s.catalog.flatMap(g => g.cases).find(c => c.ready)?.id
          setTimeout(() => ws.send(JSON.stringify({ type: 'selectCase', caseId: want })), 200)
        }
        // в лобби чужого дела — назад в меню; отключённых игроков прошлых прогонов — убрать
        if (s.screen === 'lobby' && process.env.CASE && s.caseInfo.id !== process.env.CASE && !s.menuSent) {
          s.menuSent = true
          setTimeout(() => ws.send(JSON.stringify({ type: 'toMenu' })), 200)
          return
        }
        if (s.screen === 'lobby') for (const p of s.players) if (!p.connected && !kicked.has(p.id)) { kicked.add(p.id); ws.send(JSON.stringify({ type: 'kick', playerId: p.id })) }
        if (!started && s.screen === 'lobby' && s.players.length >= COUNT + Number(process.env.EXTRA || 0) && s.players.every(p => p.ready)) {
          started = true
          setTimeout(() => ws.send(JSON.stringify({ type: 'start' })), 300)
        }
        // обучение перед прологом боты пролистывают
        if (s.screen === 'tutorial') setTimeout(() => ws.send(JSON.stringify({ type: 'tutorial', step: 99 })), 200)
        // экран сам шлёт beatsDone, когда реплики дочитаны; тут — ускоренно
        if ((FAST || s.settings.stepping === 'manual') && ['prologue', 'resolve', 'verdict', 'epilogue'].includes(s.screen) && !s.beatsDoneSent && !process.env.WATCH) {
          s.beatsDoneSent = true
          setTimeout(() => ws.send(JSON.stringify({ type: 'beatsDone' })), 400)
        }
        if (!SLOW && s.screen === 'discuss' && !s.skipSent) { s.skipSent = true; setTimeout(() => ws.send(JSON.stringify({ type: 'skip' })), 500) }
        if (s.screen === 'final' && !finished) {
          finished = true
          results.push({ outcome: s.outcome, rounds: s.round + 1, cards: s.board.cards.length, links: s.board.links.length, hints: s.hintsUsed, wrong: 2 - s.attemptsLeft, players: COUNT, solved: s.field ? s.field.questions.filter(q => q.solved).length : null, penalty: s.field ? Math.round(s.field.penaltyMs / 1000) : null })
          if (SLOW) { resolve(); return }   // в медленном режиме оставляем финал на экране
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'restart' }))
            setTimeout(() => { for (const b of bots) b.close(); ws.close(); resolve() }, 600)
          }, 400)
        }
      }
    )

    function spawnBots() {
    for (let i = 0; i < COUNT; i++) {
      const name = NAMES[i % NAMES.length]
      let planKey = null, votedKey = null, picked = false, pickedAt = 0, lastHello = 0, last = null
      lastOf[i] = () => last
      const ws = connect(
        ws => ws.send(JSON.stringify({ type: 'hello', role: 'player', room, name, ink: i, token: TOKENS[i] })),
        async (m, ws) => {
          if (m.type === 'welcome') { TOKENS[i] = m.token; return }
          // лобби занято игроками прошлого прогона — экран их уберёт, пробуем войти ещё раз
          if (m.type === 'kicked') { setTimeout(() => ws.send(JSON.stringify({ type: 'hello', role: 'player', room, name, ink: i, token: TOKENS[i] })), 1500); return }
          // сервер сменил дело и сбросил состав — зайти в лобби заново
          if (m.type === 'state' && !m.you && TOKENS[i] && m.state.screen === 'lobby' && Date.now() - lastHello > 1500) {
            lastHello = Date.now(); picked = false
            ws.send(JSON.stringify({ type: 'hello', role: 'player', room, name, ink: i, token: TOKENS[i] }))
            return
          }
          if (m.type !== 'state' || !m.you) return
          const { state, you } = m
          last = m
          // «на время»: действия идут сами по таймеру бота, здесь только первый толчок
          if (state.screen === 'field') { fieldStep(ws, i); return }
          if (state.screen === 'lobby') {
            // ведущий сменил дело — роли и готовность сброшены, выбираем заново
            if (picked && !you.ready && !you.detectiveId && Date.now() - pickedAt > 2000) picked = false
            if (!picked) {
              picked = true
              pickedAt = Date.now()
              const free = state.detectives.filter(d => !state.players.some(p => p.detectiveId === d.id))
              await sleep(100 + i * 60)
              ws.send(JSON.stringify({ type: 'pickDetective', detectiveId: free[i % free.length]?.id ?? null }))
              await sleep(200)
              ws.send(JSON.stringify({ type: 'ready', ready: true }))
              // два бота взяли одну роль или состав сбросили без новых рассылок — через пару секунд пробуем ещё раз
              setTimeout(() => {
                const s2 = last?.state, y2 = last?.you
                if (s2?.screen !== 'lobby' || y2?.detectiveId) return
                picked = false; pickedAt = Date.now()
                const free2 = s2.detectives.filter(d => !s2.players.some(p => p.detectiveId === d.id))
                ws.send(JSON.stringify({ type: 'pickDetective', detectiveId: free2[(i + 1) % Math.max(1, free2.length)]?.id ?? null }))
                setTimeout(() => ws.send(JSON.stringify({ type: 'ready', ready: true })), 200)
                picked = true
              }, 2500)
            }
            return
          }
          if (state.screen === 'plan' && !you.planned) {
            const key = `${game}:${state.round}`
            if (planKey === key) return
            planKey = key
            await sleep(150 + Math.random() * 500)
            ws.send(JSON.stringify(choosePlan(state, you)))
            const extra = chooseBonus(state, you)
            if (extra) ws.send(JSON.stringify(extra))
            return
          }
          if (state.screen === 'accuse') {
            const key = `${game}:${state.round}:${state.accusation?.calledBy}:${state.attemptsLeft}`
            if (votedKey === key) return
            votedKey = key
            await sleep(200 + Math.random() * 400)
            try { ws.send(JSON.stringify(chooseVote(state))); if (process.env.VERBOSE) console.log(`  ${name} голосует`) }
            catch (e) { console.error(`  ${name}: голос не отправлен —`, e.message) }
          }
        }
      )
      bots.push(ws)
      // «на время» состояние приходит не каждую секунду — бот сам проверяет, не пора ли действовать
      const tickTimer = setInterval(() => { if (ws.readyState === 1) fieldStep(ws, i) }, 700)
      ws.addEventListener('close', () => clearInterval(tickTimer))
    }
    }

    /* ── «на время»: бот ходит и действует сам, пока не пора обвинять ── */
    const fieldNext = [], fieldSince = { at: 0 }
    function fieldStep(ws, i) {
      const m = lastOf[i]?.()
      if (!m || m.state.screen !== 'field' || m.state.paused) return
      const { state, you } = m
      const now = Date.now()
      if (!fieldSince.at) fieldSince.at = now
      if ((fieldNext[i] ?? 0) > now) return
      fieldNext[i] = now + 400 + Math.random() * 900
      if (you.field?.walk || you.field?.busy) return
      // пора: обвинение через ACCUSE_AFTER мс поиска (по умолчанию минута — чтобы прогон не шёл 45 минут)
      if (i === 0 && now - fieldSince.at > Number(process.env.ACCUSE_AFTER || 60000)) { fieldSince.at = now; ws.send(JSON.stringify({ type: 'callAccuse' })); return }
      const here = you.options.find(o => o.locationId === you.locationId)
      const acts = []
      for (const sp of here?.spots ?? []) if (sp.stage !== 'done' && (!sp.locked || sp.canUnlock)) acts.push({ type: 'search', spotId: sp.id, force: !!sp.locked })
      for (const w of here?.witnesses ?? []) {
        for (const q of w.questions) if (!q.asked && (!q.locked || q.canForce)) acts.push({ type: 'ask', witnessId: w.id, questionId: q.id, force: !!q.locked })
        for (const p of w.presents) if (!p.done && !p.locked) acts.push({ type: 'present', witnessId: w.id, itemId: p.itemId })
      }
      // изредка — попытка приколоть случайные карточки к вопросу доски (обычно мимо: так проверяется штраф)
      const open = (state.field?.questions ?? []).filter(q => !q.solved && !(q.cooldownUntil > state.field.serverNow))
      if (open.length && state.board.cards.length >= 3 && Math.random() < 0.03) {
        const q = pick(open)
        const ids = [...state.board.cards].sort(() => Math.random() - 0.5).slice(0, q.slots).map(c => c.id)
        if (ids.length === q.slots) { ws.send(JSON.stringify({ type: 'solve', questionId: q.id, factIds: ids })); return }
      }
      if (acts.length && Math.random() < 0.85) { ws.send(JSON.stringify({ type: 'act', action: pick(acts) })); return }
      const kind = you.ability?.kind
      const targets = state.locations.filter(l => l.id !== you.locationId && (l.open || (kind === 'burglar' && you.usesLeft > 0)) && (l.unsearched > 0 || state.witnesses.some(w => w.locationId === l.id)))
      if (targets.length) { const t = pick(targets); ws.send(JSON.stringify({ type: 'go', locationId: t.id, force: !t.open })) }
    }
    const lastOf = []

    function choosePlan(state, you) {
      // собираем все доступные действия по всем локациям
      const acts = []
      for (const loc of you.options) {
        for (const s of loc.spots) if (!s.searched && (!s.locked || s.canUnlock)) acts.push({ locationId: loc.locationId, action: { type: 'search', spotId: s.id, force: !!s.locked } })
        for (const w of loc.witnesses) {
          for (const q of w.questions) if (!q.asked && (!q.locked || q.canForce)) acts.push({ locationId: loc.locationId, action: { type: 'ask', witnessId: w.id, questionId: q.id, force: !!q.locked } })
          for (const p of w.presents) if (!p.done && !p.locked) acts.push({ locationId: loc.locationId, action: { type: 'present', witnessId: w.id, itemId: p.itemId } })
          for (const c of w.confronts ?? []) if (!c.done) acts.push({ locationId: loc.locationId, action: { type: 'confront', witnessId: w.id, linkId: c.linkId }, weight: 3 })
        }
      }
      if (!acts.length) return { type: 'plan', locationId: you.locationId, action: { type: 'wait' } }
      let chosen
      if (MODE === 'smart') {
        // умный бот: предъявления и вопросы к тем, кто рядом с уликами, важнее случайных осмотров
        const weighted = acts.flatMap(a => Array(a.weight ?? (a.action.type === 'ask' ? 2 : 1)).fill(a))
        chosen = pick(weighted)
      } else chosen = pick(acts)
      return { type: 'plan', locationId: chosen.locationId, action: chosen.action }
    }

    /** способность со счётчиком — отдельным сообщением, сверх хода */
    function chooseBonus(state, you) {
      const kind = you.ability?.kind
      if (!(you.usesLeft > 0) || Math.random() > 0.35) return null
      const cards = state.board.cards
      const spots = you.options.flatMap(o => o.spots.filter(s => s.stage !== 'done' && !s.locked))
      const questions = you.options.flatMap(o => o.witnesses.flatMap(w => w.questions.filter(q => !q.asked && !q.locked).map(q => ({ w, q }))))
      const bonus = action => ({ type: 'bonus', action })
      if (kind === 'coroner') return bonus({ type: 'coroner' })
      if (kind === 'archivist' && cards.length) return bonus({ type: 'archivist', factId: pick(cards).id })
      if (kind === 'tracker') { const t = cards.filter(c => c.kind === 'testimony' && !c.verdict); if (t.length) return bonus({ type: 'verify', factId: pick(t).id }) }
      if (kind === 'reporter') return bonus({ type: 'reporter', witnessId: pick(state.witnesses).id })
      if (kind === 'intern') return bonus({ type: 'intern' })
      if (kind === 'fixer' && you.market.length) return bonus({ type: 'fixer' })
      if (kind === 'patrol' && questions.length) { const x = pick(questions); return bonus({ type: 'ask', witnessId: x.w.id, questionId: x.q.id, remote: true }) }
      if (kind === 'drone' && spots.length) return bonus({ type: 'drone', spotId: pick(spots).id })
      return null
    }

    function chooseVote(state) {
      const w = pick(state.witnesses).id
      const m = pick(state.accusationOptions.methods).id
      const mo = pick(state.accusationOptions.motives).id
      return { type: 'vote', culprit: w, method: m, motive: mo }
    }
  })
}

console.log(`боты: ${COUNT} сыщиков · режим ${MODE} · партий ${GAMES}`)
for (game = 0; game < GAMES; game++) {
  await runGame()
  const r = results[results.length - 1]
  console.log(`партия ${game + 1}: исход ${r.outcome} · раундов ${r.rounds} · улик ${r.cards} · противоречий ${r.links} · подсказок ${r.hints} · ошибочных обвинений ${r.wrong}${r.solved != null ? ` · вопросов доски ${r.solved} · штрафов ${r.penalty} с` : ''}`)
  await sleep(800)
}
const n = results.length
console.log(`\nитого: ${n} партий · раскрыто ${results.filter(r => r.outcome === 'solved').length} · с оговорками ${results.filter(r => r.outcome === 'partial').length} · провал ${results.filter(r => r.outcome === 'failed').length}`)
console.log(`в среднем: улик ${(results.reduce((a, r) => a + r.cards, 0) / n).toFixed(1)} · противоречий ${(results.reduce((a, r) => a + r.links, 0) / n).toFixed(1)} · подсказок ${(results.reduce((a, r) => a + r.hints, 0) / n).toFixed(1)}`)
process.exit(0)
