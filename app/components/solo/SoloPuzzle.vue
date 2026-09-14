<script setup lang="ts">
/* Головоломки: кодовый замок (колёсики), диски, последовательность кнопок, слово. Ответ проверяет сервер. */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ data: NonNullable<SoloView['puzzle']>; lastFail: string | null }>()
const emit = defineEmits<{ send: [SoloClientMessage] }>()
const p = computed(() => props.data.puzzle)

const LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ'.split('')
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
function submit() {
  const v = p.value
  const answer = v.kind === 'code' ? wheels.value : v.kind === 'dials' ? dials.value : v.kind === 'sequence' ? seq.value : [word.value]
  emit('send', { type: 'solve', hotspot: props.data.hotspot, answer })
  if (v.kind === 'sequence') seq.value = []
}
const close = () => emit('send', { type: 'closePuzzle' })

function onKey(e: KeyboardEvent) {
  if (e.code === 'Escape') { e.preventDefault(); close() }
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
        <div v-for="(w, i) in wheels" :key="i" class="solo-wheel">
          <button type="button" aria-label="больше" @click="spin(i, 1)">▲</button>
          <b class="tabnum">{{ w }}</b>
          <button type="button" aria-label="меньше" @click="spin(i, -1)">▼</button>
        </div>
      </div>

      <div v-else-if="p.kind === 'dials'" class="solo-dials">
        <label v-for="(d, i) in p.dials" :key="i" class="solo-dial">
          <span>{{ d.label }}</span>
          <select v-model="dials[i]"><option v-for="v in d.values" :key="v" :value="v">{{ v }}</option></select>
        </label>
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
