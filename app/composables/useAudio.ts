/* Звук экрана: четыре слоя поверх одного AudioContext.
   — атмосфера: бесшовные петли через два перекрывающихся буфера (без <audio loop>, где слышна склейка);
   — музыка: одна тема за раз, темы сменяются перекрёстным затуханием, петля — тем же способом;
   — эффекты: одиночные выстрелы;
   — голос: реплики свидетелей; на время голоса атмосфера и музыка приглушаются. */

type Layer = 'ambience' | 'music' | 'sfx' | 'voice'

const LEVELS: Record<Layer, number> = { ambience: 0.55, music: 0.42, sfx: 0.8, voice: 1 }
const DUCK: Partial<Record<Layer, number>> = { ambience: 0.3, music: 0.3 }
const XFADE = 3 // секунд перекрёстного затухания на границе петли
const MUSIC_FADE = 4 // секунд на смену темы

import { currentCase, currentSetting } from '~/utils/case-store'
import { afterArt, soundLoad } from '~/utils/net-queue'

let ctx: AudioContext | null = null
/** какие реплики озвучены (по делу) — чтобы не дёргать сервер за файлами, которых нет */
const manifests = new Map<string, Promise<Set<string>>>()
function voiced(): Promise<Set<string>> {
  const c = currentCase.value
  if (!manifests.has(c)) manifests.set(c, fetch(`/voice/${c}/manifest.json`).then(r => (r.ok ? r.json() : [])).then((ids: string[]) => new Set(ids)).catch(() => new Set<string>()))
  return manifests.get(c)!
}
const gains: Partial<Record<Layer, GainNode>> = {}
/** атмосфера в помещении звучит «за окном»: фильтр высоких частот и приглушение */
let ambFilter: BiquadFilterNode | null = null
/** «далеко»: вход цепочки низких частот и эха — так звучит всё, что где-то за озером или в другом конце здания */
let farInput: GainNode | null = null
/** «комната»: короткое эхо для одиночных звуков, доля эха — по покрытию места (кафель гулкий, улица сухая) */
let room: { input: GainNode; wet: GainNode; conv: ConvolverNode } | null = null
/** звуки, которые по смыслу всегда далеко: идут через эту цепочку, откуда бы их ни попросили */
const FAR_NAMES = new Set(['bugle-far-cut', 'bugle-far-full', 'whisper-far', 'siren-bugle', 'oarlocks', 'announce-far', 'branch-far'])
let ambRoom: GainNode | null = null
/** «пространство» места: общее эхо для звуков вокруг героя — две свёртки, между ними плавный переход при смене места */
let space: { input: GainNode; a: { conv: ConvolverNode; g: GainNode }; b: { conv: ConvolverNode; g: GainNode }; front: 'a' | 'b'; kind: string } | null = null
/** пространства: длина хвоста, спад, яркость (кафель звонкий, дерево глухое), ранние отражения (стены рядом), доля эха */
const SPACES: Record<string, { sec: number; decay: number; bright: number; early: number; wet: number }> = {
  outdoor: { sec: 1.6, decay: 4, bright: 0.3, early: 0, wet: 0.5 },
  forest: { sec: 2.2, decay: 3.4, bright: 0.28, early: 0.12, wet: 0.6 },
  wood: { sec: 1, decay: 3.2, bright: 0.45, early: 0.55, wet: 0.7 },
  tile: { sec: 2.3, decay: 2.3, bright: 0.85, early: 0.8, wet: 1 },
  machine: { sec: 2.8, decay: 2.2, bright: 0.6, early: 0.7, wet: 1 },
  water: { sec: 3.2, decay: 2, bright: 0.55, early: 0.7, wet: 1.1 },
  tunnel: { sec: 3.8, decay: 1.8, bright: 0.6, early: 0.9, wet: 1.2 }
}
const buffers = new Map<string, Promise<AudioBuffer | null>>()
const unlocked = ref(false)
const muted = ref(false)
/** озвучка реплик: можно выключить, оставив музыку и звуки; сцены тогда идут по щелчку. Запоминается в браузере */
const VOICE_KEY = 'rn:voice'
const voiceOn = ref(true)
try { if (typeof localStorage !== 'undefined' && localStorage.getItem(VOICE_KEY) === 'off') voiceOn.value = false } catch { /* приватный режим */ }
const speaking = ref(false)

/** sig — отпечаток буфера: по нему узнаём тот же трек под другим адресом. Раньше сравнивали длину, но темы разных миров,
    сгенерированные на одну длительность, совпадают до сэмпла — и меню не переключало музыку между Неоном и Туманом */
interface Loop { name: string; stop: (fade?: number) => void; setLevel: (v: number) => void; gain: GainNode; world?: string; sig: string }

function signature(buf: AudioBuffer) {
  const d = buf.getChannelData(0)
  const parts: string[] = [String(buf.length)]
  for (let i = 1; i <= 16; i++) parts.push(d[Math.floor(buf.length * i / 17)]!.toFixed(4))
  return parts.join(':')
}
const loops = new Map<string, Loop>()
let music: Loop | null = null
let musicWanted: string | null = null
/** громкость темы относительно слоя музыки: под исследованием тише, на заставке и в погоне — в полную */
let musicLevel = 1
/** текущий голос — одновременно звучит только одна реплика */
let voiceSrc: AudioBufferSourceNode | null = null

/* Равномощное затухание (sin/cos) кусочно-линейными рампами: в отличие от setValueCurveAtTime
   такие события никогда не «пересекаются» и не бросают NotSupportedError, если таймер опоздал. */
const STEPS = 8
function fadeIn(p: AudioParam, at: number, len: number) {
  p.setValueAtTime(0, at)
  for (let k = 1; k <= STEPS; k++) p.linearRampToValueAtTime(Math.sin((k / STEPS) * Math.PI / 2), at + len * k / STEPS)
}
function fadeOut(p: AudioParam, at: number, len: number) {
  p.setValueAtTime(1, at)
  for (let k = 1; k <= STEPS; k++) p.linearRampToValueAtTime(Math.cos((k / STEPS) * Math.PI / 2), at + len * k / STEPS)
}

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    ambFilter = ctx.createBiquadFilter()
    ambFilter.type = 'lowpass'
    // пологий срез без резонанса: дождь за окном глуше, но не превращается в гул
    ambFilter.Q.value = 0.5
    ambFilter.frequency.value = 18000
    ambRoom = ctx.createGain()
    ambFilter.connect(ambRoom).connect(ctx.destination)
    for (const layer of ['ambience', 'music', 'sfx', 'voice'] as Layer[]) {
      const g = ctx.createGain()
      g.gain.value = LEVELS[layer]
      g.connect(layer === 'ambience' ? ambFilter : ctx.destination)
      gains[layer] = g
    }
  }
  return ctx
}

/** если у дела нет темы — чем её заменить (по порядку) */
const THEME_FALLBACK: Record<string, string[]> = {
  'prologue': ['lobby'],
  'night-late': ['night-early', 'lobby'],
  'night-dawn': ['night-late', 'night-early', 'lobby'],
  'discuss': ['lobby'],
  'accuse': ['night-late', 'night-early', 'lobby'],
  'verdict-wrong': ['accuse', 'night-late', 'night-early', 'lobby'],
  'epilogue': ['final-solved', 'lobby'],
  'final-solved': ['epilogue', 'lobby'],
  'final-failed': ['verdict-wrong', 'accuse', 'night-early', 'lobby'],
  // «Туман»: если у истории нет частной темы — ближайшая по месту
  'town2': ['town'], 'lake': ['camp', 'town'], 'finale': ['boss', 'camp'], 'people': ['town'],
  'memory': ['town'], 'confession': ['sanatorium', 'town'], 'fight': ['boss'], 'boss': ['fight'], 'intake': ['otherworld', 'town'], 'gallery': ['otherworld', 'intake']
}

async function load(url: string, signal?: AbortSignal): Promise<AudioBuffer | null> {
  const c = ensure()
  if (!c) return null
  if (!buffers.has(url)) {
    const p: Promise<AudioBuffer | null> = fetch(url, signal ? { signal } : undefined)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(ab => c.decodeAudioData(ab))
      // оборванную загрузку не запоминаем — в следующий раз тема скачается заново
      .catch(() => { if (signal?.aborted && buffers.get(url) === p) buffers.delete(url); return null })
    buffers.set(url, p)
  }
  return buffers.get(url)!
}
/** тема, которая сейчас качается: сменилась раньше, чем докачалась (заставка → место), — загрузку обрываем */
let musicLoading: { wanted: string; ctrl: AbortController } | null = null
let ambGen = 0

/** Гладкая петля: буфер запускается снова за XFADE секунд до конца, оба края — по равномощным кривым. */
function startLoop(name: string, buffer: AudioBuffer, target: number, dest: GainNode, fadeSec = 2.5, breathing = false): Loop {
  const c = ensure()!
  const gain = c.createGain()
  gain.gain.value = 0
  /* атмосфера медленно плывёт по стерео: у каждой петли своя скорость (40–110 с на качание) и размах —
     ветер уходит влево, пока капель тянется вправо, и ухо не привыкает к неподвижной картине */
  let drift: { osc: OscillatorNode; pan: StereoPannerNode } | null = null
  if (breathing && c.createStereoPanner) {
    const pan = c.createStereoPanner()
    const osc = c.createOscillator(); osc.frequency.value = 1 / (40 + Math.random() * 70)
    const depth = c.createGain(); depth.gain.value = 0.15 + Math.random() * 0.25
    osc.connect(depth).connect(pan.pan)
    osc.start(c.currentTime + Math.random() * 3)
    gain.connect(pan).connect(dest)
    drift = { osc, pan }
  } else gain.connect(dest)
  let alive = true
  let level = target
  let breathTimer: ReturnType<typeof setTimeout> | null = null
  /* петля атмосферы дышит: каждые 4–10 с уровень медленно уходит к 0,65…1,1 от заданного — ветер наплывает и стихает */
  const breathe = () => {
    if (!alive) return
    const span = 4 + Math.random() * 6
    const t = c.currentTime
    gain.gain.cancelScheduledValues(t)
    gain.gain.setValueAtTime(gain.gain.value, t)
    gain.gain.linearRampToValueAtTime(level * (0.65 + Math.random() * 0.45), t + span)
    breathTimer = setTimeout(breathe, span * 1000)
  }
  if (breathing) breathTimer = setTimeout(breathe, fadeSec * 1000 + 500)
  const sources: AudioBufferSourceNode[] = []
  const dur = buffer.duration
  const xf = Math.min(XFADE, dur / 3)
  const period = Math.max(1, dur - xf)

  const schedule = (planned: number) => {
    if (!alive) return
    // таймер мог опоздать (вкладка в фоне, ноутбук спал) — тогда стартуем от «сейчас», а не из прошлого
    const at = Math.max(planned, c.currentTime + 0.02)
    try {
      const src = c.createBufferSource()
      src.buffer = buffer
      const env = c.createGain()
      fadeIn(env.gain, at, xf)
      fadeOut(env.gain, at + dur - xf, xf)
      src.connect(env).connect(gain)
      src.start(at)
      src.stop(at + dur + 0.05)
      sources.push(src)
      src.onended = () => { const i = sources.indexOf(src); if (i >= 0) sources.splice(i, 1) }
    } catch (e) {
      console.warn('петля', name, e)
    }
    // следующий экземпляр — на границе, с перекрытием; цепочка не рвётся даже при ошибке
    const next = at + period
    const wait = Math.max(0, (next - c.currentTime - 0.5) * 1000)
    setTimeout(() => schedule(next), wait)
  }
  schedule(c.currentTime + 0.05)
  gain.gain.linearRampToValueAtTime(target, c.currentTime + fadeSec)

  return {
    name, gain, sig: signature(buffer),
    setLevel: (v: number) => {
      level = v
      const t = c.currentTime
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(v, t + 2)
    },
    stop: (fade = 2.5) => {
      alive = false
      if (breathTimer) clearTimeout(breathTimer)
      const t = c.currentTime
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(0, t + fade)
      setTimeout(() => {
        for (const s of sources) { try { s.stop() } catch { /* уже остановлен */ } }
        gain.disconnect()
        if (drift) { try { drift.osc.stop() } catch { /* уже */ } drift.pan.disconnect() }
      }, fade * 1000 + 200)
    }
  }
}

/** звук мира: /sfx/<мир>/<роль>.m4a, если такого нет — общий /sfx/<роль>.m4a */
/** у частых звуков боя несколько записей (name-2, name-3, …): подряд одна и та же не идёт */
const VARIANTS: Record<string, number> = {
  'solo-hit-land': 3, 'solo-swing': 3, 'solo-hurt': 3, 'solo-dodge': 2, 'solo-shot': 2,
  'thud-cloth': 2, 'wet-hurt': 2, 'counselor-hurt': 2, 'helmet-clang': 2, 'bugle-blast': 2, 'wet-grab': 2, 'whistle-blast': 2, 'hose-whip': 2,
  'thunder-far': 3, 'footsteps-behind': 2, 'whisper-near': 2, 'door-slam-far': 2, 'industrial-clank': 2
}
const lastVariant = new Map<string, number>()
function variant(name: string) {
  const n = VARIANTS[name]
  if (!n) return name
  let k = 1 + Math.floor(Math.random() * n)
  if (k === lastVariant.get(name)) k = (k % n) + 1
  lastVariant.set(name, k)
  return k === 1 ? name : `${name}-${k}`
}

async function loadSfx(name: string): Promise<AudioBuffer | null> {
  if (name.includes('.')) return load(`/sfx/${name}`)
  return (await load(`/sfx/${currentSetting.value}/${name}.m4a`)) ?? load(`/sfx/${name}.m4a`)
}

function rampTo(p: AudioParam, value: number, seconds: number) {
  const c = ctx
  if (!c) return
  p.cancelScheduledValues(c.currentTime)
  p.setValueAtTime(p.value, c.currentTime)
  p.linearRampToValueAtTime(value, c.currentTime + seconds)
}

function rampLayer(layer: Layer, value: number, seconds: number) {
  const c = ctx; const g = gains[layer]
  if (!c || !g) return
  g.gain.cancelScheduledValues(c.currentTime)
  g.gain.setValueAtTime(g.gain.value, c.currentTime)
  g.gain.linearRampToValueAtTime(value, c.currentTime + seconds)
}

function applyDuck() {
  for (const layer of ['ambience', 'music'] as Layer[]) {
    const base = muted.value ? 0 : LEVELS[layer]
    rampLayer(layer, speaking.value ? base * (DUCK[layer] ?? 1) : base, speaking.value ? 0.4 : 1.2)
  }
}

export function useAudio() {
  /** Разблокировать звук по жесту пользователя (клик «начать» на экране). */
  async function unlock() {
    const c = ensure()
    if (!c) return
    if (c.state === 'suspended') await c.resume()
    unlocked.value = c.state === 'running'
  }

  function setVoiceOn(on: boolean) {
    voiceOn.value = on
    if (!on) stopVoice()
    try { localStorage.setItem(VOICE_KEY, on ? 'on' : 'off') } catch { /* приватный режим */ }
  }

  function setMuted(m: boolean) {
    muted.value = m
    const c = ensure(); if (!c) return
    for (const layer of ['sfx', 'voice'] as Layer[]) rampLayer(layer, m ? 0 : LEVELS[layer], 0.3)
    applyDuck()
  }

  /** Улица или помещение: в помещении дождь и ветер глохнут, как за стеклом; переход плавный. */
  function setOutdoors(outdoors: boolean) {
    const c = ensure(); if (!c || !ambFilter || !ambRoom) return
    // в помещении дождь слышен через стекло: верх приглушён, а не срезан до 650 Гц, как раньше, — иначе звучит «урезанно»
    ambFilter.frequency.setTargetAtTime(outdoors ? 18000 : 3200, c.currentTime, 0.6)
    ambRoom.gain.setTargetAtTime(outdoors ? 1 : 0.5, c.currentTime, 0.6)
  }

  /** Атмосфера: набор петель, которые должны звучать сейчас. Лишние затухают, новые всплывают. */
  async function ambience(names: string[], levels: Record<string, number> = {}) {
    const c = ensure(); if (!c) return
    // набор сменился, пока петли этого качались, — дальше грузит новый вызов
    const gen = ++ambGen
    for (const [name, loop] of loops) if (!names.includes(name)) { loop.stop(); loops.delete(name) }
    for (const name of names) {
      const target = levels[name] ?? 1
      const existing = loops.get(name)
      if (existing && existing.world !== currentSetting.value) { existing.stop(); loops.delete(name) }
      else if (existing) { existing.setLevel(target); continue }
      // новая петля (300 КБ) не отнимает канал у картинки места — ждёт её, но недолго
      if (!buffers.has(`/sfx/${currentSetting.value}/${name}.m4a`)) await afterArt(3000)
      if (gen !== ambGen) return
      if (loops.has(name)) continue
      const buf = await soundLoad(loadSfx(name))
      if (gen !== ambGen) return
      if (!buf || loops.has(name)) continue
      loops.set(name, { ...startLoop(name, buf, target, gains.ambience!, 2.5, true), world: currentSetting.value })
    }
  }

  /** Музыка: одна тема; смена — перекрёстным затуханием. null — тишина.
      Имя темы ищется в папке активного дела; путь с «/» — файл как есть (музыка меню мира). */
  /** fade — секунд на смену: в бой музыка входит быстрее, чем сменяется тема района */
  async function theme(name: string | null, level = 1, fade = MUSIC_FADE, urgent = false) {
    const c = ensure(); if (!c) return
    const wanted = name ? (name.startsWith('/') ? name : `/music/${currentCase.value}/${name}.mp3`) : null
    musicWanted = wanted
    musicLevel = level
    if (musicLoading && musicLoading.wanted !== wanted) { musicLoading.ctrl.abort(); musicLoading = null }
    if (!wanted || !name) { music?.stop(fade); music = null; return }
    // у дела может не быть всех тем: берём ближайшую по настроению из тех, что есть
    // у нового дела музыки может не быть совсем — тогда тема мира из меню, лишь бы не тишина
    const chain = name.startsWith('/') ? [wanted] : [...[name, ...(THEME_FALLBACK[name] ?? [])].map(n => `/music/${currentCase.value}/${n}.mp3`), `/music/settings/${currentSetting.value}.mp3`]
    for (const key of chain) {
      if (music?.name === key) { rampTo(music.gain.gain, level, Math.max(2, fade)); return }
      // на слабом интернете тема (2 МБ) не отнимает канал у картинки места: ждёт её; до тех пор играет прежняя.
      // Бой и погоня (urgent) не ждут: под дракой не должна играть спокойная тема
      let ctrl: AbortController | undefined
      if (!buffers.has(key)) {
        if (!urgent) await afterArt(8000)
        if (musicWanted !== wanted) return
        if (!buffers.has(key)) { ctrl = new AbortController(); musicLoading = { wanted, ctrl } }
      }
      const buf = await soundLoad(load(key, ctrl?.signal))
      if (ctrl && musicLoading?.ctrl === ctrl) musicLoading = null
      if (musicWanted !== wanted) return
      if (!buf) continue
      if (music?.name === key) return
      // тот же трек под другим адресом (тема мира в меню = заставка истории) — играет дальше, без перезапуска
      if (music && music.sig === signature(buf)) { music.name = key; music.gain.gain.linearRampToValueAtTime(musicLevel, c.currentTime + 2); return }
      music?.stop(fade)
      music = startLoop(key, buf, musicLevel, gains.music!, fade)
      return
    }
  }

  /** Музыкальный номер один раз, без петли, через шину музыки: смерть в тумане. Возвращает false, если у дела такой темы нет */
  async function stinger(name: string, level = 1): Promise<boolean> {
    const c = ensure(); if (!c) return false
    const buf = await load(`/music/${currentCase.value}/${name}.mp3`)
    if (!buf) return false
    const src = c.createBufferSource()
    src.buffer = buf
    const g = c.createGain(); g.gain.value = level
    src.connect(g); g.connect(gains.music!)
    src.start()
    return true
  }

  /** Нота синтезатором: для загадок на слух (шкатулка, пианино, горн). note — «C5», «F#4»; возвращает длительность */
  function tone(note: string, timbre: 'box' | 'piano' | 'bugle' = 'piano', at = 0, volume = 0.5): number {
    const c = ensure(); if (!c) return 0
    const m = /^([A-G])(#?)(\d)$/.exec(note)
    if (!m) return 0
    const semi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12 - 9
    const freq = 440 * Math.pow(2, semi / 12)
    const t0 = c.currentTime + at
    const dur = timbre === 'box' ? 1.1 : timbre === 'bugle' ? 0.55 : 1.6
    const out = c.createGain()
    out.gain.setValueAtTime(0.0001, t0)
    out.gain.exponentialRampToValueAtTime(volume, t0 + (timbre === 'bugle' ? 0.05 : 0.008))
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    // тембр: шкатулка — чистый тон с высоким призвуком, пианино — треугольник с октавой, горн — пила через фильтр
    const parts: [OscillatorType, number, number][] = timbre === 'box' ? [['sine', 1, 1], ['sine', 4.2, 0.18]]
      : timbre === 'bugle' ? [['sawtooth', 1, 0.5], ['square', 2, 0.08]] : [['triangle', 1, 1], ['sine', 2, 0.3], ['sine', 3, 0.08]]
    let tail: AudioNode = out
    if (timbre === 'bugle') { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; out.connect(f); tail = f }
    for (const [type, k, g] of parts) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq * k
      const og = c.createGain(); og.gain.value = g
      o.connect(og).connect(out); o.start(t0); o.stop(t0 + dur + 0.05)
    }
    tail.connect(roomChain(c))
    return dur
  }
  /** мелодия нотами одна за другой; возвращает общую длительность */
  function melody(notes: string[], timbre: 'box' | 'piano' | 'bugle' = 'box', gap = 0.42): number {
    notes.forEach((n, i) => tone(n, timbre, i * gap, timbre === 'box' ? 0.35 : 0.45))
    return notes.length * gap + 1
  }

  /** Одиночный эффект. Возвращает длительность, чтобы экран мог подождать. */
  /** Одиночный звук. far — сыграть «издалека»: глухо, с долгим эхом и тише (звуки из FAR_NAMES — всегда так);
      pan — откуда, −1 слева … 1 справа. Остальное идёт через «комнату» — короткое эхо по покрытию места */
  async function sfx(name: string, volume = 1, opts: boolean | { far?: boolean; pan?: number } = false): Promise<number> {
    const c = ensure(); if (!c) return 0
    const buf = await loadSfx(variant(name))
    if (!buf) return 0
    const o = typeof opts === 'boolean' ? { far: opts } : opts
    const src = c.createBufferSource()
    src.buffer = buf
    const g = c.createGain(); g.gain.value = volume
    const dest = o.far || FAR_NAMES.has(name) ? farChain(c) : roomChain(c)
    let tail: AudioNode = g
    if (typeof o.pan === 'number' && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); tail = g.connect(p) }
    src.connect(g); tail.connect(dest)
    src.start()
    return buf.duration
  }

  /** Звук в пространстве вокруг героя. az — откуда: 0 — впереди, ±π/2 — справа/слева, π — за спиной; up — выше (этаж над головой).
      dist — насколько далеко, в шагах. Звук вписан в место: прямой сигнал и эхо пространства (setSpace) смешиваются по
      расстоянию — рядом почти сухо и ярко, вдали почти одно эхо, глухое (воздух съедает верх), и приходит с запаздыванием.
      wall — звук за стеной или перекрытием: прямой глухой и тихий, слышен больше через эхо здания. move — источник смещается
      по ходу звука (шаги проходят мимо), в радианах. Направление — HRTF; высота тона каждый раз чуть другая (±7 %) */
  async function spatial(name: string, o: { az: number; dist?: number; up?: number; volume?: number; rate?: number; wall?: boolean; move?: number }): Promise<number> {
    const c = ensure(); if (!c) return 0
    const buf = await loadSfx(variant(name))
    if (!buf) return 0
    const d = FAR_NAMES.has(name) ? Math.max(o.dist ?? 3, 30) : o.dist ?? 3
    const src = c.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = o.rate ?? 0.93 + Math.random() * 0.14
    const dur = buf.duration / src.playbackRate.value
    const g = c.createGain(); g.gain.value = o.volume ?? 0.6
    const air = c.createBiquadFilter(); air.type = 'lowpass'; air.Q.value = 0.5
    air.frequency.value = o.wall ? 480 : Math.max(900, 18000 / (1 + d * 0.12))
    src.connect(g).connect(air)
    // прямой: запаздывает на путь звука, тише с расстоянием
    const delay = c.createDelay(0.5); delay.delayTime.value = Math.min(0.3, d / 343)
    const direct = c.createGain(); direct.gain.value = Math.min(1, Math.max(0.05, 3.5 / (d + 2.5))) * (o.wall ? 0.4 : 1)
    air.connect(delay)
    let tail: AudioNode = delay
    if (c.createPanner) {
      const p = c.createPanner()
      p.panningModel = 'HRTF'
      p.rolloffFactor = 0
      const r = Math.min(8, 1 + d * 0.3), y = o.up ?? 0
      const at = (az: number) => [Math.sin(az) * r, y, -Math.cos(az) * r] as const
      const [x0, y0, z0] = at(o.az)
      if (p.positionX) {
        p.positionX.value = x0; p.positionY.value = y0; p.positionZ.value = z0
        if (o.move) { const [x1, , z1] = at(o.az + o.move); const t1 = c.currentTime + dur; p.positionX.linearRampToValueAtTime(x1, t1); p.positionZ.linearRampToValueAtTime(z1, t1) }
      } else p.setPosition(x0, y0, z0)
      tail = delay.connect(p)
    }
    tail.connect(direct).connect(gains.sfx!)
    // эхо места: чем дальше и чем глуше (за стеной), тем больше звука приходит отражённым
    const send = c.createGain()
    send.gain.value = Math.min(0.95, 0.12 + d / 35) * (o.wall ? 1.4 : 1)
    air.connect(send).connect(spaceChain(c))
    src.start()
    return dur
  }

  /** общее эхо для spatial: вход → две свёртки (текущее пространство и прошлое, пока затухает) */
  function spaceChain(c: AudioContext) {
    if (space) return space.input
    const input = c.createGain()
    const mk = () => { const conv = c.createConvolver(); const g2 = c.createGain(); g2.gain.value = 0; input.connect(conv).connect(g2).connect(gains.sfx!); return { conv, g: g2 } }
    space = { input, a: mk(), b: mk(), front: 'a', kind: '' }
    return input
  }
  /** Эхо пространства: шумовой хвост с ранними отражениями; верх гаснет быстрее низа (как в настоящем зале) */
  function spaceImpulse(c: AudioContext, sp: { sec: number; decay: number; bright: number; early: number }) {
    const rate = c.sampleRate, len = Math.floor(rate * sp.sec)
    const buf = c.createBuffer(2, len, rate)
    for (let ch = 0; ch < 2; ch++) {
      const dd = buf.getChannelData(ch)
      let lp = 0
      for (let i = 0; i < len; i++) {
        const t = i / len
        const k = 0.04 + sp.bright * 0.9 * (1 - t) ** 1.5
        lp += k * ((Math.random() * 2 - 1) - lp)
        // нарастание 5 мс — хвост не щёлкает
        dd[i] = lp * Math.pow(1 - t, sp.decay) * Math.min(1, i / (rate * 0.005))
      }
      for (let r = 0; r < 7 && sp.early > 0; r++) {
        const at = Math.floor(rate * (0.006 + r * 0.009 + Math.random() * 0.006))
        if (at < len) dd[at] = (dd[at] ?? 0) + (Math.random() < 0.5 ? -1 : 1) * sp.early * 0.9 * (1 - r / 8)
      }
    }
    return buf
  }
  /** место сменилось: новое эхо проявляется за 1,5 с, старое гаснет (хвосты не обрываются). kind — из SPACES */
  function setSpace(kind: string) {
    const c = ensure(); if (!c) return
    spaceChain(c)
    const sp = SPACES[kind] ?? SPACES.wood!
    if (space!.kind === kind) return
    space!.kind = kind
    const next = space!.front === 'a' ? space!.b : space!.a, prev = space!.front === 'a' ? space!.a : space!.b
    next.conv.buffer = spaceImpulse(c, sp)
    const now = c.currentTime
    next.g.gain.cancelScheduledValues(now); next.g.gain.setTargetAtTime(sp.wet, now, 0.5)
    prev.g.gain.cancelScheduledValues(now); prev.g.gain.setTargetAtTime(0, now, 0.5)
    space!.front = space!.front === 'a' ? 'b' : 'a'
    // короткое эхо одиночных звуков (sfx) — того же характера
    roomChain(c)
    room!.conv.buffer = spaceImpulse(c, { ...sp, sec: Math.min(sp.sec, 1.8) })
  }

  function roomChain(c: AudioContext) {
    if (room) return room.input
    const input = c.createGain()
    const conv = c.createConvolver(); conv.buffer = impulse(c, 1.5, 3.2)
    const wet = c.createGain(); wet.gain.value = 0.1
    input.connect(gains.sfx!)
    input.connect(conv).connect(wet).connect(gains.sfx!)
    room = { input, wet, conv }
    return input
  }

  /** доля эха «комнаты»: 0.05 — улица, 0.16 — деревянная комната, 0.36 — кафельный зал, 0.5 — затопленный подвал */
  function setRoom(wet: number) {
    const c = ensure(); if (!c) return
    roomChain(c)
    room!.wet.gain.setTargetAtTime(wet, c.currentTime, 0.8)
  }

  /** Далёкий звук: низкие частоты и синтетическое эхо (шум с затуханием как импульс зала), сухого сигнала почти нет.
      Итог заметно тише прямого звука — горн за озером не перекрикивает ветер */
  function farChain(c: AudioContext) {
    if (farInput) return farInput
    const input = c.createGain(); input.gain.value = 0.5
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 0.4
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180
    const conv = c.createConvolver(); conv.buffer = impulse(c, 3.4, 2.4)
    const dry = c.createGain(); dry.gain.value = 0.35
    const wet = c.createGain(); wet.gain.value = 0.9
    input.connect(hp); hp.connect(lp)
    lp.connect(dry).connect(gains.sfx!)
    lp.connect(conv).connect(wet).connect(gains.sfx!)
    farInput = input
    return input
  }

  function impulse(c: AudioContext, seconds: number, decay: number) {
    const rate = c.sampleRate, len = Math.floor(rate * seconds)
    const buf = c.createBuffer(2, len, rate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
    return buf
  }

  /** Реплика: играет /voice/<id>.mp3, приглушая атмосферу и музыку. Возвращает true, если файл был. */
  /** Реплика: играет /voice/<id>.mp3, приглушая атмосферу и музыку. Предыдущая реплика при этом
      останавливается — голоса не накладываются, даже если ведущий жмёт «Дальше». */
  async function voice(id: string): Promise<{ played: boolean; duration: number; done: Promise<void> }> {
    const c = ensure()
    if (!c || !voiceOn.value) return { played: false, duration: 0, done: Promise.resolve() }
    if (!(await voiced()).has(id)) return { played: false, duration: 0, done: Promise.resolve() }
    const buf = await load(`/voice/${currentCase.value}/${id}.mp3`)
    if (!buf) return { played: false, duration: 0, done: Promise.resolve() }
    stopVoice()
    speaking.value = true
    applyDuck()
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(gains.voice!)
    src.start()
    voiceSrc = src
    const done = new Promise<void>(resolve => {
      src.onended = () => { if (voiceSrc === src) { voiceSrc = null; speaking.value = false; applyDuck() } resolve() }
    })
    return { played: true, duration: buf.duration, done }
  }

  /** Оборвать текущую реплику (пропуск, смена экрана). */
  function stopVoice() {
    const src = voiceSrc
    if (!src) return
    voiceSrc = null
    try { src.stop() } catch { /* уже закончилась */ }
    speaking.value = false
    applyDuck()
  }

  /** Пауза игры: замирает всё — голос, музыка, дождь. */
  async function setPaused(paused: boolean) {
    const c = ctx
    if (!c || !unlocked.value) return
    try { if (paused && c.state === 'running') await c.suspend(); else if (!paused && c.state === 'suspended') await c.resume() } catch { /* браузер не дал */ }
  }

  function stopAll() {
    for (const loop of loops.values()) loop.stop()
    loops.clear()
    music?.stop(MUSIC_FADE); music = null; musicWanted = null
  }

  return { unlocked, muted, voiceOn, speaking, unlock, setMuted, setVoiceOn, setPaused, setOutdoors, setRoom, setSpace, ambience, theme, stinger, tone, melody, sfx, spatial, voice, stopVoice, stopAll, preload: load }
}
