<script setup lang="ts">
/* Карта в духе городского навигатора, но ночью и в тумане. Местность района — вода, лес, улицы, дома — из истории,
   места — зданиями и площадками со значками, мелочи (фонари, лодки, деревья) — из props, где герой сейчас — пульсирующая
   метка, неизведанное — под туманом. Всё векторное, в координатах плана: проценты по ширине и высоте, ширина растянута
   на пропорции района. Здания — планом этажа: стены, комнаты, двери на проходах. */
import type { SoloAreaMap, SoloView } from '#shared/types'

type Place = SoloView['map']['places'][number]

const props = defineProps<{ map: SoloView['map']; area: string }>()
const emit = defineEmits<{ close: [] }>()
const uid = useId()
const tab = ref(props.area)
const areas = computed(() => props.map.areas.filter(a => props.map.places.some(p => p.area === a.id)))
const areaNow = computed(() => props.map.areas.find(a => a.id === tab.value))
const sheetNo = computed(() => props.map.areas.findIndex(a => a.id === tab.value) + 1)
const A = computed(() => areaNow.value?.aspect ?? 1.5)
const W = computed(() => 100 * A.value)
const geo = computed<SoloAreaMap>(() => areaNow.value?.map ?? {})
const places = computed(() => props.map.places.filter(p => p.area === tab.value))
/* на широком плане (дорога) высота меньше — подписи и метки крупнее, чтобы читались так же */
const K = computed(() => Math.max(1, A.value / 1.5))

const cx = (p: Place) => (p.x + p.w / 2) * A.value
const cy = (p: Place) => p.y + p.h / 2
/* улица под открытым небом — не здание: небольшая площадка в середине своего прямоугольника */
const pad = (p: Place) => {
  const w = p.w * A.value, h = p.h, s = Math.min(w, h) * 0.62
  return { x: cx(p) - s / 2 * 1.35, y: cy(p) - s / 2, w: s * 1.35, h: s }
}
/* ломаная «x,y x,y» из процентов в координаты плана */
const pts = (line: string) => line.trim().split(/\s+/).map(pt => { const [x, y] = pt.split(',').map(Number); return `${(x ?? 0) * A.value},${y ?? 0}` }).join(' ')
/* проходы между комнатами — только в зданиях, на улице их заменяют сами улицы; дверь — на середине прохода */
const showLinks = computed(() => !geo.value.roads?.length && !geo.value.paths?.length)
const links = computed(() => {
  const at = new Map(places.value.map(p => [p.id, p]))
  return props.map.links.flatMap(([a, b]) => {
    const pa = at.get(a), pb = at.get(b)
    if (!pa || !pb) return []
    const x1 = cx(pa), y1 = cy(pa), x2 = cx(pb), y2 = cy(pb)
    return [{ key: `${a}-${b}`, d: `M${x1},${y1} L${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2, angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI }]
  })
})
/* туман рассеивается вокруг мест, где герой был; у соседних — чуть-чуть, чтобы было видно, что там что-то есть */
const reveal = (p: Place) => Math.max(p.w * A.value, p.h) * (p.visited ? 0.95 : 0.45) + (p.visited ? 11 : 3)
/* длинное название — в две строки, по ближайшему к середине пробелу */
function nameLines(p: Place) {
  const t = p.visited ? p.name : '?'
  if (t.length <= 14) return [t]
  const mid = t.length / 2
  let best = -1
  for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i
  return best < 0 ? [t] : [t.slice(0, best), t.slice(best + 1)]
}
/* конёк крыши — вдоль длинной стороны дома */
const ridge = (x: number, y: number, w: number, h: number) => w >= h
  ? `M${x + 1},${y + h / 2} L${x + w - 1},${y + h / 2}`
  : `M${x + w / 2},${y + 1} L${x + w / 2},${y + h - 1}`

/* значки мест: штрих в сетке 24×24, цвет метки — по роду места */
const ICON: Record<string, string> = {
  road: 'M8 21l2-18M16 21l-2-18M12 5v2M12 11v2M12 17v2',
  barrier: 'M3 9h18v4H3zM8 9l-3 4M14 9l-3 4M20 9l-3 4M5 13v8M19 13v8',
  bridge: 'M3 17c3-5 6-7 9-7s6 2 9 7M3 12h18M7 12v6M17 12v6',
  monument: 'M12 3a2 2 0 110 4 2 2 0 010-4zM10 9h4l1 7H9zM7 21h10M8 16h8v5H8z',
  post: 'M3 6h18v12H3zM3 7l9 6 9-6',
  shop: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 016 0v2',
  culture: 'M6 4h12v6a6 6 0 01-12 0zM9 7.5h.01M15 7.5h.01M9.5 11a3 3 0 005 0',
  radio: 'M4 10h16v10H4zM8 10l8-6M8 15h.01M13 14h4M13 17h4',
  phone: 'M6.5 3.5h3l1.8 4.6-2.1 1.3a11 11 0 005.4 5.4l1.3-2.1 4.6 1.8v3a2 2 0 01-2 2A15.5 15.5 0 014.5 5.5a2 2 0 012-2z',
  food: 'M7 3v8a2 2 0 002 2v8M11 3v8M16 3c-2 2-2 6 0 8v10',
  yard: 'M6 8h12l-1 12H7zM4 8h16M10 5h4',
  anchor: 'M12 7a2 2 0 110-4 2 2 0 010 4zM12 7v13M8 11h8M5 14a7 7 0 0014 0',
  gate: 'M4 21V8l8-5 8 5v13M9 21v-7h6v7',
  door: 'M6 21V3h12v18M4 21h16M14 12h.01',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 002 2h13',
  stairs: 'M4 20h4v-4h4v-4h4V8h4',
  medical: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  office: 'M4 8h16v12H4zM9 8V5h6v3M4 13h16',
  bed: 'M3 18V7M3 13h18v5M21 18v-3M7 13v-2a2 2 0 012-2h3v4',
  water: 'M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z',
  tunnel: 'M4 20v-8a8 8 0 0116 0v8M9 20v-6a3 3 0 016 0v6',
  boat: 'M3 15h18l-3 5H6zM12 15V4l6 9',
  flag: 'M6 21V4M6 4h11l-2 4 2 4H6',
  lock: 'M6 11h12v9.5H6zM8.5 11V8a3.5 3.5 0 017 0v3'
}
const HUE: Record<string, string> = {
  post: '#4f7fa8', shop: '#a8834a', food: '#b0673f', culture: '#8a6aad', book: '#8a6aad', radio: '#5f8a9c', phone: '#b5463b',
  road: '#68707a', barrier: '#98693a', bridge: '#7d6b55', monument: '#848a92', yard: '#5b626a', anchor: '#3f889e', water: '#3f889e',
  boat: '#3f889e', gate: '#6f8a60', door: '#66707a', stairs: '#66707a', medical: '#b04e48', office: '#7d6b55', bed: '#56799a',
  tunnel: '#5b626a', flag: '#b5463b'
}
/* мелочи местности: тоже сетка 24×24; extra — вторая деталь другого цвета (флаг, полосы шлагбаума, табличка знака) */
const PROP: Record<string, { d: string; extra?: string }> = {
  tree: { d: 'M12 2l5 8h-3l4 6h-4l3 5H7l3-5H6l4-6H7zM12 21v2' },
  bush: { d: 'M5 17a3.5 3.5 0 015-3 4 4 0 018 0 3.5 3.5 0 015 3v2H5z' },
  lamp: { d: 'M12 22V8M9 8h6l-1-3h-4zM10 22h4' },
  bench: { d: 'M4 11h16M6 11v7M18 11v7M5 8h14v3H5z' },
  statue: { d: 'M8 22h8v-4H8zM12 5a2 2 0 110 4 2 2 0 010-4zM10 9h4l1 8H9zM15 4l2 14' },
  busstop: { d: 'M3 8h18v2H3zM6 10v11M18 10v11M6 16h12' },
  barrier: { d: 'M3 12h18M5 12v8M3 20h4', extra: 'M3 12h18' },
  boat: { d: 'M3 13h18l-3 6H6zM12 13V6l5 7' },
  pier: { d: 'M2 9h20v6H2zM6 9v6M10 9v6M14 9v6M18 9v6' },
  flagpole: { d: 'M8 22V2', extra: 'M8 3h9l-2 3 2 3H8z' },
  sign: { d: 'M12 22V9M12 9a4 4 0 110-8 4 4 0 010 8', extra: 'M9 5h6' },
  mast: { d: 'M12 22V2M7 7l5-3 5 3M8 13l4-2 4 2M9 19l3-2 3 2' },
  truck: { d: 'M2 16h13V8H2zM15 11h4l3 3v2h-7zM6 19a1.7 1.7 0 110-3.4M18 19a1.7 1.7 0 110-3.4' }
}

function onKey(e: KeyboardEvent) { if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); emit('close') } }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-veil" @click.self="emit('close')">
    <div class="solo-map" role="dialog" aria-modal="true" aria-label="Карта">
      <div class="solo-map__tabs">
        <button v-for="a in areas" :key="a.id" type="button" :class="{ on: tab === a.id }" @click="tab = a.id">{{ a.name }}</button>
        <button type="button" class="solo-map__close" aria-label="Закрыть" @click="emit('close')">×</button>
      </div>

      <div class="solo-map__frame">
        <svg class="solo-map__svg" :viewBox="`0 0 ${W} 100`" :style="{ aspectRatio: String(A) }" role="img" :aria-label="`Карта: ${areaNow?.name ?? ''}`">
          <defs>
            <pattern :id="`${uid}-trees`" width="5" height="5" patternUnits="userSpaceOnUse">
              <path class="m-tree" d="M1.3,0.3 l1,1.7 h-0.6 l0.9,1.5 H0 l0.9,-1.5 h-0.6 z" />
              <path class="m-tree" d="M3.9,2.6 l1,1.7 h-0.6 l0.9,1.5 H2.6 l0.9,-1.5 h-0.6 z" opacity="0.8" />
            </pattern>
            <pattern :id="`${uid}-ripples`" width="7" height="4" patternUnits="userSpaceOnUse">
              <path class="m-ripple" d="M0,1.2 q1.75,-1.3 3.5,0 t3.5,0" />
              <path class="m-ripple" d="M-1.75,3.2 q1.75,-1.3 3.5,0 t3.5,0 t3.5,0" opacity="0.6" />
            </pattern>
            <pattern :id="`${uid}-grass`" width="3" height="3" patternUnits="userSpaceOnUse">
              <circle cx="0.8" cy="0.8" r="0.22" class="m-grass-dot" /><circle cx="2.3" cy="2.2" r="0.22" class="m-grass-dot" />
            </pattern>
            <filter :id="`${uid}-soft`" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6" /></filter>
            <filter :id="`${uid}-fogtex`" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="11" />
              <feColorMatrix values="0 0 0 0 0.62  0 0 0 0 0.66  0 0 0 0 0.68  0 0 0 0.38 0" />
            </filter>
            <radialGradient :id="`${uid}-vignette`" cx="50%" cy="50%" r="72%">
              <stop offset="55%" stop-color="#000" stop-opacity="0" /><stop offset="100%" stop-color="#000" stop-opacity="0.5" />
            </radialGradient>
            <radialGradient :id="`${uid}-glow`"><stop offset="0%" stop-color="#e2b84f" stop-opacity="0.22" /><stop offset="100%" stop-color="#e2b84f" stop-opacity="0" /></radialGradient>
            <mask :id="`${uid}-fog`" maskUnits="userSpaceOnUse" x="0" y="0" :width="W" height="100">
              <rect :width="W" height="100" fill="#fff" />
              <g :filter="`url(#${uid}-soft)`">
                <circle v-for="p in places" :key="p.id" :cx="cx(p)" :cy="cy(p)" :r="reveal(p)" :fill="p.visited ? '#000' : '#6b6b6b'" />
              </g>
            </mask>
          </defs>

          <!-- земля и местность -->
          <rect class="m-land" :width="W" height="100" />
          <g :transform="`scale(${A},1)`">
            <template v-for="(d, i) in geo.grass" :key="`g${i}`">
              <path class="m-grass" :d="d" /><path :d="d" :fill="`url(#${uid}-grass)`" />
            </template>
            <template v-for="(d, i) in geo.forest" :key="`f${i}`">
              <path class="m-forest" :d="d" /><path :d="d" :fill="`url(#${uid}-trees)`" />
            </template>
            <template v-for="(d, i) in geo.water" :key="`w${i}`">
              <path class="m-shore" :d="d" /><path class="m-water" :d="d" /><path :d="d" :fill="`url(#${uid}-ripples)`" />
            </template>
          </g>

          <!-- планы этажей: стены и комнаты -->
          <g v-for="(f, i) in geo.floors" :key="`fl${i}`">
            <rect class="m-floor__shadow" :x="f.x * A + 0.9" :y="f.y + 1.1" :width="f.w * A" :height="f.h" rx="1.2" />
            <rect class="m-floor" :x="f.x * A" :y="f.y" :width="f.w * A" :height="f.h" rx="1.2" />
          </g>

          <polyline v-for="(l, i) in geo.paths" :key="`p${i}`" class="m-path" :points="pts(l)" />
          <g class="m-roads">
            <polyline v-for="(l, i) in geo.roads" :key="`rc${i}`" class="m-road-casing" :points="pts(l)" />
            <polyline v-for="(l, i) in geo.roads" :key="`r${i}`" class="m-road" :points="pts(l)" />
            <polyline v-for="(l, i) in geo.roads" :key="`rm${i}`" class="m-road-mid" :points="pts(l)" />
          </g>

          <!-- дома без входа: объём и конёк крыши -->
          <g v-for="(b, i) in geo.blocks" :key="`b${i}`" class="m-block">
            <rect class="m-block__shadow" :x="b[0] * A + 0.8" :y="b[1] + 1" :width="b[2] * A" :height="b[3]" rx="0.6" />
            <rect class="m-block__body" :x="b[0] * A" :y="b[1]" :width="b[2] * A" :height="b[3]" rx="0.6" />
            <path class="m-block__ridge" :d="ridge(b[0] * A, b[1], b[2] * A, b[3])" />
          </g>

          <!-- свет вокруг того места, где герой сейчас -->
          <template v-for="p in places" :key="`glow-${p.id}`">
            <circle v-if="p.here" :cx="cx(p)" :cy="cy(p)" :r="Math.max(p.w * A, p.h) * 0.9 + 6" :fill="`url(#${uid}-glow)`" />
          </template>

          <!-- места: здания и площадки -->
          <g v-for="p in places" :key="p.id" class="m-place" :class="[p.outdoor ? `m-place--${p.surface}` : 'm-place--building', { 'm-place--seen': p.visited, 'm-place--here': p.here, 'm-place--locked': p.locked }]">
            <template v-if="!p.outdoor">
              <rect class="m-place__shadow" :x="p.x * A + 0.8" :y="p.y + 1" :width="p.w * A" :height="p.h" rx="0.8" />
              <rect class="m-place__body" :x="p.x * A" :y="p.y" :width="p.w * A" :height="p.h" rx="0.8" />
              <path v-if="!geo.floors?.length" class="m-place__ridge" :d="ridge(p.x * A, p.y, p.w * A, p.h)" />
              <rect v-if="!geo.floors?.length" class="m-place__door" :x="cx(p) - 0.7" :y="p.y + p.h - 0.5" width="1.4" height="0.9" />
            </template>
            <rect v-else class="m-place__body" :x="pad(p).x" :y="pad(p).y" :width="pad(p).w" :height="pad(p).h" :rx="pad(p).h / 2" />
          </g>
          <text v-for="(f, i) in geo.floors" :key="`flt${i}`" class="m-floor-label" text-anchor="middle" :transform="`translate(${f.x * A + 1.9},${f.y + f.h / 2}) rotate(-90)`">{{ f.label }}</text>

          <!-- мелочи местности -->
          <g v-for="(pr, i) in geo.props" :key="`pr${i}`" class="m-prop" :class="`m-prop--${pr.kind}`" :transform="`translate(${pr.x * A},${pr.y}) rotate(${pr.rotate ?? 0}) scale(${(pr.size ?? 5) / 24})`">
            <circle v-if="pr.kind === 'lamp'" cx="0" cy="-5" r="9" class="m-prop__glow" />
            <g transform="translate(-12,-12)">
              <path :d="PROP[pr.kind]?.d ?? PROP.bush!.d" />
              <path v-if="PROP[pr.kind]?.extra" class="m-prop__extra" :d="PROP[pr.kind]!.extra" />
            </g>
          </g>

          <!-- проходы и двери в зданиях -->
          <template v-if="showLinks">
            <path v-for="l in links" :key="l.key" class="m-route" :d="l.d" />
            <rect v-for="l in links" :key="`door-${l.key}`" class="m-door" x="-1" y="-0.42" width="2" height="0.84" :transform="`translate(${l.mx},${l.my}) rotate(${l.angle})`" />
          </template>

          <!-- туман над неизведанным и виньетка -->
          <g :mask="`url(#${uid}-fog)`" class="m-fog">
            <rect :width="W" height="100" class="m-fog__base" />
            <rect :width="W" height="100" :filter="`url(#${uid}-fogtex)`" />
          </g>
          <rect :width="W" height="100" :fill="`url(#${uid}-vignette)`" pointer-events="none" />

          <g v-for="(l, i) in geo.labels" :key="`l${i}`" :transform="`translate(${l.x * A},${l.y}) rotate(${l.rotate ?? 0}) scale(${K})`">
            <text class="m-label" :class="`m-label--${l.kind ?? 'area'}`" text-anchor="middle">{{ l.text }}</text>
          </g>

          <!-- метки -->
          <g v-for="p in places" :key="`pin-${p.id}`" class="m-pin" :class="{ 'm-pin--unknown': !p.visited, 'm-pin--here': p.here }" :transform="`translate(${cx(p)},${cy(p)}) scale(${K})`">
            <circle v-if="p.here" class="m-pin__pulse" r="4.2" />
            <circle class="m-pin__dot" r="2.7" :fill="p.visited ? HUE[p.poi] ?? '#66707a' : '#3a4047'" />
            <path v-if="p.visited" class="m-pin__icon" :d="ICON[p.poi] ?? ICON.door" transform="translate(-1.55,-1.55) scale(0.13)" />
            <text v-else class="m-pin__q" text-anchor="middle" y="0.95">?</text>
            <g v-if="p.save && p.visited" transform="translate(2.3,-2.3)">
              <circle class="m-pin__badge" r="1.35" />
              <path class="m-pin__badge-icon" :d="ICON.phone" transform="translate(-0.8,-0.8) scale(0.067)" />
            </g>
            <g v-if="p.locked" transform="translate(2.3,-2.3)">
              <circle class="m-pin__lock" r="1.35" />
              <path class="m-pin__badge-icon" :d="ICON.lock" transform="translate(-0.8,-0.8) scale(0.067)" />
            </g>
            <text class="m-pin__label" text-anchor="middle" y="5.4">
              <tspan v-for="(t, i) in nameLines(p)" :key="i" x="0" :dy="i ? 2.5 : 0">{{ t }}</tspan>
            </text>
          </g>

          <!-- номер листа -->
          <text class="m-sheet" text-anchor="end" :transform="`translate(${W - 2.4},${100 - 2.6 * K}) scale(${K})`">лист {{ sheetNo }} · {{ areaNow?.name }}</text>
        </svg>
      </div>
      <p class="solo-map__legend">
        <span><i class="solo-map__key solo-map__key--here" />вы здесь</span>
        <span><i class="solo-map__key solo-map__key--save" />можно сохраниться</span>
        <span><i class="solo-map__key solo-map__key--lock" />заперто</span>
        <span>туман — где ещё не были</span>
        <span class="solo-keys">клавиша M</span>
      </p>
    </div>
  </div>
</template>
