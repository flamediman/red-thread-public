<script setup lang="ts">
/* Карта — бумажная схема района, как туристическая карта, на которой герой делает пометки. Весь лист виден сразу:
   улицы, вода, лес, дома; комнаты одного здания — внутри общего контура, двери — в общих стенах. Где был — комната
   белая, где не был — серая; где герой сейчас — красный круг маркером; запертая дверь — красный крест; телефон —
   можно сохраниться. Всё векторное, в процентах плана; ширина растянута на пропорции района. */
import type { SoloAreaMap, SoloView } from '#shared/types'

type Place = SoloView['map']['places'][number]

const props = defineProps<{ map: SoloView['map']; area: string; story?: string }>()
const emit = defineEmits<{ close: [] }>()
const uid = useId()
const paperOk = ref(true)
const tab = ref(props.area)
/* листы — только тех районов, где герой уже был: карту лагеря не получить, не дойдя до лагеря */
const areas = computed(() => props.map.areas.filter(a => props.map.places.some(p => p.area === a.id && p.visited)))
const areaNow = computed(() => props.map.areas.find(a => a.id === tab.value))
const sheetNo = computed(() => props.map.areas.findIndex(a => a.id === tab.value) + 1)
const A = computed(() => areaNow.value?.aspect ?? 1.5)
const W = computed(() => 100 * A.value)
const geo = computed<SoloAreaMap>(() => areaNow.value?.map ?? {})
const places = computed(() => props.map.places.filter(p => p.area === tab.value))
/* на широком листе (дорога) высота меньше — подписи крупнее, чтобы читались так же */
const K = computed(() => Math.max(1, A.value / 1.5))

/* прямоугольник места в координатах листа */
const box = (p: Place) => ({ x: p.x * A.value, y: p.y, w: p.w * A.value, h: p.h })
const cx = (p: Place) => p.x * A.value + p.w * A.value / 2
const cy = (p: Place) => p.y + p.h / 2
const pts = (line: string) => line.trim().split(/\s+/).map(pt => { const [x, y] = pt.split(',').map(Number); return `${(x ?? 0) * A.value},${y ?? 0}` }).join(' ')

/* здания: явная группа building, иначе этаж-подложка, в котором стоит комната, иначе комната сама себе здание */
interface Building { id: string; rooms: Place[]; x: number; y: number; w: number; h: number; label?: string }
const buildings = computed<Building[]>(() => {
  const floors = geo.value.floors ?? []
  const groups = new Map<string, Building>()
  for (const p of places.value) {
    if (p.outdoor) continue
    const b = box(p)
    const fl = floors.find(f => p.x + p.w / 2 >= f.x && p.x + p.w / 2 <= f.x + f.w && cy(p) >= f.y && cy(p) <= f.y + f.h)
    const id = p.building ?? (fl ? `floor:${fl.label}` : p.id)
    const g = groups.get(id)
    if (g) { g.rooms.push(p); g.x = Math.min(g.x, b.x); g.y = Math.min(g.y, b.y); g.w = Math.max(g.x + g.w, b.x + b.w) - g.x; g.h = Math.max(g.y + g.h, b.y + b.h) - g.y }
    else groups.set(id, fl ? { id, rooms: [p], x: fl.x * A.value, y: fl.y, w: fl.w * A.value, h: fl.h, label: fl.label } : { id, rooms: [p], ...b })
  }
  // пересчёт объединённых контуров: общий прямоугольник комнат с полем
  for (const g of groups.values()) {
    if (g.label) continue
    const xs = g.rooms.map(r => box(r))
    const x0 = Math.min(...xs.map(b => b.x)), y0 = Math.min(...xs.map(b => b.y)), x1 = Math.max(...xs.map(b => b.x + b.w)), y1 = Math.max(...xs.map(b => b.y + b.h))
    const pad = g.rooms.length > 1 ? 0.9 : 0
    g.x = x0 - pad; g.y = y0 - pad; g.w = x1 - x0 + pad * 2; g.h = y1 - y0 + pad * 2
  }
  return [...groups.values()]
})
const groupOf = computed(() => { const m = new Map<string, string>(); for (const g of buildings.value) for (const r of g.rooms) m.set(r.id, g.id); return m })

/* двери: в общей стене двух смежных комнат одного здания — проём; всё остальное известное — пунктирная тропка между центрами,
   но только если хотя бы одно из мест внутри здания (на улице дорогу показывают сами улицы) */
const EPS = 1.6
interface Door { key: string; x: number; y: number; vertical: boolean; locked: boolean }
interface Route { key: string; d: string; locked: boolean }
const lockedPair = (a: Place, b: Place) => (a.locked && !a.visited) || (b.locked && !b.visited)
const doors = computed<Door[]>(() => {
  const at = new Map(places.value.map(p => [p.id, p]))
  const out: Door[] = []
  for (const [ia, ib] of props.map.links) {
    const a = at.get(ia), b = at.get(ib)
    if (!a || !b || a.outdoor || b.outdoor || groupOf.value.get(a.id) !== groupOf.value.get(b.id)) continue
    const ra = box(a), rb = box(b)
    const ox0 = Math.max(ra.x, rb.x), ox1 = Math.min(ra.x + ra.w, rb.x + rb.w)
    const oy0 = Math.max(ra.y, rb.y), oy1 = Math.min(ra.y + ra.h, rb.y + rb.h)
    // смежны по вертикальной стене
    if (Math.abs(ra.x + ra.w - rb.x) < EPS && oy1 - oy0 > 3) out.push({ key: `${ia}-${ib}`, x: (ra.x + ra.w + rb.x) / 2, y: (oy0 + oy1) / 2, vertical: true, locked: lockedPair(a, b) })
    else if (Math.abs(rb.x + rb.w - ra.x) < EPS && oy1 - oy0 > 3) out.push({ key: `${ia}-${ib}`, x: (rb.x + rb.w + ra.x) / 2, y: (oy0 + oy1) / 2, vertical: true, locked: lockedPair(a, b) })
    // смежны по горизонтальной стене
    else if (Math.abs(ra.y + ra.h - rb.y) < EPS && ox1 - ox0 > 3) out.push({ key: `${ia}-${ib}`, x: (ox0 + ox1) / 2, y: (ra.y + ra.h + rb.y) / 2, vertical: false, locked: lockedPair(a, b) })
    else if (Math.abs(rb.y + rb.h - ra.y) < EPS && ox1 - ox0 > 3) out.push({ key: `${ia}-${ib}`, x: (ox0 + ox1) / 2, y: (rb.y + rb.h + ra.y) / 2, vertical: false, locked: lockedPair(a, b) })
  }
  return out
})
const doorKeys = computed(() => new Set(doors.value.map(d => d.key)))
/* остальные известные проходы — проём на той стене комнаты, что смотрит на соседнее место (вход с улицы, лестница
   на другой этаж, дверь в дальнюю комнату); линий по плану не рисуем — они режут комнаты */
function wallPoint(r: Place, tx: number, ty: number): Door {
  const b = box(r)
  const x0 = cx(r), y0 = cy(r)
  const dx = tx - x0, dy = ty - y0
  const hw = b.w / 2, hh = b.h / 2
  const kx = dx ? hw / Math.abs(dx) : Infinity, ky = dy ? hh / Math.abs(dy) : Infinity
  const k = Math.min(kx, ky)
  const vertical = kx <= ky
  return { key: '', x: x0 + dx * k, y: y0 + dy * k, vertical, locked: false }
}
const wallDoors = computed<Door[]>(() => {
  const at = new Map(places.value.map(p => [p.id, p]))
  const out: Door[] = []
  for (const [ia, ib] of props.map.links) {
    const a = at.get(ia), b = at.get(ib)
    if (!a || !b || doorKeys.value.has(`${ia}-${ib}`)) continue
    const locked = lockedPair(a, b)
    if (!a.outdoor) out.push({ ...wallPoint(a, cx(b), cy(b)), key: `${ia}-${ib}:a`, locked: locked && a.locked && !a.visited })
    if (!b.outdoor) out.push({ ...wallPoint(b, cx(a), cy(a)), key: `${ia}-${ib}:b`, locked: locked && b.locked && !b.visited })
  }
  return out
})
const allDoors = computed(() => [...doors.value, ...wallDoors.value])
/* запертые места без найденной двери: крест в углу */
const lockMarks = computed(() => places.value.filter(p => p.locked && !p.visited && !allDoors.value.some(d => d.locked && d.key.includes(p.id))))

/* длинное название — в две строки, по ближайшему к середине пробелу */
function nameLines(p: Place) {
  const t = p.name
  if (t.length <= 13) return [t]
  const mid = t.length / 2
  let best = -1
  for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i
  return best < 0 ? [t] : [t.slice(0, best), t.slice(best + 1)]
}
/* подпись умещается в комнату — внутри; иначе под ней */
const labelInside = (p: Place) => p.h >= 7 && p.w * A.value >= 9
/* маркерный круг «вы здесь» — чуть неровный, как от руки */
const marker = (p: Place) => {
  const r = Math.min(Math.max(p.w * A.value, p.h) * 0.42 + 1.5, 9) * (labelInside(p) ? 1 : 0.8)
  const x = cx(p), y = cy(p)
  return `M${x - r},${y} C${x - r * 1.02},${y - r * 0.62} ${x - r * 0.55},${y - r * 1.06} ${x + 0.2},${y - r} C${x + r * 0.6},${y - r * 0.98} ${x + r * 1.04},${y - r * 0.5} ${x + r * 0.98},${y + 0.3} C${x + r * 0.94},${y + r * 0.7} ${x + r * 0.45},${y + r * 1.02} ${x - 0.3},${y + r * 0.96} C${x - r * 0.7},${y + r * 0.9} ${x - r * 1.06},${y + r * 0.45} ${x - r * 1.02},${y - 0.4}`
}

/* значки-пометки: телефон (сохранение), крест (заперто) — в сетке 24×24 */
const PHONE = 'M6.5 3.5h3l1.8 4.6-2.1 1.3a11 11 0 005.4 5.4l1.3-2.1 4.6 1.8v3a2 2 0 01-2 2A15.5 15.5 0 014.5 5.5a2 2 0 012-2z'
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
            <filter :id="`${uid}-paper`" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
              <feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.27  0 0 0 0 0.22  0 0 0 0.12 0" />
            </filter>
            <pattern :id="`${uid}-hatch`" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)">
              <path d="M0,1.1 H2.2" class="m-hatch" />
            </pattern>
            <pattern :id="`${uid}-stipple`" width="3.2" height="3.2" patternUnits="userSpaceOnUse">
              <circle class="m-stipple" cx="0.6" cy="0.8" r="0.2" /><circle class="m-stipple" cx="2.2" cy="0.4" r="0.16" />
              <circle class="m-stipple" cx="1.5" cy="2.1" r="0.22" /><circle class="m-stipple" cx="2.9" cy="2.8" r="0.15" />
            </pattern>
            <pattern :id="`${uid}-solid`" width="1.3" height="1.3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0,0.65 H1.3" class="m-solid-hatch" />
            </pattern>
            <radialGradient :id="`${uid}-age`" cx="50%" cy="50%" r="75%">
              <stop offset="55%" stop-color="#3a3126" stop-opacity="0" /><stop offset="100%" stop-color="#3a3126" stop-opacity="0.34" />
            </radialGradient>
          </defs>

          <!-- бумага -->
          <rect class="m-paper" :width="W" height="100" />
          <rect :width="W" height="100" :filter="`url(#${uid}-paper)`" />
          <!-- местность: вода штрихом, лес заливкой с крапом, газоны ровным тоном -->
          <g :transform="`scale(${A},1)`">
            <path v-for="(d, i) in geo.grass" :key="`g${i}`" class="m-grass" :d="d" />
            <template v-for="(d, i) in geo.forest" :key="`f${i}`">
              <path class="m-forest" :d="d" /><path :d="d" :fill="`url(#${uid}-stipple)`" />
            </template>
            <template v-for="(d, i) in geo.water" :key="`w${i}`">
              <path class="m-water" :d="d" /><path :d="d" :fill="`url(#${uid}-hatch)`" /><path class="m-shore" :d="d" />
            </template>
          </g>

          <!-- улицы: тушью в две линии, тропы — пунктиром -->
          <g class="m-roads">
            <polyline v-for="(l, i) in geo.roads" :key="`rc${i}`" class="m-road-casing" :points="pts(l)" />
            <polyline v-for="(l, i) in geo.roads" :key="`r${i}`" class="m-road" :points="pts(l)" />
          </g>
          <polyline v-for="(l, i) in geo.paths" :key="`p${i}`" class="m-path" :points="pts(l)" />

          <!-- дома без входа -->
          <g v-for="(b, i) in geo.blocks" :key="`b${i}`" class="m-block">
            <rect :x="b[0] * A" :y="b[1]" :width="b[2] * A" :height="b[3]" />
            <rect :x="b[0] * A" :y="b[1]" :width="b[2] * A" :height="b[3]" :fill="`url(#${uid}-hatch)`" opacity="0.35" />
          </g>

          <!-- площадки под открытым небом: участок с пунктирной границей, как двор или площадь на городском плане -->
          <g v-for="p in places.filter(x => x.outdoor)" :key="`o-${p.id}`" class="m-open" :class="{ 'm-open--seen': p.visited, 'm-open--here': p.here }">
            <rect :x="box(p).x" :y="box(p).y" :width="box(p).w" :height="box(p).h" />
          </g>

          <!-- здания: контур, комнаты, подпись этажа -->
          <g v-for="g in buildings" :key="g.id" class="m-building">
            <rect class="m-building__body" :x="g.x" :y="g.y" :width="g.w" :height="g.h" />
            <rect :x="g.x" :y="g.y" :width="g.w" :height="g.h" :fill="`url(#${uid}-solid)`" />
            <g v-for="r in g.rooms" :key="r.id" class="m-room" :class="{ 'm-room--seen': r.visited, 'm-room--known': r.known, 'm-room--here': r.here }">
              <rect :x="box(r).x" :y="box(r).y" :width="box(r).w" :height="box(r).h" />
            </g>
            <text v-if="g.label" class="m-floor-label" text-anchor="middle" :transform="`translate(${g.x + 1.7},${g.y + g.h / 2}) rotate(-90)`">{{ g.label }}</text>
          </g>

          <!-- двери: в общих стенах и на стенах, обращённых к соседним местам -->
          <g v-for="d in allDoors" :key="d.key" class="m-door" :class="{ 'm-door--locked': d.locked }" :transform="`translate(${d.x},${d.y}) rotate(${d.vertical ? 90 : 0})`">
            <rect class="m-door__gap" x="-1.3" y="-0.55" width="2.6" height="1.1" />
            <path class="m-door__leaf" d="M-1.1,0 A2.2,2.2 0 0 1 1.1,0" />
          </g>

          <!-- подписи местности -->
          <g v-for="(l, i) in geo.labels" :key="`l${i}`" :transform="`translate(${l.x * A},${l.y}) rotate(${l.rotate ?? 0}) scale(${K})`">
            <text class="m-label" :class="`m-label--${l.kind ?? 'area'}`" text-anchor="middle">{{ l.text }}</text>
          </g>

          <!-- названия мест и пометки героя -->
          <g v-for="p in places" :key="`n-${p.id}`" class="m-name" :class="{ 'm-name--seen': p.visited, 'm-name--known': p.known, 'm-name--out': p.outdoor }">
            <text text-anchor="middle" :transform="`translate(${cx(p)},${p.outdoor && labelInside(p) ? box(p).y + 3.4 : labelInside(p) ? cy(p) - (nameLines(p).length - 1) * 1.2 + 0.9 : box(p).y + box(p).h + 3.1}) scale(${K})`">
              <tspan v-for="(t, i) in nameLines(p)" :key="i" x="0" :dy="i ? 2.6 : 0">{{ t }}</tspan>
            </text>
            <g v-if="p.save && p.visited" class="m-save" :transform="`translate(${box(p).x + box(p).w - 2.2},${box(p).y + 2.2}) scale(${K * 0.12})`">
              <path :d="PHONE" transform="translate(-12,-12)" />
            </g>
          </g>
          <!-- маркер: где герой сейчас -->
          <template v-for="p in places" :key="`here-${p.id}`">
            <path v-if="p.here" class="m-here" :d="marker(p)" />
          </template>
          <!-- заперто, а двери на плане нет — крест у названия -->
          <g v-for="p in lockMarks" :key="`x-${p.id}`" class="m-cross" :transform="`translate(${box(p).x + 2.4},${box(p).y + 2.4}) scale(${K})`">
            <path d="M-1.3,-1.3 L1.3,1.3 M1.3,-1.3 L-1.3,1.3" />
          </g>
          <!-- крест на запертой двери или тропке -->
          <g v-for="d in allDoors.filter(x => x.locked)" :key="`dx-${d.key}`" class="m-cross" :transform="`translate(${d.x},${d.y}) scale(${K})`">
            <path d="M-1.4,-1.4 L1.4,1.4 M1.4,-1.4 L-1.4,1.4" />
          </g>

          <!-- север: тонкая стрелка, как на отпечатанном плане -->
          <g class="m-compass" :transform="`translate(${W - 5 * K},${9 * K}) scale(${K})`">
            <path class="m-compass__arrow" d="M0,-4.4 L1.3,1.6 L0,0.7 L-1.3,1.6 Z" />
            <text class="m-compass__n" text-anchor="middle" y="-5.4">С</text>
          </g>
          <!-- пометки героя маркером, как на карте в кармане: «?» — загадка не решена, «заперто» — у запертого -->
          <g v-for="p in places.filter(x => x.puzzle)" :key="`q-${p.id}`" class="m-hand" :transform="`translate(${box(p).x + box(p).w - 3},${box(p).y + 3.6}) scale(${K}) rotate(-6)`">
            <path class="m-hand__ring" d="M-2.6,0.2 C-2.7,-1.9 -0.9,-2.9 0.4,-2.7 C2.3,-2.5 2.9,-0.9 2.7,0.6 C2.4,2.3 0.6,2.9 -0.8,2.6 C-2.2,2.2 -2.9,1 -2.5,-0.6" />
            <text class="m-hand__q" text-anchor="middle" y="1.2">?</text>
          </g>
          <g v-for="p in lockMarks" :key="`lw-${p.id}`" class="m-hand" :transform="`translate(${box(p).x + 4.6},${box(p).y + 3.3}) scale(${K}) rotate(-4)`">
            <text class="m-hand__word">заперто</text>
          </g>
          <!-- бумага: скан старого листа поверх всей схемы — пятна, волокна, сгибы -->
          <image v-if="story && paperOk" :href="`/art/${story}/map_paper.jpg`" x="0" y="0" :width="W" height="100" preserveAspectRatio="none" class="m-paper-scan" @error="paperOk = false" />
          <!-- старение по краям и сгибы -->
          <rect :width="W" height="100" :fill="`url(#${uid}-age)`" pointer-events="none" />
          <template v-if="!story || !paperOk"><path class="m-fold" :d="`M${W / 2},0 V100`" /><path class="m-fold" :d="`M0,50 H${W}`" /></template>
          <text class="m-sheet" text-anchor="end" :transform="`translate(${W - 2.4},${100 - 2.6 * K}) scale(${K})`">лист {{ sheetNo }} · {{ areaNow?.name }}</text>
        </svg>
      </div>
      <p class="solo-map__legend">
        <span><i class="solo-map__key solo-map__key--here" />вы здесь</span>
        <span><b class="solo-map__key-x">✕</b>заперто</span>
        <span><b class="solo-map__key-phone">☎</b>можно сохраниться</span>
        <span>серое — где ещё не были</span>
        <span class="solo-keys">клавиша M</span>
      </p>
    </div>
  </div>
</template>
