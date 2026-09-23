<script setup lang="ts">
/* Одиночная игра («Туман»): один экран — компьютер или планшет.
   Слева кадр места в тумане и текст, справа — состояние героя, что осмотреть, куда идти и что в карманах.
   Сцены, встречи, головоломки и разговоры — поверх, по одному за раз. */
import type { SoloClientMessage, SoloView } from '#shared/types'

useHead({ title: 'Туман — Красная нить', htmlAttrs: { 'data-setting': 'tuman' } })

const route = useRoute()
const storyId = typeof route.query.story === 'string' ? route.query.story : undefined
const { view, connected, error, clockOffset, send, transferCode, adoptError, transfer, adopt } = useSolo(storyId)
/* перенос партии между устройствами: у партии один код на год */
const moveOpen = ref<'give' | 'take' | null>(null)
const adoptCode = ref('')
const adoptShown = computed({ get: () => { const c = adoptCode.value; return c.length > 3 ? `${c.slice(0, 3)} ${c.slice(3)}` : c }, set: (v: string) => { adoptCode.value = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) } })
function giveCode() { moveOpen.value = 'give'; transfer() }
const audio = useAudio()

const v = computed(() => view.value)
const story = computed(() => v.value?.info.id ?? '')
const cover = computed(() => story.value ? `/art/${story.value}/cover.jpg` : '')
const coverReady = ref(false)

/* ── заставка и меню ── */
const entered = ref(false)
const menuOpen = ref(false)
const confirmNew = ref(false)
const saveOpen = ref(false)
/** вещи — отдельным окном (I) */
const bagOpen = ref(false)
const mapOpen = ref(false)
const notesOpen = ref(false)
watch(mapOpen, on => { if (on) void audio.sfx('map-unfold', 0.55) })
watch(notesOpen, on => { if (on) void audio.sfx('paper', 0.45) })

async function enter(action: 'continue' | 'new' | { load: number }) {
  await Promise.race([audio.unlock(), new Promise(r => setTimeout(r, 1500))])
  if (action === 'new') { send({ type: 'new' }); endingPlayed.value = null }
  else if (action !== 'continue') send({ type: 'load', slot: action.load })
  entered.value = true
  menuOpen.value = false
  confirmNew.value = false
}
const canContinue = computed(() => !!v.value?.started && !v.value.ending)
function askNew() {
  if (v.value?.started && !v.value.ending && !confirmNew.value) { confirmNew.value = true; return }
  void enter('new')
}

/* ── место ── */
const place = computed(() => v.value?.place ?? null)
/* крупный план: если последнее, что игрок узнал, — осмотр с картинкой, большой кадр места на время сменяется ею.
   Следующее действие, шаг в другое место или щелчок по кадру — обратно к месту */
const closeDismissed = ref(0)
const closeup = computed(() => {
  const last = (v.value?.feed ?? []).filter(f => f.seq > feedFloor.value && (f.text || f.art)).at(-1)
  return last?.art && last.seq > closeDismissed.value ? last : null
})
const shownArt = computed(() => closeup.value?.art ?? place.value?.art ?? '')
const artOk = ref(true)
const artSrc = computed(() => place.value && story.value && shownArt.value ? `/art/${story.value}/${shownArt.value}.jpg` : '')
watch(artSrc, () => { artOk.value = true })
const backToPlace = () => { if (closeup.value) closeDismissed.value = closeup.value.seq }
const darkness = computed(() => !place.value ? 'none' : !place.value.dark ? 'none' : place.value.lit ? 'torch' : 'black')
/* объём (2,5D): у кадра есть карта глубины — рисуем WebGL-рельефом; не вышло — обычная картинка */
const depthFail = ref(false)
const depthSrc = computed(() => artSrc.value && v.value?.depth.includes(shownArt.value) && !depthFail.value ? `/art/${story.value}/z_${shownArt.value}.jpg` : '')
/* ветер: маска растительности кадра; сила — по погоде (в грозу деревья гнёт сильнее) */
const windSrc = computed(() => (artSrc.value && v.value?.wind?.includes(shownArt.value) ? `/art/${story.value}/w_${shownArt.value}.jpg` : undefined))
const WINDY: Record<string, number> = { fog: 0.6, drizzle: 0.8, rain: 1.1, storm: 1.9 }
const windy = computed(() => WINDY[place.value?.weather ?? 'fog'] ?? 0.6)
watch(artSrc, () => { depthFail.value = false })
/* туман в объёмном кадре: на улице гуще, в гудящих помещениях реже, в сырых подвалах и на изнанке — между */
/* погода по ходу сюжета: сила дождя в кадре и туман (дождь прибивает туман) */
const RAIN: Record<string, number> = { fog: 0, drizzle: 0.35, rain: 0.7, storm: 1 }
const rainAmount = computed(() => (place.value?.outdoor ? RAIN[place.value.weather] ?? 0 : 0))
const FOG_BY_WEATHER: Record<string, number> = { fog: 1, drizzle: 0.9, rain: 0.78, storm: 0.65 }
const fogBase = computed(() => { const p = place.value; if (!p) return 0.6; if (p.outdoor) return 0.85; if (v.value?.otherworld || p.surface === 'water') return 0.55; return p.ambience.includes('room-hum') ? 0.3 : 0.45 })
const fogAmount = computed(() => fogBase.value * (FOG_BY_WEATHER[place.value?.weather ?? 'fog'] ?? 1))

/* фонарь следует за курсором или пальцем */
const torch = reactive({ x: 62, y: 42 })
function onPointer(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  torch.x = Math.round(((e.clientX - r.left) / r.width) * 100)
  torch.y = Math.round(((e.clientY - r.top) / r.height) * 100)
}

/* лента последствий: после перехода старое уходит, новое — со звуком */
const feedFloor = ref(0)
let lastPlayed = -1
let lastPlace = ''
let lastHealth = 100
const hurtFlash = ref(0)
watch(view, (nv, ov) => {
  if (!nv) return
  const maxSeq = nv.feed.at(-1)?.seq ?? 0
  const prevMax = ov?.feed.at(-1)?.seq ?? 0
  if (lastPlayed < 0) { lastPlayed = maxSeq; feedFloor.value = Math.max(0, maxSeq - 3); lastPlace = nv.place?.id ?? ''; lastHealth = nv.health; return }
  if (nv.place && nv.place.id !== lastPlace) {
    if (lastPlace) void audio.sfx(`step-${nv.place.surface}`, 0.7)
    feedFloor.value = prevMax
    lastPlace = nv.place.id
    mode.value = null
  }
  for (const f of nv.feed) {
    if (f.seq <= lastPlayed) continue
    for (const s of f.sfx ?? []) void audio.sfx(s, 0.9)
    if (f.found) found.value = [...found.value, { item: f.found }]
    if (f.note) found.value = [...found.value, { note: f.note }]
    if (f.melody) audio.melody(f.melody.notes, f.melody.timbre)
  }
  lastPlayed = maxSeq
  if (nv.health < lastHealth) { hurtFlash.value++; void audio.sfx('solo-hurt', 0.9) }
  if (nv.dead && !ov?.dead) void audio.stinger('death', 0.9).then(ok => { if (!ok) void audio.sfx('sting-soft', 0.9) })
  lastHealth = nv.health
  if (!nv.started) { lastPlace = ''; feedFloor.value = 0; found.value = [] }
})
const feed = computed(() => (v.value?.feed ?? []).filter(f => f.seq > feedFloor.value && f.text).slice(-4))

/* ── здоровье, свет, радио ── */
const healthState = computed(() => {
  const h = v.value?.health ?? 100
  return h > 60 ? { key: 'ok', label: 'Норма' } : h > 30 ? { key: 'hurt', label: 'Ранен' } : { key: 'bad', label: 'Тяжело ранен' }
})
const hasFlashlight = computed(() => !!v.value?.inventory.some(i => i.id === 'flashlight'))
const hasRadio = computed(() => !!v.value?.inventory.some(i => i.id === 'radio'))
/* Фонарь от заряда: чем меньше, тем тусклее и уже луч. Ниже 30 % мигает и изредка глохнет сам — тогда F и тап по
   фонарю не включают его, а трясут: 3–5 быстрых нажатий (на телефоне — встряхнуть) — и он оживает, мигнув */
const torchDead = ref(false)
const flick = ref(1)
let shakeNeed = 4
const shakes: number[] = []
const torchPower = computed(() => (torchDead.value ? 0 : (0.3 + 0.7 * Math.min(1, Math.max(0, (v.value?.battery ?? 100) / 60))) * flick.value))
const torchBeam = computed(() => Math.min(1, Math.max(0.25, ((v.value?.battery ?? 100) - 4) / 46)))
const lowBattery = computed(() => (v.value?.battery ?? 100) < 30)
function flickerSeq(steps: [number, number][], done?: () => void) {
  for (const [at, val] of steps) setTimeout(() => { flick.value = val }, at)
  if (done) setTimeout(done, steps[steps.length - 1]![0] + 10)
}
function reviveTorch() {
  torchDead.value = false
  flickerSeq([[0, 0.4], [80, 0], [160, 0.7], [260, 0.2], [380, 1]])
  if (v.value && !v.value.light) send({ type: 'light', on: true })
}
function shakeTorch() {
  const now = Date.now()
  shakes.push(now)
  while (shakes.length && now - shakes[0]! > 2500) shakes.shift()
  // каждый встряхнутый раз фонарь чуть вспыхивает — видно, что он «почти»
  flickerSeq([[0, 0.25], [90, 0]])
  if (shakes.length >= shakeNeed) { shakes.length = 0; reviveTorch() }
}
const toggleLight = () => {
  if (!v.value || !hasFlashlight.value) return
  if (torchDead.value) return shakeTorch()
  send({ type: 'light', on: !v.value.light })
}
let flickTimer: ReturnType<typeof setTimeout> | null = null
function flickerLoop() {
  flickTimer = setTimeout(() => {
    const s = v.value
    const b = s?.battery ?? 100
    if (s?.light && !torchDead.value && b < 30 && darkness.value === 'torch' && !overlay.value) {
      // провалы яркости — чем меньше заряд, тем чаще
      if (Math.random() < 0.08 + (30 - b) / 30 * 0.25) flickerSeq([[0, 0.25 + Math.random() * 0.4], [60 + Math.random() * 120, 1]])
      // изредка глохнет совсем
      if (Math.random() < (30 - b) / 30 * 0.012) {
        shakeNeed = 3 + Math.floor(Math.random() * 3)
        flickerSeq([[0, 0.3], [90, 1], [170, 0.15], [240, 0.6], [330, 0]], () => { torchDead.value = true; if (v.value?.light) send({ type: 'light', on: false }) })
      }
    }
    flickerLoop()
  }, 250)
}
/* на телефоне — встряхнуть сам телефон (где датчик доступен без запроса разрешения) */
function onMotion(e: DeviceMotionEvent) {
  const a = e.accelerationIncludingGravity
  if (!torchDead.value || !a) return
  if (Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0) > 22) shakeTorch()
}
onMounted(() => { flickerLoop(); window.addEventListener('devicemotion', onMotion) })
onBeforeUnmount(() => { if (flickTimer) clearTimeout(flickTimer); window.removeEventListener('devicemotion', onMotion) })
const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const toggleRadio = () => { if (v.value && hasRadio.value) { void audio.sfx('radio-click', 0.6); send({ type: 'radio', on: !v.value.radioOn }) } }

/* ── вещи: применить к месту или соединить с другой вещью ── */
type Mode = { kind: 'use' | 'combine'; item: string; name: string } | null
const mode = ref<Mode>(null)
const picked = ref<string | null>(null)
const pickedItem = computed(() => v.value?.inventory.find(i => i.id === picked.value) ?? null)
watch(() => v.value?.inventory, inv => { if (picked.value && !inv?.some(i => i.id === picked.value)) picked.value = null })

function clickItem(id: string) {
  if (mode.value?.kind === 'combine' && mode.value.item !== id) {
    send({ type: 'combine', item: mode.value.item, with: id })
    mode.value = null
    picked.value = null
    return
  }
  mode.value = null
  picked.value = picked.value === id ? null : id
}
/* картинки вещей грузятся заранее — окно вещей открывается сразу полным */
watch(() => v.value?.inventory.map(i => i.art).join(','), arts => {
  if (!arts || !story.value) return
  for (const a of arts.split(',')) { const im = new Image(); im.src = `/art/${story.value}/${a}.jpg` }
}, { immediate: true })
/** в окне вещей: выбранная остаётся выбранной (как в играх); при «Соединить с…» вторая вещь соединяет */
function pickInBag(id: string) {
  if (mode.value?.kind === 'combine' && mode.value.item !== id) { clickItem(id); return }
  if (mode.value?.kind === 'combine') return
  picked.value = id
}
function clickHotspot(id: string) {
  if (mode.value?.kind === 'use') { send({ type: 'use', item: mode.value.item, hotspot: id }); mode.value = null; picked.value = null; return }
  send({ type: 'look', hotspot: id })
}
function startMode(kind: 'use' | 'combine') {
  const it = pickedItem.value
  if (!it) return
  mode.value = { kind, item: it.id, name: it.name }
}
function useSelf() {
  const it = pickedItem.value
  if (!it) return
  send({ type: 'use', item: it.id })
  if (it.kind !== 'weapon') picked.value = null
}
/* карманы по разделам, как в старых хоррорах: оружие, лечение и свет, ключи, вещи, бумаги */
const BAG: { label: string; kinds: string[] }[] = [
  { label: 'Оружие', kinds: ['weapon', 'ammo'] }, { label: 'Лечение и свет', kinds: ['heal', 'battery'] },
  { label: 'Ключи', kinds: ['key'] }, { label: 'Вещи', kinds: ['tool', 'luck'] }, { label: 'Бумаги', kinds: ['story'] }
]
const bagGroups = computed(() => BAG.map(g => ({ label: g.label, items: (v.value?.inventory ?? []).filter(i => g.kinds.includes(i.kind)) })).filter(g => g.items.length))
const itemVerb = (kind: string) => kind === 'heal' ? 'Перевязаться' : kind === 'battery' ? 'Вставить в фонарь' : kind === 'weapon' ? 'Взять в руки' : 'Рассмотреть'

/* ── оверлеи ── */
const endingPlayed = ref<string | null>(null)
/** находки ждут своей очереди: карточка — когда закончились сцена, разговор и головоломка */
type Found = { item?: NonNullable<SoloView['feed'][number]['found']>; note?: NonNullable<SoloView['feed'][number]['note']> }
const found = ref<Found[]>([])
const nextFound = () => { found.value = found.value.slice(1) }
/* записки: значок считает непрочитанные; «Прочитать» на карточке открывает журнал сразу на ней */
const unread = computed(() => v.value?.notes.filter(n => !n.read).length ?? 0)
const notesFocus = ref<string | null>(null)
function readNote(id: string) { send({ type: 'noteRead', id }) }
function openNote(id: string) { nextFound(); notesFocus.value = id; notesOpen.value = true }
watch(notesOpen, on => { if (!on) notesFocus.value = null })
const overlay = computed<'scene' | 'ending-scene' | 'ending' | 'dead' | 'chase' | 'boss' | 'encounter' | 'dialogue' | 'puzzle' | 'found' | null>(() => {
  const s = v.value
  if (!s?.started || !entered.value) return null
  if (s.scene) return 'scene'
  if (s.ending) return endingPlayed.value === s.ending.id ? 'ending' : 'ending-scene'
  if (s.dead) return 'dead'
  if (s.chase) return 'chase'
  if (s.boss) return 'boss'
  if (s.encounter) return 'encounter'
  if (s.dialogue) return 'dialogue'
  if (s.puzzle) return 'puzzle'
  if (found.value.length) return 'found'
  return null
})
const speakers = computed(() => v.value?.speakers ?? {})
const puzzleFail = computed(() => {
  const last = v.value?.feed.at(-1)
  return v.value?.puzzle && last && last.seq > lastPuzzleOpen.value && last.text === v.value.puzzle.puzzle.fail ? last.text : null
})
const lastPuzzleOpen = ref(0)
watch(() => v.value?.puzzle?.hotspot, h => { if (h) lastPuzzleOpen.value = v.value?.feed.at(-1)?.seq ?? 0 })

const sceneDone = () => { if (v.value?.scene) send({ type: 'sceneDone', seq: v.value.scene.seq }) }
const relay = (m: SoloClientMessage) => send(m)

/* ── звук: атмосфера места, радио, сердце, дрожь встречи ── */
/** петли, которые в ленте места должны быть тише остальных (часы в кабинете — не громче гула) */
const AMB_LEVEL: Record<string, number> = { 'clock-tick-slow': 0.3, 'loudspeaker-hum': 0.7, pines: 0.8, 'fog-drip': 0.8, 'other-pulse': 0.7, 'rain-light': 0.75, 'rain-heavy': 0.85, 'rain-roof': 0.55 }
watch([() => place.value?.ambience.join(','), () => place.value?.weather, () => v.value?.radio, () => !!(v.value?.encounter || v.value?.chase || v.value?.boss), () => (v.value?.health ?? 100) <= 30, entered, () => audio.unlocked.value, () => !!v.value?.ending],
  ([, , radio, enc, low, inGame, ok, ended]) => {
    if (!ok) return
    if (!inGame || !v.value?.started || ended) { audio.ambience(['fog-wind'], { 'fog-wind': 0.5 }); return }
    const names = [...(place.value?.ambience ?? [])]
    const levels: Record<string, number> = { ...AMB_LEVEL }
    // в помещении за стеной еле слышно идёт ветер (лента помещения и так глушит верх — выходит «за стеклом»)
    if (place.value && !place.value.outdoor && !names.includes('fog-wind')) { names.push('fog-wind'); levels['fog-wind'] = 0.22 }
    // дождь по ходу сюжета: на улице — в полную, под крышей — по крыше и стёклам, в подвале не слышно; морось в доме не слышна
    const w = place.value?.weather ?? 'fog'
    if (place.value && w !== 'fog' && !place.value.deep) {
      if (place.value.outdoor) {
        if (w === 'storm') { names.push('rain-heavy', 'rain-light'); levels['rain-heavy'] = 0.9; levels['rain-light'] = 0.35 }
        else { names.push('rain-light'); levels['rain-light'] = w === 'rain' ? 0.8 : 0.45 }
      } else if (w !== 'drizzle') { names.push('rain-roof'); levels['rain-roof'] = w === 'storm' ? 0.75 : 0.5 }
    }
    if (radio) { names.push('radio-static'); levels['radio-static'] = radio === 2 ? 0.95 : 0.35 }
    if (enc) { names.push('dread-drone'); levels['dread-drone'] = 0.8 }
    if (low) { names.push('heartbeat'); levels.heartbeat = 0.7 }
    audio.ambience(names, levels)
  }, { immediate: true })
watch([() => place.value?.outdoor, () => audio.unlocked.value], ([outdoor]) => audio.setOutdoors(!!outdoor), { immediate: true })
/* эхо «комнаты» по покрытию: кафель и затопленный подвал гулкие, дерево чуть, улица сухая */
watch([() => place.value?.surface, () => place.value?.outdoor, () => audio.unlocked.value], ([surface, outdoor, ok]) => {
  if (!ok) return
  audio.setRoom(outdoor ? 0.07 : surface === 'water' ? 0.5 : surface === 'tile' ? 0.36 : 0.16)
}, { immediate: true })

/* Смена кадра без провала в темноту. Новый кадр проявляется сам: объёмный — после первой отрисовки (у телефона на это
   может уйти секунда), обычный — после загрузки. Уходящий кадр держится, пока новый не нарисован (не дольше 4 с),
   и только потом растворяется — картинка сменяет картинку */
const frameReady = ref(0)
function onCutEnter(el: Element, done: () => void) {
  const e = el as HTMLElement
  // у объёмного кадра своё проявление по готовности (класс --ready)
  if (e.tagName === 'CANVAS') return done()
  e.style.opacity = '0'
  requestAnimationFrame(() => requestAnimationFrame(() => { e.style.transition = 'opacity 1.4s ease'; e.style.opacity = '1' }))
  setTimeout(() => { e.style.transition = ''; e.style.opacity = ''; done() }, 1500)
}
function onCutLeave(el: Element, done: () => void) {
  const e = el as HTMLElement
  const start = frameReady.value
  let finished = false
  let stop: (() => void) | null = null
  const fade = () => {
    if (finished) return
    finished = true
    stop?.(); clearTimeout(cap)
    e.style.transition = 'opacity 1.1s ease'
    e.style.opacity = '0'
    setTimeout(done, 1150)
  }
  stop = watch(frameReady, v => { if (v !== start) fade() })
  const cap = setTimeout(fade, 4000)
}

/* молния: двойная вспышка (как настоящая — ярко, провал, ещё раз слабее), под крышей — вполсилы через окна */
const flash = ref(0)
function strike(strength: number) {
  const p = place.value
  if (!p || p.deep) return
  const k = strength * (p.outdoor ? 1 : 0.4)
  const steps: [number, number][] = [[0, k], [70, k * 0.25], [140, k * 0.85], [230, k * 0.35], [420, 0]]
  for (const [at, val] of steps) setTimeout(() => { flash.value = val }, at)
}

/* дошёл до любой концовки — на этом устройстве мир в меню показывает «вторую» картинку (как в играх после прохождения) */
watch(() => v.value?.ending?.id, id => {
  const world = v.value?.info.settingId
  if (id && world) try { localStorage.setItem(`rn:done:${world}`, '1') } catch { /* приватный режим */ }
})

/** музыка молчит (пауза темы района, см. ниже) */
const musicRest = ref(false)
/* музыка: тема по району и состоянию, под исследованием — тише ленты атмосферы, в погоне и на заставке — в полную.
   Темы лежат в папке истории; которой нет — заменяется темой мира из меню */
const themeName = computed<string | null>(() => {
  const s = v.value
  if (!s) return null
  if (!entered.value || !s.started) return 'title'
  if (s.ending) return s.ending.id
  if (s.dead) return null
  if (s.chase) return 'chase'
  // сцена или разговор со своей темой — воспоминание, признание
  if (s.scene?.music) return s.scene.music
  if (s.dialogue?.music) return s.dialogue.music
  // босс и тяжёлые существа — своя музыка; мелочь вроде горниста идёт под тему района и дрон встречи
  if (s.boss) return 'boss'
  if (s.encounter && HEAVY.has(s.encounter.monster)) return 'fight'
  const pid = place.value?.id ?? ''
  const area = place.value?.area
  const has = (id: string) => s.notes.some(n => n.id === id)
  // последний путь: радиорубка и пирс после журнала радиоузла; у воды — своя тишина; город после писем становится тяжелее
  if ((pid === 'camp_radio' || pid === 'camp_pier') && has('n_radio_log')) return 'finale'
  if (LAKE.has(pid)) return 'lake'
  // водозабор: у воды — озеро, в галерее и колодце — своя тяжесть, в залах — гул машины
  if (area === 'intake') return pid === 'intake_gallery' || pid === 'intake_well' ? 'gallery' : 'intake'
  if (area === 'camp') return 'camp'
  if (area === 'sana') return s.otherworld ? 'otherworld' : 'sanatorium'
  return has('n_letters') ? 'town2' : 'town'
})
/** места у воды, где вместо темы района — озеро */
const LAKE = new Set(['quay', 'camp_boathouse', 'bridge', 'camp_pier', 'shore', 'intake_out'])
/** существа, под которых включается боевая тема (у остальных — тема района тише и дрон) */
const HEAVY = new Set(['wet', 'counselor', 'squad', 'sleeper'])
const themeLevel = computed(() => {
  const s = v.value
  if (!s || !entered.value || !s.started || s.ending || s.chase) return 1
  if (s.boss || (s.encounter && HEAVY.has(s.encounter.monster))) return 1
  if (s.scene?.music || s.dialogue?.music) return 0.8
  if (s.encounter) return 0.3
  if (s.scene || s.dialogue) return 0.45
  if (musicRest.value) return 0
  // в тёмных местах музыка почти уходит: остаётся дыхание, шаги и то, что в темноте; со светом — чуть громче
  if (s.place?.dark) return s.place.lit ? 0.4 : 0.25
  return 0.6
})
// пока история грузится, играет то, что было в меню: у мира и заставки истории одна тема, она не должна обрываться
// бой и погоня начинаются резко — музыка входит за полторы секунды, а не за четыре
const FAST = new Set(['boss', 'fight', 'chase'])
watch([themeName, themeLevel, () => audio.unlocked.value], ([t, lvl, ok], old) => {
  if (!ok || !v.value) return
  // уход в тишину и возвращение — медленно, за 8–10 с, чтобы не заметить, когда именно музыка исчезла
  const resting = t === old?.[0] && (lvl === 0 || old?.[1] === 0)
  void audio.theme(t, lvl, t && FAST.has(t) ? 1.5 : resting ? (lvl === 0 ? 10 : 8) : undefined)
}, { immediate: true })

/* звуки вокруг героя: даль, рядом, этаж сверху, за спиной в темноте, гром в дождь — у каждого слоя свой случайный ритм
   (useSoundscape). Звучат, пока герой просто идёт; записки и карта их не глушат — читать под шаги сверху страшнее */
useSoundscape({
  place: () => {
    const p = place.value
    if (!p) return null
    return { area: p.area, outdoor: p.outdoor, surface: p.surface, dark: p.dark, lit: p.lit, other: !!v.value?.otherworld, weather: p.weather, deep: p.deep, ambience: p.ambience }
  },
  lightning: strength => strike(strength),
  active: () => {
    const s = v.value
    return !!(entered.value && s?.started && !overlay.value && !menuOpen.value && !saveOpen.value && !s.ending && audio.unlocked.value)
  }
})

/* музыка иногда замолкает: раз в две-четыре минуты тема района уходит на 35–90 с, остаётся только атмосфера.
   Тишина пугает сильнее любой темы — и когда музыка возвращается, её снова слышно, а не привыкаешь */
let restTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRest() {
  restTimer = setTimeout(() => {
    musicRest.value = true
    restTimer = setTimeout(() => { musicRest.value = false; scheduleRest() }, 35_000 + Math.random() * 55_000)
  }, 120_000 + Math.random() * 120_000)
}
onMounted(scheduleRest)
onBeforeUnmount(() => { if (restTimer) clearTimeout(restTimer) })

/* ── клавиатура ── */
const anyPanel = computed(() => menuOpen.value || saveOpen.value || mapOpen.value || notesOpen.value || bagOpen.value)
function onKey(e: KeyboardEvent) {
  if (!entered.value || !v.value?.started || overlay.value) return
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
  // карта и записки закрываются сами — клавиша не должна заодно открыть паузу
  if (mapOpen.value || notesOpen.value || bagOpen.value) return
  if (e.code === 'Escape') {
    e.preventDefault()
    if (mode.value || picked.value) { mode.value = null; picked.value = null }
    else if (saveOpen.value) saveOpen.value = false
    else menuOpen.value = !menuOpen.value
    return
  }
  if (anyPanel.value) return
  if (e.code === 'KeyM') { e.preventDefault(); mapOpen.value = true }
  else if (e.code === 'KeyJ') { e.preventDefault(); notesOpen.value = true }
  else if (e.code === 'KeyF') { e.preventDefault(); toggleLight() }
  else if (e.code === 'KeyI' && !anyPanel.value) { e.preventDefault(); bagOpen.value = true }
  else if (e.code === 'KeyR') { e.preventDefault(); toggleRadio() }
}
onMounted(() => window.addEventListener('keydown', onKey))
// музыку не глушим: уйти отсюда можно только в меню, а оно само сменит тему (или оставит ту же — без обрыва)
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); audio.ambience([]) })

/* в меню «Красной нити»: экран гаснет, потом переход — как смена экранов внутри игры */
const leaving = ref(false)
function toMenu() {
  if (leaving.value) return
  leaving.value = true
  setTimeout(() => void navigateTo('/'), 500)
}

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const slots = computed(() => [0, 1, 2].map(slot => v.value?.saves.find(s => s.slot === slot) ?? null))
type Saves = SoloView['saves']
const lastSave = computed<Saves[number] | null>(() => [...(v.value?.saves ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null)
</script>

<template>
  <div class="solo" :class="{ 'solo--other': v?.otherworld, 'solo--leaving': leaving }">
    <TheLoader v-if="!v && !error" />

    <!-- ── заставка ── -->
    <section v-else-if="!entered || !v?.started" class="solo-title">
      <!-- обложка проявляется, когда догрузилась, а не выскакивает поверх уже проявившейся заставки -->
      <img v-if="cover" class="solo-title__art" :class="{ on: coverReady }" :src="cover" alt="" @load="coverReady = true" @error="($event.target as HTMLImageElement).hidden = true">
      <i class="solo-tint" aria-hidden="true" />
      <SoloFog :density="1" />
      <div class="solo-title__body">
        <a href="/" class="solo-title__back" @click.prevent="toMenu">← Красная нить</a>
        <!-- озвучка и звук — здесь, на заставке, как в лобби других дел -->
        <div class="solo-title__ctl">
          <button type="button" class="solo-ctl" :class="{ 'solo-ctl--off': !audio.voiceOn.value }" :title="audio.voiceOn.value ? 'Выключить озвучку реплик' : 'Включить озвучку реплик'" :aria-label="audio.voiceOn.value ? 'Выключить озвучку' : 'Включить озвучку'" @click="audio.setVoiceOn(!audio.voiceOn.value)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H10l-4.5 3.5V16H4z" /><path v-if="audio.voiceOn.value" d="M8 9h8M8 12h5" /><path v-else d="M8 8.5l7 6M15 8.5l-7 6" /></svg>
            <span>{{ audio.voiceOn.value ? 'Озвучка' : 'Без озвучки' }}</span>
          </button>
          <button type="button" class="solo-ctl" :class="{ 'solo-ctl--off': audio.muted.value }" :title="audio.muted.value ? 'Включить звук' : 'Выключить звук'" :aria-label="audio.muted.value ? 'Включить звук' : 'Выключить звук'" @click="audio.setMuted(!audio.muted.value)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path v-if="!audio.muted.value" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /><path v-else d="M16 9.5l5 5M21 9.5l-5 5" /></svg>
            <span>{{ audio.muted.value ? 'Без звука' : 'Звук' }}</span>
          </button>
        </div>
        <span class="solo-label">Туман · одиночная игра</span>
        <h1 class="solo-title__name">{{ v?.info.title ?? 'Туман' }}</h1>
        <p v-if="v" class="solo-title__lede">{{ v.info.lede }}</p>
        <p v-if="error" class="solo-title__error">{{ error }}</p>
        <div v-if="v" class="solo-title__actions">
          <button v-if="canContinue" type="button" class="solo-btn" @click="enter('continue')">Продолжить</button>
          <button type="button" class="solo-btn" :class="{ 'solo-btn--ghost': canContinue }" @click="askNew">{{ confirmNew ? 'Точно начать заново?' : 'Новая игра' }}</button>
          <button v-for="s in v.saves" :key="s.slot" type="button" class="solo-btn solo-btn--ghost" @click="enter({ load: s.slot })">Загрузить: {{ s.place }} · {{ when(s.at) }}</button>
        </div>
        <p class="solo-title__hint">{{ v?.info.minutes }} минут<template v-if="v?.info.hard"> · сложная: загадки без подсказок, ответы — в записках и вокруг</template> · лучше в наушниках и в темноте · сохраняться можно только у телефонов</p>
        <div v-if="v" class="solo-move">
          <template v-if="moveOpen === 'give'">
            <p v-if="transferCode" class="solo-move__code">Код на другом устройстве: <b class="tabnum">{{ transferCode.code.slice(0, 3) }} {{ transferCode.code.slice(3) }}</b><small>действует {{ transferCode.minutes >= 300 * 1440 ? 'год' : transferCode.minutes >= 1440 ? Math.round(transferCode.minutes / 1440) + ' дней' : transferCode.minutes + ' минут' }}; там: заставка «Тумана» → «Продолжить с другого устройства»</small></p>
            <p v-else class="solo-muted">Получаю код…</p>
            <button type="button" class="solo-move__link" @click="moveOpen = null">Скрыть</button>
          </template>
          <form v-else-if="moveOpen === 'take'" class="solo-move__form" @submit.prevent="adoptCode.length === 6 && adopt(adoptCode)">
            <input v-model="adoptShown" class="solo-move__input" placeholder="ABC DEF" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Код переноса">
            <button type="submit" class="solo-btn solo-btn--small" :disabled="adoptCode.length !== 6">Забрать партию</button>
            <button type="button" class="solo-move__link" @click="moveOpen = null">Отмена</button>
            <p v-if="adoptError" class="solo-title__error">{{ adoptError }}</p>
          </form>
          <template v-else>
            <button v-if="canContinue" type="button" class="solo-move__link" @click="giveCode">Продолжить на другом устройстве</button>
            <button type="button" class="solo-move__link" @click="moveOpen = 'take'">Продолжить с другого устройства</button>
          </template>
        </div>
        <p v-if="!connected && v" class="solo-title__error">Нет связи — переподключаюсь…</p>
      </div>
    </section>

    <!-- ── игра ── -->
    <template v-else>
      <main class="solo-main">
        <div
          class="solo-view" :class="[`solo-view--${darkness}`, { 'solo-view--noart': !artOk, 'solo-view--weak': v.battery < 15, 'solo-view--depth': !!depthSrc }]"
          :style="{ '--lx': `${torch.x}%`, '--ly': `${torch.y}%` }"
          @pointermove="onPointer" @pointerdown="onPointer" @click="backToPlace"
        >
          <!-- объёмный кадр — один на всю игру: места сменяются внутри него перетеканием (SoloDepth) -->
          <Transition name="solo-over">
            <SoloDepth v-if="depthSrc" class="solo-view__art" :src="artSrc" :depth="depthSrc" :mode="darkness" :lx="torch.x" :ly="torch.y" :power="torchPower" :beam="torchBeam" :focus="v.artFocus[shownArt]" :rain="rainAmount" :flash="flash" :lights="v.lights?.[shownArt]" :surface="place?.surface" :wind="windSrc" :windy="windy" :leaves="place?.outdoor ? (place.weather === 'storm' ? 1.6 : 1) : 0" :fog="fogAmount" :other="v.otherworld" @fail="depthFail = true" @ready="frameReady++" />
          </Transition>
          <!-- плоский кадр (крупный план, нет карты глубины): уходящий гаснет, только когда новый нарисован (onCutLeave) -->
          <Transition :css="false" @enter="onCutEnter" @leave="onCutLeave">
            <img v-if="!depthSrc && artOk && artSrc" :key="artSrc" class="solo-view__art" :class="`solo-view__art--${darkness}`" :src="artSrc" :style="{ objectPosition: v.artFocus[shownArt] }" alt="" @load="frameReady++" @error="artOk = false">
          </Transition>
          <Transition name="fade">
            <button v-if="closeup && artOk" type="button" class="solo-view__back" @click.stop="backToPlace">← {{ place?.name }}</button>
          </Transition>
          <i class="solo-tint" aria-hidden="true" />
          <SoloFog :density="place?.ambience.includes('room-hum') ? 0.45 : 1" :other="v.otherworld" />
          <Transition name="solo-over"><i :key="`${darkness}-${!!depthSrc}-${v.battery < 15}`" class="solo-view__dark" aria-hidden="true" /></Transition>
          <Transition name="fade">
            <p v-if="torchDead" class="solo-torch-dead" role="status">Фонарь заглох. {{ coarse ? 'Встряхните телефон или несколько раз быстро тапните по фонарю' : 'Потрясите его — несколько раз быстро нажмите F' }}</p>
          </Transition>
          <i v-if="!depthSrc" class="solo-view__flash" :style="{ opacity: flash * 0.55 }" aria-hidden="true" />
          <i :key="hurtFlash" class="solo-view__hurt" :class="{ on: hurtFlash > 0 }" aria-hidden="true" />
          <i v-if="v.health <= 30" class="solo-view__pulse" aria-hidden="true" />
        </div>

        <div class="solo-story">
          <Transition name="fade" mode="out-in">
            <h2 :key="place?.id" class="solo-story__place">{{ place?.name }}</h2>
          </Transition>
          <Transition name="fade" mode="out-in">
            <div :key="`${place?.id}-${place?.text.join('').length ?? 0}`" class="solo-story__text">
              <p v-for="(t, i) in place?.text" :key="i">{{ t }}</p>
            </div>
          </Transition>
          <TransitionGroup name="solo-feed" tag="div" class="solo-feed" aria-live="polite">
            <p v-for="f in feed" :key="f.seq" class="solo-feed__line">{{ f.text }}</p>
          </TransitionGroup>
        </div>
      </main>

      <aside class="solo-side">
        <div class="solo-tools">
          <button type="button" class="solo-tool" title="Карта (M)" @click="mapOpen = true"><SoloIcon name="map" /><span>Карта</span></button>
          <button type="button" class="solo-tool" title="Записки (J)" @click="notesOpen = true"><SoloIcon name="notes" /><span>Записки</span><b v-if="unread" class="tabnum">{{ unread }}</b></button>
          <button type="button" class="solo-tool" :disabled="!v.canSave" :title="v.canSave ? place?.save ?? '' : 'Сохраниться можно только у телефона'" @click="saveOpen = true"><SoloIcon name="phone" /><span>Сохранить</span></button>
          <button type="button" class="solo-tool" title="Меню (Esc)" @click="menuOpen = true"><SoloIcon name="menu" /><span>Меню</span></button>
        </div>

        <div class="solo-status">
          <div class="solo-ecg" :class="`solo-ecg--${healthState.key}`" :title="healthState.label">
            <svg viewBox="0 0 200 40" aria-hidden="true">
              <path class="solo-ecg__base" pathLength="100" d="M0 22 H40 L46 22 L50 6 L55 36 L60 22 H100 H140 L146 22 L150 6 L155 36 L160 22 H200" />
              <path class="solo-ecg__beat" pathLength="100" d="M0 22 H40 L46 22 L50 6 L55 36 L60 22 H100 H140 L146 22 L150 6 L155 36 L160 22 H200" />
            </svg>
            <span>{{ healthState.label }}</span>
          </div>
          <button v-if="hasFlashlight" type="button" class="solo-light" :class="{ on: v.light }" title="Фонарь (F)" @click="toggleLight">
            <SoloIcon name="item-flashlight" />
            <span class="solo-battery" :class="{ low: lowBattery, dead: torchDead }" :aria-label="`заряд ${v.battery} %`">
              <i v-for="n in 5" :key="n" :class="{ full: v.battery > (n - 1) * 20 + 3 }" />
            </span>
            <span class="tabnum">{{ torchDead ? 'заглох' : `${v.battery}%` }}</span>
          </button>
          <button v-if="hasRadio" type="button" class="solo-radio" :class="[`solo-radio--${v.radio}`, { 'solo-radio--off': !v.radioOn }]" :title="v.radioOn ? 'Приёмник шипит, когда рядом что-то есть. Щелчок — выключить (R)' : 'Приёмник выключен. Щелчок — включить (R)'" @click="toggleRadio">
            <SoloIcon name="item-radio" /><span><i /><i /><i /><i /><i /></span><small>{{ v.radioOn ? '' : 'выкл' }}</small>
          </button>
          <div v-if="v.weapon || v.ammo" class="solo-weapon"><SoloIcon :name="v.inventory.find(i => i.equipped)?.icon ?? 'weapon'" />{{ v.weapon ?? 'без оружия' }}<b v-if="v.ammo" class="tabnum"> · патронов {{ v.ammo }}</b></div>
        </div>

        <p v-if="mode" class="solo-mode">
          {{ mode.kind === 'use' ? `Применить «${mode.name}» — к чему?` : `Соединить «${mode.name}» — с чем?` }}
          <button type="button" @click="mode = null; picked = null">отмена</button>
        </p>

        <section v-if="v.hotspots.length" class="solo-block">
          <p class="solo-label">Осмотреть</p>
          <button
            v-for="h in v.hotspots" :key="h.id" type="button" class="solo-row"
            :class="[`solo-row--${h.kind}`, { 'solo-row--done': h.done, 'solo-row--target': mode?.kind === 'use' }]"
            @click="clickHotspot(h.id)"
          ><SoloIcon :name="h.kind === 'talk' ? 'talk' : h.kind === 'puzzle' ? 'lock' : 'eye'" />{{ h.name }}</button>
        </section>

        <section class="solo-block">
          <p class="solo-label">Идти</p>
          <button
            v-for="x in v.exits" :key="x.to" type="button" class="solo-row solo-row--exit"
            :class="{ 'solo-row--locked': x.locked, 'solo-row--new': !x.known }"
            :disabled="!!mode" @click="send({ type: 'go', to: x.to })"
          ><SoloIcon :name="x.locked ? 'lock' : 'step'" />{{ x.label }}</button>
        </section>

        <section class="solo-block solo-block--bag">
          <button type="button" class="solo-bagbtn" :class="{ on: bagOpen }" title="Вещи (I)" @click="bagOpen = true">
            <span class="solo-bagbtn__top"><span class="solo-label">Вещи</span><b class="tabnum">{{ v.inventory.length }}</b></span>
            <span class="solo-bagbtn__icons">
              <SoloIcon v-for="it in v.inventory.slice(0, 8)" :key="it.id" :name="it.icon" :class="{ equipped: it.equipped }" />
            </span>
          </button>
          <p v-if="mode?.kind === 'use'" class="solo-bagbtn__mode">Применить «{{ mode.name }}» — выберите, к чему. <button type="button" class="solo-link" @click="mode = null; picked = null">Отмена</button></p>
        </section>
      </aside>

      <!-- ── панели ── -->
      <SoloMap v-if="mapOpen" :map="v.map" :area="place?.area ?? ''" :story="story" @close="mapOpen = false" />
      <SoloBag
        v-if="bagOpen" :items="v.inventory" :story="story" :picked="picked" :combining="mode?.kind === 'combine' ? mode.item : null"
        :can-apply="v.hotspots.length > 0" :groups="BAG" :verb="itemVerb"
        @pick="pickInBag" @use="useSelf" @examine="id => { send({ type: 'examine', item: id }); bagOpen = false }"
        @apply="startMode('use'); bagOpen = false" @combine="startMode('combine')" @cancel="mode = null" @close="bagOpen = false; if (mode?.kind === 'combine') mode = null"
      />
      <SoloNotes v-if="notesOpen" :notes="v.notes" :focus="notesFocus" @close="notesOpen = false" @read="readNote" />

      <div v-if="saveOpen" class="solo-veil" @click.self="saveOpen = false">
        <div class="solo-card" role="dialog" aria-modal="true">
          <p class="solo-label">Сохранение</p>
          <p class="solo-card__lede">{{ place?.save }}.</p>
          <button v-for="(s, i) in slots" :key="i" type="button" class="solo-slot" :disabled="!v.canSave" @click="send({ type: 'save', slot: i }); saveOpen = false">
            <b>Ячейка {{ i + 1 }}</b><span>{{ s ? `${s.place} · ${when(s.at)} · ${s.minutes} мин` : 'пусто' }}</span>
          </button>
          <button type="button" class="solo-btn solo-btn--ghost" @click="saveOpen = false">Назад</button>
        </div>
      </div>

      <div v-if="menuOpen" class="solo-veil" @click.self="menuOpen = false">
        <div class="solo-card" role="dialog" aria-modal="true">
          <p class="solo-label">Пауза · {{ v.info.title }}</p>
          <button type="button" class="solo-btn" @click="menuOpen = false">Вернуться</button>
          <button v-for="s in v.saves" :key="s.slot" type="button" class="solo-btn solo-btn--ghost" @click="enter({ load: s.slot })">Загрузить: {{ s.place }} · {{ when(s.at) }}</button>
          <button type="button" class="solo-btn solo-btn--ghost" @click="audio.setMuted(!audio.muted.value)">{{ audio.muted.value ? 'Включить звук' : 'Выключить звук' }}</button>
          <button type="button" class="solo-btn solo-btn--ghost" @click="askNew">{{ confirmNew ? 'Точно? Несохранённое пропадёт' : 'Начать заново' }}</button>
          <button type="button" class="solo-btn solo-btn--ghost" @click="entered = false; menuOpen = false">На заставку</button>
          <p class="solo-muted solo-keys">M — карта · J — записки · F — фонарь · R — приёмник · 1–5 — действия во встрече</p>
        </div>
      </div>

      <!-- ── поверх всего ── -->
      <SoloScene v-if="overlay === 'scene' && v.scene" :key="v.scene.seq" :lines="v.scene.lines" :story="story" :hero="v.info.hero" :speakers="speakers" :focus="v.artFocus" :fallback="artOk ? artSrc : null" @done="sceneDone" />
      <SoloScene v-else-if="overlay === 'ending-scene' && v.ending" :key="`end-${v.ending.id}`" :lines="v.ending.lines" :story="story" :hero="v.info.hero" :speakers="speakers" :focus="v.artFocus" :fallback="artOk ? artSrc : null" @done="endingPlayed = v.ending!.id" />
      <SoloChase v-else-if="overlay === 'chase' && v.chase" :chase="v.chase" :story="story" :focus="v.artFocus" :depth="v.depth" :wind="v.wind" :offset="clockOffset" @send="relay" />
      <SoloBoss v-else-if="overlay === 'boss' && v.boss" :boss="v.boss" :story="story" :focus="v.artFocus" :depth="v.depth" :offset="clockOffset" @send="relay" />
      <SoloEncounter v-else-if="overlay === 'encounter' && v.encounter" :enc="v.encounter" :story="story" :focus="v.artFocus" :depth="v.depth" :offset="clockOffset" :light="v.light" :health="v.health" @send="relay" />
      <SoloDialogue v-else-if="overlay === 'dialogue' && v.dialogue" :data="v.dialogue" :story="story" :hero="v.info.hero" @send="relay" />
      <SoloPuzzle v-else-if="overlay === 'puzzle' && v.puzzle" :data="v.puzzle" :story="story" :last-fail="puzzleFail" @send="relay" @notes="notesOpen = true" />
      <SoloFound v-else-if="overlay === 'found' && found[0]" :key="`${found.length}-${found[0].item?.id ?? found[0].note?.id}`" :item="found[0].item" :note="found[0].note" :story="story" :more="found.length - 1" @done="nextFound" @read="openNote" />

      <div v-if="overlay === 'dead'" class="solo-end solo-end--dead" role="alertdialog">
        <SoloFog :density="1.2" other />
        <div class="solo-end__body">
          <p class="solo-label">{{ v.info.death.note }}</p>
          <h2 class="solo-end__title">{{ v.info.death.title }}</h2>
          <div class="solo-title__actions">
            <button v-if="lastSave" type="button" class="solo-btn" @click="send({ type: 'load', slot: lastSave.slot })">С последнего сохранения: {{ lastSave.place }}</button>
            <button v-for="s in v.saves.filter(x => x.slot !== lastSave?.slot)" :key="s.slot" type="button" class="solo-btn solo-btn--ghost" @click="send({ type: 'load', slot: s.slot })">Загрузить: {{ s.place }}</button>
            <button type="button" class="solo-btn" :class="{ 'solo-btn--ghost': lastSave }" @click="send({ type: 'new' }); endingPlayed = null">Начать сначала</button>
          </div>
        </div>
      </div>

      <div v-if="overlay === 'ending' && v.ending" class="solo-end" role="dialog">
        <img v-if="cover" class="solo-title__art" :src="cover" alt="" @error="($event.target as HTMLImageElement).hidden = true">
        <i class="solo-tint" aria-hidden="true" />
        <SoloFog :density="0.9" />
        <div class="solo-end__body">
          <p class="solo-label">Концовка</p>
          <h2 class="solo-end__title">{{ v.ending.title }}</h2>
          <dl class="solo-end__stats">
            <div><dt>в игре</dt><dd class="tabnum">{{ v.ending.stats.minutes }} мин</dd></div>
            <div><dt>сохранений</dt><dd class="tabnum">{{ v.ending.stats.saves }}</dd></div>
            <div><dt>смертей</dt><dd class="tabnum">{{ v.ending.stats.deaths }}</dd></div>
            <div><dt>упокоено</dt><dd class="tabnum">{{ v.ending.stats.kills }}</dd></div>
          </dl>
          <div class="solo-title__actions">
            <button type="button" class="solo-btn" @click="send({ type: 'new' }); endingPlayed = null">Сыграть снова</button>
            <a href="/" class="solo-btn solo-btn--ghost" @click.prevent="toMenu">В меню «Красной нити»</a>
          </div>
        </div>
      </div>

      <p v-if="!connected" class="solo-offline">Нет связи — переподключаюсь…</p>
    </template>
  </div>
</template>
