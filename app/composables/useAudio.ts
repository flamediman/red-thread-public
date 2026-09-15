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
let ambRoom: GainNode | null = null
const buffers = new Map<string, Promise<AudioBuffer | null>>()
const unlocked = ref(false)
const muted = ref(false)
const speaking = ref(false)

/** samples — длина буфера: по ней узнаём тот же трек под другим адресом */
interface Loop { name: string; stop: (fade?: number) => void; gain: GainNode; world?: string; samples: number }
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
  'final-failed': ['verdict-wrong', 'accuse', 'night-early', 'lobby']
}

async function load(url: string): Promise<AudioBuffer | null> {
  const c = ensure()
  if (!c) return null
  if (!buffers.has(url)) {
    buffers.set(url, fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(ab => c.decodeAudioData(ab))
      .catch(() => null))
  }
  return buffers.get(url)!
}

/** Гладкая петля: буфер запускается снова за XFADE секунд до конца, оба края — по равномощным кривым. */
function startLoop(name: string, buffer: AudioBuffer, target: number, dest: GainNode, fadeSec = 2.5): Loop {
  const c = ensure()!
  const gain = c.createGain()
  gain.gain.value = 0
  gain.connect(dest)
  let alive = true
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
    name, gain, samples: buffer.length,
    stop: (fade = 2.5) => {
      alive = false
      const t = c.currentTime
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(0, t + fade)
      setTimeout(() => { for (const s of sources) { try { s.stop() } catch { /* уже остановлен */ } } gain.disconnect() }, fade * 1000 + 200)
    }
  }
}

/** звук мира: /sfx/<мир>/<роль>.m4a, если такого нет — общий /sfx/<роль>.m4a */
async function loadSfx(name: string): Promise<AudioBuffer | null> {
  if (name.includes('.')) return load(`/sfx/${name}`)
  return (await load(`/sfx/${currentSetting.value}/${name}.m4a`)) ?? load(`/sfx/${name}.m4a`)
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
    for (const [name, loop] of loops) if (!names.includes(name)) { loop.stop(); loops.delete(name) }
    for (const name of names) {
      const target = levels[name] ?? 1
      const existing = loops.get(name)
      if (existing && existing.world !== currentSetting.value) { existing.stop(); loops.delete(name) }
      else if (existing) { existing.gain.gain.linearRampToValueAtTime(target, c.currentTime + 2); continue }
      const buf = await loadSfx(name)
      if (!buf || loops.has(name) || !names.includes(name)) continue
      loops.set(name, { ...startLoop(name, buf, target, gains.ambience!), world: currentSetting.value })
    }
  }

  /** Музыка: одна тема; смена — перекрёстным затуханием. null — тишина.
      Имя темы ищется в папке активного дела; путь с «/» — файл как есть (музыка меню мира). */
  async function theme(name: string | null, level = 1) {
    const c = ensure(); if (!c) return
    const wanted = name ? (name.startsWith('/') ? name : `/music/${currentCase.value}/${name}.mp3`) : null
    musicWanted = wanted
    musicLevel = level
    if (!wanted || !name) { music?.stop(MUSIC_FADE); music = null; return }
    // у дела может не быть всех тем: берём ближайшую по настроению из тех, что есть
    // у нового дела музыки может не быть совсем — тогда тема мира из меню, лишь бы не тишина
    const chain = name.startsWith('/') ? [wanted] : [...[name, ...(THEME_FALLBACK[name] ?? [])].map(n => `/music/${currentCase.value}/${n}.mp3`), `/music/settings/${currentSetting.value}.mp3`]
    for (const key of chain) {
      if (music?.name === key) { music.gain.gain.linearRampToValueAtTime(level, c.currentTime + 2); return }
      const buf = await load(key)
      if (musicWanted !== wanted) return
      if (!buf) continue
      if (music?.name === key) return
      // тот же трек под другим адресом (тема мира в меню = заставка истории) — играет дальше, без перезапуска
      if (music && music.samples === buf.length) { music.name = key; music.gain.gain.linearRampToValueAtTime(musicLevel, c.currentTime + 2); return }
      music?.stop(MUSIC_FADE)
      music = startLoop(key, buf, musicLevel, gains.music!, MUSIC_FADE)
      return
    }
  }

  /** Одиночный эффект. Возвращает длительность, чтобы экран мог подождать. */
  async function sfx(name: string, volume = 1): Promise<number> {
    const c = ensure(); if (!c) return 0
    const buf = await loadSfx(name)
    if (!buf) return 0
    const src = c.createBufferSource()
    src.buffer = buf
    const g = c.createGain(); g.gain.value = volume
    src.connect(g).connect(gains.sfx!)
    src.start()
    return buf.duration
  }

  /** Реплика: играет /voice/<id>.mp3, приглушая атмосферу и музыку. Возвращает true, если файл был. */
  /** Реплика: играет /voice/<id>.mp3, приглушая атмосферу и музыку. Предыдущая реплика при этом
      останавливается — голоса не накладываются, даже если ведущий жмёт «Дальше». */
  async function voice(id: string): Promise<{ played: boolean; duration: number; done: Promise<void> }> {
    const c = ensure()
    if (!c) return { played: false, duration: 0, done: Promise.resolve() }
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

  return { unlocked, muted, speaking, unlock, setMuted, setPaused, setOutdoors, ambience, theme, sfx, voice, stopVoice, stopAll, preload: load }
}
