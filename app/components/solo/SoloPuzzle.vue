<script setup lang="ts">
/* Головоломки: кодовый замок (колёсики), диски, последовательность кнопок, слово, часы, клавиши на слух, раскладка,
   решётка-трафарет. Ответ проверяет сервер. Записки можно открыть, не уходя от замка. */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ data: NonNullable<SoloView['puzzle']>; story: string; lastFail: string | null; paused?: boolean }>()
const emit = defineEmits<{ send: [SoloClientMessage]; notes: [] }>()
const audio = useAudio()
const p = computed(() => props.data.puzzle)

const LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split('')
const wheels = ref<string[]>([])
const dials = ref<string[]>([])
const seq = ref<string[]>([])
const word = ref('')
/* часы: минуты от полуночи по циферблату */
const clockMin = ref(0)
/* раскладка: для каждого места — id вещи или '' */
const placed = ref<string[]>([])
const holding = ref<string | null>(null)
/* решётка: наложена ли и на сколько четвертей повёрнута */
const grilleOn = ref(false)
const turns = ref(0)

// колёсики сбрасываются только при другой головоломке: после неверной попытки набранное остаётся
watch(() => props.data.hotspot, () => {
  const v = p.value
  if (v.kind === 'code') wheels.value = Array.from({ length: v.length }, () => v.alphabet === 'digits' ? '0' : 'А')
  if (v.kind === 'dials') dials.value = v.dials.map(d => d.values[0] ?? '')
  if (v.kind === 'arrange') placed.value = v.slots.map(() => '')
  seq.value = []
  word.value = ''
  clockMin.value = 0
  if (v.kind === 'clock' && v.start) { const [h, m] = v.start.split(':').map(Number); clockMin.value = ((h ?? 0) % 12) * 60 + (m ?? 0) }
  holding.value = null
  grilleOn.value = false
  turns.value = 0
}, { immediate: true })

function spin(i: number, dir: 1 | -1) {
  const v = p.value
  if (v.kind !== 'code') return
  const set = v.alphabet === 'digits' ? '0123456789'.split('') : LETTERS
  const at = set.indexOf(wheels.value[i]!)
  const next = [...wheels.value]
  next[i] = set[(at + dir + set.length) % set.length]!
  wheels.value = next
  void audio.sfx('qte-tick', 0.35)
}
/* колёсико можно крутить и пальцем (тянуть вверх-вниз), и колесом мыши, а на клавиатуре — просто набрать код */
const focus = ref(0)
let drag: { i: number; y: number } | null = null
function onDown(i: number, e: PointerEvent) {
  focus.value = i
  drag = { i, y: e.clientY }
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onMove(e: PointerEvent) {
  if (!drag) return
  const dy = e.clientY - drag.y
  if (Math.abs(dy) < 18) return
  spin(drag.i, dy < 0 ? 1 : -1)
  drag.y = e.clientY
}
const onUp = () => { drag = null }
let wheelSum = 0
function onWheel(i: number, e: WheelEvent) {
  e.preventDefault()
  wheelSum += e.deltaY
  if (Math.abs(wheelSum) < 40) return
  spin(i, wheelSum < 0 ? 1 : -1)
  wheelSum = 0
}

/* диск: значения по кругу, ручка поворачивается от −135° до +135° */
function turn(i: number, dir: 1 | -1) {
  const v = p.value
  if (v.kind !== 'dials') return
  const values = v.dials[i]!.values
  const at = values.indexOf(dials.value[i]!)
  const next = [...dials.value]
  next[i] = values[(at + dir + values.length) % values.length]!
  dials.value = next
}
function knobAngle(i: number) {
  const v = p.value
  if (v.kind !== 'dials') return 0
  const values = v.dials[i]!.values
  return values.length > 1 ? -135 + (values.indexOf(dials.value[i]!) / (values.length - 1)) * 270 : 0
}
/* ── часы: стрелки ходят вместе, как у настоящих — крутят заводную головку; минутную можно тянуть пальцем ── */
const hh = computed(() => Math.floor(clockMin.value / 60) % 12 || 12)
const mm = computed(() => clockMin.value % 60)
const minuteAngle = computed(() => mm.value * 6)
const hourAngle = computed(() => ((clockMin.value / 60) % 12) * 30)
function stepClock(delta: number) { clockMin.value = (clockMin.value + delta + 720) % 720; void audio.sfx('qte-tick', 0.3) }
let clockDrag = false
function clockPoint(e: PointerEvent) {
  const svg = (e.currentTarget as SVGElement).getBoundingClientRect()
  const x = e.clientX - svg.left - svg.width / 2, y = e.clientY - svg.top - svg.height / 2
  const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360
  const target = Math.round(deg / 30) * 5 % 60
  let diff = target - mm.value
  if (diff > 30) diff -= 60
  if (diff < -30) diff += 60
  if (diff) stepClock(diff)
}
function clockDown(e: PointerEvent) { clockDrag = true; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); clockPoint(e) }
function clockMove(e: PointerEvent) { if (clockDrag) clockPoint(e) }

/* ── клавиши: нажатие звучит, набранное копится ── */
function press(id: string, note: string) {
  const v = p.value
  audio.tone(note, v.kind === 'keys' ? v.timbre ?? 'piano' : 'piano')
  seq.value = [...seq.value, id]
}

/* ── последовательность: каждая кнопка — один раз, щелчок слышен ── */
function pressSeq(id: string) {
  if (seq.value.includes(id)) return
  seq.value = [...seq.value, id]
  void audio.sfx('qte-tick', 0.3)
}

/* ── раскладка: взять вещь, положить на место; щелчок по занятому месту возвращает вещь ── */
function slotClick(i: number) {
  const next = [...placed.value]
  if (holding.value) { next[i] = holding.value; holding.value = null }
  else next[i] = ''
  placed.value = next
  void audio.sfx('paper', 0.3)
}
const freePieces = computed(() => p.value.kind === 'arrange' ? p.value.pieces.filter(pc => !placed.value.includes(pc.id)) : [])

/* ── решётка: прорези для положения 0, поворот по часовой (r, c) → (c, n − 1 − r) ── */
const holeSet = computed(() => {
  const v = p.value
  if (v.kind !== 'grille') return new Set<string>()
  const n = v.grid.length
  const rot = ([r, c]: [number, number]): [number, number] => [c, n - 1 - r]
  return new Set(v.holes.map(h => { let x = h; for (let k = 0; k < turns.value % 4; k++) x = rot(x); return `${x[0]},${x[1]}` }))
})

function submit() {
  const v = p.value
  const answer = v.kind === 'code' ? wheels.value : v.kind === 'dials' ? dials.value : v.kind === 'sequence' || v.kind === 'keys' ? seq.value
    : v.kind === 'clock' ? [`${hh.value}:${String(mm.value).padStart(2, '0')}`] : v.kind === 'arrange' ? placed.value : [word.value]
  emit('send', { type: 'solve', hotspot: props.data.hotspot, answer })
  if (v.kind === 'sequence' || v.kind === 'keys') seq.value = []
}
const close = () => emit('send', { type: 'closePuzzle' })

/* Пока открыта головоломка, клавиши принадлежат ей: цифра или буква, набранная на замке, не открывает ни вещи, ни
   записки, ни карту (на русской раскладке «О» — это клавиша J, «Ш» — I). Остальные окна слушают клавиши по всплытию —
   здесь, на перехвате, событие дальше не идёт */
function onKey(e: KeyboardEvent) {
  // поверх открыты записки — клавиши им
  if (props.paused) return
  e.stopImmediatePropagation()
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (e.code === 'Escape') { e.preventDefault(); close(); return }
  const v = p.value
  if (v.kind === 'code' && e.key.length === 1) {
    const ch = e.key.toUpperCase().replace('Ё', 'Е')
    const set = v.alphabet === 'digits' ? '0123456789' : LETTERS.join('')
    if (set.includes(ch)) {
      e.preventDefault()
      const next = [...wheels.value]
      next[focus.value] = ch
      wheels.value = next
      focus.value = Math.min(focus.value + 1, v.length - 1)
      return
    }
  }
  if (v.kind === 'code' && e.code === 'Backspace') { e.preventDefault(); focus.value = Math.max(0, focus.value - 1) }
  if (v.kind === 'code' && e.code === 'ArrowLeft') { e.preventDefault(); focus.value = Math.max(0, focus.value - 1) }
  if (v.kind === 'code' && e.code === 'ArrowRight') { e.preventDefault(); focus.value = Math.min(v.length - 1, focus.value + 1) }
  if (v.kind === 'code' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); spin(focus.value, e.code === 'ArrowUp' ? 1 : -1) }
  if (e.code === 'Enter' && p.value.kind !== 'sequence' && p.value.kind !== 'keys') { e.preventDefault(); submit() }
  // записки — по J только там, где с клавиатуры ничего не набирают (у кодового замка на буквах J — это «О»)
  if (e.code === 'KeyJ' && (v.kind === 'dials' || v.kind === 'sequence' || v.kind === 'clock' || v.kind === 'arrange' || (v.kind === 'code' && v.alphabet === 'digits'))) { e.preventDefault(); emit('notes') }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="solo-veil" @click.self="close">
    <div class="solo-puzzle" role="dialog" aria-modal="true">
      <!-- крупный план того, что открываем: без цифр и букв, ответ не подсказывает -->
      <img v-if="p.art" :key="p.art" class="solo-puzzle__art" :src="`/art/${story}/${p.art}.jpg`" alt="" @error="($event.target as HTMLImageElement).hidden = true">
      <p class="solo-puzzle__prompt">{{ p.prompt }}</p>

      <div v-if="p.kind === 'code'" class="solo-wheels">
        <div v-for="(w, i) in wheels" :key="i" class="solo-wheel" :class="{ on: focus === i }">
          <button type="button" aria-label="больше" @click="focus = i; spin(i, 1)">▲</button>
          <b class="tabnum" @pointerdown="onDown(i, $event)" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @wheel="onWheel(i, $event)">{{ w }}</b>
          <button type="button" aria-label="меньше" @click="focus = i; spin(i, -1)">▼</button>
        </div>
      </div>

      <div v-else-if="p.kind === 'dials'" class="solo-dials">
        <div v-for="(d, i) in p.dials" :key="i" class="solo-dial">
          <span class="solo-dial__label">{{ d.label }}</span>
          <b class="solo-dial__value tabnum" :class="{ 'solo-dial__value--long': d.values.some(x => x.length > 6) }">{{ dials[i] }}</b>
          <div class="solo-dial__row">
            <button type="button" aria-label="меньше" @click="turn(i, -1)">◀</button>
            <i class="solo-dial__knob" :style="{ transform: `rotate(${knobAngle(i)}deg)` }" />
            <button type="button" aria-label="больше" @click="turn(i, 1)">▶</button>
          </div>
        </div>
      </div>

      <!-- порядок: у нажатой кнопки — её номер, второй раз её не нажать; «Сначала» снимает все -->
      <div v-else-if="p.kind === 'sequence'" class="solo-seq">
        <div class="solo-seq__grid">
          <button
            v-for="b in p.buttons" :key="b.id" type="button" class="solo-seq__btn" :class="{ 'solo-seq__btn--on': seq.includes(b.id) }"
            :disabled="seq.includes(b.id)" @click="pressSeq(b.id)"
          ><i v-if="seq.includes(b.id)" class="solo-seq__num tabnum">{{ seq.indexOf(b.id) + 1 }}</i>{{ b.label }}</button>
        </div>
        <p class="solo-seq__trace">нажимайте по порядку</p>
      </div>

      <div v-else-if="p.kind === 'clock'" class="solo-clock">
        <svg viewBox="-50 -50 100 100" class="solo-clock__face" @pointerdown="clockDown" @pointermove="clockMove" @pointerup="clockDrag = false" @pointercancel="clockDrag = false">
          <circle r="47" class="solo-clock__rim" />
          <line v-for="i in 60" :key="i" :x1="0" :y1="i % 5 ? -43 : -40" :x2="0" y2="-45" :class="i % 5 ? 'solo-clock__tick' : 'solo-clock__hour-tick'" :transform="`rotate(${i * 6})`" />
          <line x1="0" y1="4" x2="0" y2="-24" class="solo-clock__hand solo-clock__hand--h" :transform="`rotate(${hourAngle})`" />
          <line x1="0" y1="6" x2="0" y2="-36" class="solo-clock__hand solo-clock__hand--m" :transform="`rotate(${minuteAngle})`" />
          <circle r="2.4" class="solo-clock__pin" />
        </svg>
        <div class="solo-clock__row">
          <button type="button" @click="stepClock(-60)">−1 ч</button>
          <button type="button" @click="stepClock(-5)">−5 мин</button>
          <button type="button" @click="stepClock(5)">+5 мин</button>
          <button type="button" @click="stepClock(60)">+1 ч</button>
        </div>
      </div>

      <div v-else-if="p.kind === 'keys'" class="solo-keys-inst">
        <div class="solo-keys-inst__keys">
          <button v-for="k in p.keys" :key="k.id" type="button" class="solo-key" :class="{ 'solo-key--black': k.black }" :aria-label="`клавиша ${k.id}`" @click="press(k.id, k.note)" />
        </div>
        <p class="solo-seq__trace">{{ seq.length ? '• '.repeat(seq.length).trim() : 'клавиши звучат — наберите мелодию' }}</p>
      </div>

      <div v-else-if="p.kind === 'arrange'" class="solo-arrange">
        <div class="solo-arrange__slots">
          <button v-for="(sl, i) in p.slots" :key="sl.id" type="button" class="solo-arrange__slot" :class="{ 'solo-arrange__slot--ready': holding }" @click="slotClick(i)">
            <small>{{ sl.label }}</small><b>{{ p.pieces.find(pc => pc.id === placed[i])?.label ?? '—' }}</b>
          </button>
        </div>
        <div class="solo-arrange__pieces">
          <button v-for="pc in freePieces" :key="pc.id" type="button" class="solo-arrange__piece" :class="{ on: holding === pc.id }" @click="holding = holding === pc.id ? null : pc.id">{{ pc.label }}</button>
        </div>
      </div>

      <div v-else-if="p.kind === 'grille'" class="solo-grille">
        <div class="solo-grille__grid" :style="{ gridTemplateColumns: `repeat(${p.grid.length}, 1fr)` }">
          <template v-for="(row, r) in p.grid" :key="r">
            <span v-for="(ch, c) in row.split('')" :key="c" class="solo-grille__cell" :class="{ 'solo-grille__cell--hole': grilleOn && holeSet.has(`${r},${c}`), 'solo-grille__cell--covered': grilleOn && !holeSet.has(`${r},${c}`) }">{{ ch }}</span>
          </template>
        </div>
        <div class="solo-grille__row">
          <button type="button" class="solo-btn solo-btn--small solo-btn--ghost" @click="grilleOn = !grilleOn">{{ grilleOn ? 'Снять трафарет' : 'Наложить трафарет' }}</button>
          <button v-if="grilleOn" type="button" class="solo-btn solo-btn--small solo-btn--ghost" @click="turns = (turns + 1) % 4">Повернуть ↻</button>
        </div>
        <input v-model="word" class="solo-word" type="text" autocomplete="off" placeholder="что прочитали">
      </div>

      <input v-else v-model="word" class="solo-word" type="text" autocomplete="off" autofocus placeholder="слово">

      <p v-if="lastFail" class="solo-puzzle__fail">{{ lastFail }}</p>
      <div class="solo-puzzle__actions">
        <button type="button" class="solo-btn solo-btn--ghost" @click="close">Отойти</button>
        <button type="button" class="solo-btn solo-btn--ghost" title="Записки (J)" @click="emit('notes')">Записки</button>
        <button v-if="p.kind === 'sequence' || p.kind === 'keys'" type="button" class="solo-btn solo-btn--ghost" :disabled="!seq.length" @click="seq = []">Сначала</button>
        <button type="button" class="solo-btn" @click="submit">Попробовать</button>
      </div>
    </div>
  </div>
</template>
