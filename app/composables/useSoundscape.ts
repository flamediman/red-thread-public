/* Звуковой пейзаж одиночной истории: одиночные звуки вокруг героя поверх петель атмосферы.
   Пять независимых слоёв, у каждого свой таймер и свой разброс пауз, поэтому общий ритм не складывается в цикл:
   — даль: что-то в тумане, за озером, в другом конце здания (через «далеко»: глухо, с долгим эхом);
   — рядом: скрип, капля, стекло — по покрытию места;
   — сверху: шаги и возня этажом выше (только в зданиях);
   — за спиной: шаги, дыхание, шёпот — только в темноте и редко, чтобы каждый раз был как в первый;
   — небо: гром, когда идёт дождь (редко и далеко), в грозу — чаще и ближе, с молнией перед ним: вспышка, потом
     через 1–4 с раскат (чем дальше, тем позже и глуше).
   — рядом с тобой кто-то есть (улица, чаще в лесу): сбоку или сзади хрустнет ветка — лес перед этим затихает, —
     или пройдут несколько осторожных шагов; иногда, когда герой переходит на новое место, кто-то в десятке метров
     позади делает шаги вместе с ним (stepped). Без фанатизма: раз в минуту-две в лесу, реже на открытом.
   Паузы случайны, слой иногда пропускает свою очередь, у каждого звука своя минимальная пауза до повтора (редкие — минуты),
   один и тот же звук не идёт дважды подряд, высота тона и сторона всякий раз новые. Некоторым звукам иногда «отвечают»:
   собака воет — через пару секунд с другой стороны отзывается вторая. */

export interface SoundPlace {
  area: string
  outdoor: boolean
  surface: string
  dark: boolean
  lit: boolean
  other: boolean
  /** погода по ходу сюжета */
  weather: 'fog' | 'drizzle' | 'rain' | 'storm'
  /** подвал, тоннель: неба не слышно */
  deep: boolean
  /** лес вокруг (дорога, лагерь, лесная дорога к санаторию): там за героем «наблюдают» чаще */
  forest: boolean
  ambience: string[]
}

interface Cue {
  name: string
  /** секунд до повтора этого же звука (по умолчанию 30) */
  gap?: number
  /** вес при выборе (по умолчанию 1) */
  w?: number
  /** громкость поверх громкости слоя */
  vol?: number
  /** вероятность, что через 2–6 с отзовётся такой же звук с другой стороны */
  answer?: number
  /** перед звуком атмосфера затихает (ветка под чьей-то ногой) */
  hush?: boolean
  /** источник смещается по ходу звука (перекрывает move слоя) */
  move?: number
}

interface Layer {
  id: string
  /** пауза между попытками, секунд: от и до (может зависеть от места и погоды) */
  every: [number, number] | ((p: SoundPlace | null) => [number, number])
  /** доля попыток, когда слой молчит */
  skip: number
  when?: (p: SoundPlace) => boolean
  pool: (p: SoundPlace) => Cue[]
  /** расстояние, м: на открытом месте дальнее и «рядом» — дальше, чем в комнате */
  dist: [number, number] | ((p: SoundPlace) => [number, number])
  volume: number
  /** откуда: вокруг, за спиной, сзади и с боков (flank) или сверху */
  from?: 'around' | 'behind' | 'flank' | 'above'
  /** за стеной или перекрытием: глухо, через эхо здания */
  wall?: (p: SoundPlace) => boolean
  /** источник смещается по ходу звука (шаги проходят мимо), в радианах; знак — случайный */
  move?: number
}

const RARE = 300
const c = (name: string, gap?: number, extra: Partial<Cue> = {}): Cue => ({ name, gap, ...extra })

/** даль по району; изнанка санатория — своя */
const FAR: Record<string, Cue[]> = {
  road: [c('whisper-far', 90), c('branch-far', 40, { w: 2 }), c('bugle-far-cut', 120), c('dog-howl-far', 150, { answer: 0.4 }), c('crow-far', 60, { answer: 0.3 }),
    c('metal-sheet-far', 90), c('radio-voice-far', RARE), c('phone-ring-far', RARE)],
  town: [c('bugle-far-cut', 120), c('whisper-far', 90), c('oarlocks', 90), c('announce-far', 150), c('dog-howl-far', 150, { answer: 0.4 }), c('door-slam-far', 50, { w: 2 }),
    c('metal-sheet-far', 90), c('swing-creak', 120), c('crow-far', 60, { answer: 0.3 }), c('phone-ring-far', RARE), c('child-laugh-far', RARE), c('radio-voice-far', RARE),
    c('glass-break-far', 240)],
  sana: [c('lantern-chain', 60), c('whisper-far', 90), c('door-slam-far', 50, { w: 2 }), c('door-locked', 90), c('music-box-far', RARE), c('phone-ring-far', RARE),
    c('child-laugh-far', RARE), c('furniture-drag', 150), c('glass-break-far', 240)],
  camp: [c('bugle-far-cut', 120), c('announce-far', 150), c('whisper-far', 90), c('branch-far', 40, { w: 2 }), c('lantern-chain', 60), c('swing-creak', 120),
    c('crow-far', 60, { answer: 0.3 }), c('dog-howl-far', 150, { answer: 0.4 }), c('child-laugh-far', RARE), c('music-box-far', RARE), c('radio-voice-far', RARE),
    c('glass-break-far', 300)],
  intake: [c('industrial-clank', 45, { w: 2 }), c('metal-groan', 50), c('chain-drag', 90), c('drip-metal', 30), c('door-slam-far', 60), c('metal-sheet-far', 90),
    c('radio-voice-far', RARE), c('glass-break-far', 300)],
  other: [c('industrial-clank', 40, { w: 2 }), c('chain-drag', 80), c('metal-groan', 50), c('metal-scream', 200), c('siren-rise', 600), c('whisper-far', 90),
    c('music-box-far', RARE)]
}

/** рядом — по тому, где стоим */
const NEAR: Record<string, Cue[]> = {
  wood: [c('creak-floor', 25, { w: 2 }), c('wind-window', 40), c('drip-one', 30), c('wall-scratch', 240, { vol: 0.7 })],
  tile: [c('drip-one', 20, { w: 2 }), c('glass-tinkle', 60), c('pipe-knock', 45), c('drip-metal', 35), c('wind-window', 60)],
  water: [c('water-surge', 30, { w: 2 }), c('drip-one', 20), c('drip-metal', 30), c('creak-floor', 50)],
  machine: [c('pipe-knock', 30, { w: 2 }), c('drip-metal', 25), c('metal-groan', 60), c('water-surge', 50)],
  other: [c('metal-groan', 35, { w: 2 }), c('drip-metal', 25), c('pipe-knock', 40), c('industrial-clank', 90)],
  // (листья по асфальту убраны: генератор делает их шипением на 7–13 кГц — «шуршание», а не листва)
  open: [c('gust', 20, { w: 2 }), c('branch-far', 60)]
}
/** кто-то рядом: в лесу — ветка под ногой (лес перед ней затихает) и осторожные шаги; на открытом — шаги по тому же,
    по чему идёт герой */
const WATCH = (p: SoundPlace): Cue[] => p.forest
  ? [c('twig-snap', 45, { w: 2, hush: true }), c('footsteps-forest', 150, { move: 0.35 })]
  : [c(`step-${p.surface}`, 150, { move: 0.3, vol: 0.8 })]
const ABOVE: Cue[] = [c('footsteps-above', 150, { w: 2 }), c('furniture-drag', 200), c('knock-three', 300), c('door-slam-far', 90)]
const BEHIND: Cue[] = [c('footsteps-behind', 180, { w: 2 }), c('breath-behind-2', 300), c('whisper-near', 200), c('wall-scratch', 240), c('knock-three', 300)]
const SKY: Cue[] = [c('thunder-far', 15)]

function nearKind(p: SoundPlace) {
  if (p.other || p.ambience.includes('other-hum')) return 'other'
  if (p.area === 'intake' && !p.outdoor) return 'machine'
  if (p.ambience.includes('water-lap') || p.surface === 'water') return 'water'
  if (p.outdoor) return 'open'
  return p.surface === 'tile' ? 'tile' : 'wood'
}

const LAYERS: Layer[] = [
  // даль: в помещении — за стенами (глухо, через эхо здания), на улице — через туман
  // на открытом месте (площадь, дорога) дальнее — действительно далеко: 12 м через туман звучали почти рядом
  { id: 'far', every: [18, 60], skip: 0.2, pool: p => FAR[p.other ? 'other' : p.area] ?? FAR.town!, dist: p => (p.outdoor ? [30, 90] : [12, 60]), volume: 0.6, wall: p => !p.outdoor },
  { id: 'near', every: [8, 26], skip: 0.15, pool: p => NEAR[nearKind(p)]!, dist: p => (p.outdoor ? [8, 20] : [2, 6]), volume: 0.45 },
  // кто-то рядом: на улице, в лесу — раз в минуту-полторы, на открытом — раз в несколько минут
  { id: 'watch', every: p => (p?.forest ? [40, 100] : [110, 240]), skip: 0.3, when: p => p.outdoor && !p.other && !p.deep, pool: WATCH, dist: [10, 22], volume: 0.45, from: 'flank' },
  { id: 'above', every: [45, 140], skip: 0.3, when: p => !p.outdoor && p.area !== 'road', pool: () => ABOVE, dist: [4, 9], volume: 0.5, from: 'above', wall: () => true },
  // за спиной — только в темноте; с включённым фонарём реже (свет чуть успокаивает), без света — чаще
  { id: 'behind', every: [90, 240], skip: 0.35, when: p => p.dark && !p.outdoor, pool: () => BEHIND, dist: [1.2, 3], volume: 0.32, from: 'behind', move: 0.5 },
  { id: 'sky', every: p => (p?.weather === 'storm' ? [22, 60] : [90, 200]), skip: 0.1, when: p => (p.weather === 'rain' || p.weather === 'storm') && !p.deep, pool: () => SKY, dist: [40, 80], volume: 0.85 }
]

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

export function useSoundscape(opts: { place: () => SoundPlace | null; active: () => boolean; lightning?: (strength: number) => void }) {
  const audio = useAudio()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const lastAt = new Map<string, number>()
  const lastInLayer = new Map<string, string>()
  let alive = true
  /** когда последний раз «кто-то был рядом» (слой watch или шаги-попутчики) — не подряд */
  let lastPresence = 0

  function pick(layer: Layer, p: SoundPlace): Cue | null {
    const now = Date.now() / 1000
    const rested = layer.pool(p).filter(q => now - (lastAt.get(q.name) ?? -1e9) >= (q.gap ?? 30))
    // подряд один и тот же — только если больше нечего (у неба один звук, записи грома чередует useAudio)
    const fresh = rested.filter(q => q.name !== lastInLayer.get(layer.id))
    const pool = fresh.length ? fresh : rested
    if (!pool.length) return null
    let r = Math.random() * pool.reduce((s, q) => s + (q.w ?? 1), 0)
    for (const q of pool) { r -= q.w ?? 1; if (r <= 0) return q }
    return pool[pool.length - 1]!
  }

  function play(layer: Layer, q: Cue, az: number, dist: number, p?: SoundPlace | null) {
    const up = layer.from === 'above' ? 1.2 : 0
    const m = q.move ?? layer.move
    const move = m ? m * (Math.random() < 0.5 ? -1 : 1) : 0
    void audio.spatial(q.name, { az, dist, up, volume: layer.volume * (q.vol ?? 1), wall: !!(p && layer.wall?.(p)), move })
  }
  /** направление без повторов: один и тот же звук не приходит оттуда же, откуда в прошлый раз (минимум 70° в сторону);
      стороны чаще, чем прямо впереди, — на колонках спереди и сзади звучит одинаково */
  const lastAz = new Map<string, number>()
  function pickAz(name: string) {
    let az = 0
    for (let k = 0; k < 8; k++) {
      const side = Math.random() < 0.5 ? -1 : 1
      az = side * (Math.PI * (0.18 + 0.64 * Math.random()))
      const prev = lastAz.get(name)
      if (prev === undefined || Math.abs(Math.atan2(Math.sin(az - prev), Math.cos(az - prev))) > 1.2) break
    }
    lastAz.set(name, az)
    return az
  }

  function tick(layer: Layer) {
    const p = opts.place()
    // «кто-то рядом» не звучит сразу после шагов-попутчиков
    const recent = layer.id === 'watch' && Date.now() / 1000 - lastPresence < 25
    if (p && !recent && opts.active() && !audio.speaking.value && (!layer.when || layer.when(p)) && Math.random() >= layer.skip) {
      // в темноте с фонарём «за спиной» звучит вдвое реже
      const calm = layer.id === 'behind' && p.lit && Math.random() < 0.5
      const q = calm ? null : pick(layer, p)
      if (q) {
        lastAt.set(q.name, Date.now() / 1000)
        lastInLayer.set(layer.id, q.name)
        const az = layer.from === 'behind' ? Math.PI + rnd(-0.6, 0.6) : layer.from === 'flank' ? Math.PI + rnd(-1.3, 1.3)
          : layer.from === 'above' ? rnd(-1.2, 1.2) : pickAz(q.name)
        const dist = rnd(...(typeof layer.dist === 'function' ? layer.dist(p) : layer.dist))
        if (layer.id === 'watch') lastPresence = Date.now() / 1000
        if (layer.id === 'sky' && p.weather === 'storm') {
          // гроза: сначала молния, раскат — следом, тем позже, чем дальше; близкий удар громче и звонче
          const near = Math.random() < 0.3
          const d = near ? rnd(8, 20) : rnd(25, 70)
          opts.lightning?.(near ? 1 : rnd(0.35, 0.7))
          setTimeout(() => { if (alive) void audio.spatial(q.name, { az, dist: d, volume: layer.volume * (near ? 1.25 : 0.9) }) }, (d / 20) * 1000 + rnd(200, 600))
        } else if (q.hush) {
          // лес затихает — и в тишине хрустит ветка
          audio.hush(2.5)
          setTimeout(() => { if (alive && opts.active()) play(layer, q, az, dist, opts.place()) }, rnd(1300, 1900))
        } else play(layer, q, az, dist, p)
        if (q.answer && Math.random() < q.answer) {
          const az2 = az + Math.PI * rnd(0.6, 1.4)
          setTimeout(() => { if (alive && opts.active()) play(layer, q, az2, dist * rnd(0.6, 1.1), opts.place()) }, rnd(2000, 6000))
        }
      }
    }
    schedule(layer)
  }

  function schedule(layer: Layer, first = false) {
    if (!alive) return
    const [a, b] = typeof layer.every === 'function' ? layer.every(opts.place()) : layer.every
    // первый раз — где-то внутри интервала, чтобы слои не стартовали хором
    const sec = first ? rnd(a * 0.3, b) : rnd(a, b)
    timers.set(layer.id, setTimeout(() => tick(layer), sec * 1000))
  }

  /* Герой перешёл на новое место (его шаги уже звучат): иногда кто-то в десятке метров позади делает шаги вместе с ним —
     чуть позже, чуть тяжелее. На улице; в лесу чаще. Не чаще раза в полторы минуты и не сразу после другого «кто-то рядом» */
  function stepped(surface: string) {
    const p = opts.place()
    if (!p || !p.outdoor || p.other || !opts.active()) return
    const now = Date.now() / 1000
    if (now - lastPresence < 90 || Math.random() > (p.forest ? 0.25 : 0.1)) return
    lastPresence = now
    setTimeout(() => {
      if (alive && opts.active()) void audio.spatial(`step-${surface}`, { az: Math.PI + rnd(-0.5, 0.5), dist: rnd(12, 18), volume: 0.4, rate: rnd(0.88, 0.96) })
    }, rnd(450, 800))
  }

  onMounted(() => { for (const l of LAYERS) schedule(l, true) })
  onBeforeUnmount(() => { alive = false; for (const t of timers.values()) clearTimeout(t); timers.clear() })
  return { stepped }
}
