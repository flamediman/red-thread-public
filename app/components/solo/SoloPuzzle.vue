<script setup lang="ts">
/* Головоломки: кодовый замок (колёсики), диски, последовательность кнопок, слово. Ответ проверяет сервер. */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ data: NonNullable<SoloView['puzzle']>; lastFail: string | null }>()
const emit = defineEmits<{ send: [SoloClientMessage] }>()
const p = computed(() => props.data.puzzle)

const LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split('')
const wheels = ref<string[]>([])
const dials = ref<string[]>([])
const seq = ref<string[]>([])
const word = ref('')

// колёсики сбрасываются только при другой головоломке: после неверной попытки набранное остаётся
watch(() => props.data.hotspot, () => {
  const v = p.value
  if (v.kind === 'code') wheels.value = Array.from({ length: v.length }, () => v.alphabet === 'digits' ? '0' : 'А')
  if (v.kind === 'dials') dials.value = v.dials.map(d => d.values[0] ?? '')
  seq.value = []
  word.value = ''
}, { immediate: true })

function spin(i: number, dir: 1 | -1) {
  const v = p.value
  if (v.kind !== 'code') return
  const set = v.alphabet === 'digits' ? '0123456789'.split('') : LETTERS
  const at = set.indexOf(wheels.value[i]!)
  const next = [...wheels.value]
  next[i] = set[(at + dir + set.length) % set.length]!
  wheels.value = next
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
function submit() {
  const v = p.value
  const answer = v.kind === 'code' ? wheels.value : v.kind === 'dials' ? dials.value : v.kind === 'sequence' ? seq.value : [word.value]
  emit('send', { type: 'solve', hotspot: props.data.hotspot, answer })
  if (v.kind === 'sequence') seq.value = []
}
const close = () => emit('send', { type: 'closePuzzle' })

function onKey(e: KeyboardEvent) {
  if (e.code === 'Escape') { e.preventDefault(); close() }
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
    }
  }
  if (v.kind === 'code' && e.code === 'Backspace') { e.preventDefault(); focus.value = Math.max(0, focus.value - 1) }
  if (v.kind === 'code' && e.code === 'ArrowLeft') { e.preventDefault(); focus.value = Math.max(0, focus.value - 1) }
  if (v.kind === 'code' && e.code === 'ArrowRight') { e.preventDefault(); focus.value = Math.min(v.length - 1, focus.value + 1) }
  if (v.kind === 'code' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); spin(focus.value, e.code === 'ArrowUp' ? 1 : -1) }
  if (e.code === 'Enter' && p.value.kind !== 'sequence') { e.preventDefault(); submit() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-veil" @click.self="close">
    <div class="solo-puzzle" role="dialog" aria-modal="true">
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
          <b class="solo-dial__value tabnum">{{ dials[i] }}</b>
          <div class="solo-dial__row">
            <button type="button" aria-label="меньше" @click="turn(i, -1)">◀</button>
            <i class="solo-dial__knob" :style="{ transform: `rotate(${knobAngle(i)}deg)` }" />
            <button type="button" aria-label="больше" @click="turn(i, 1)">▶</button>
          </div>
        </div>
      </div>

      <div v-else-if="p.kind === 'sequence'" class="solo-seq">
        <button v-for="b in p.buttons" :key="b.id" type="button" class="solo-seq__btn" @click="seq = [...seq, b.id]">{{ b.label }}</button>
        <p class="solo-seq__trace tabnum">{{ seq.length ? seq.map(id => p.kind === 'sequence' ? p.buttons.find(b => b.id === id)?.label : '').join(' → ') : 'нажимайте по порядку' }}</p>
      </div>

      <input v-else v-model="word" class="solo-word" type="text" autocomplete="off" autofocus placeholder="слово">

      <p v-if="lastFail" class="solo-puzzle__fail">{{ lastFail }}</p>
      <div class="solo-puzzle__actions">
        <button type="button" class="solo-btn solo-btn--ghost" @click="close">Отойти</button>
        <button v-if="p.kind === 'sequence'" type="button" class="solo-btn solo-btn--ghost" @click="seq = []">Сначала</button>
        <button type="button" class="solo-btn" @click="submit">Попробовать</button>
      </div>
    </div>
  </div>
</template>
