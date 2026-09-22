<script setup lang="ts">
/* Точки быстрого нажатия — общая арена босса и уворота. Точка вспыхивает на своём месте со стрелкой и кольцом-таймером;
   на компьютере жмут стрелку (или WASD), на планшете касаются точки. Время нажатия уходит на сервер, чтобы пинг не съедал
   окно; ответ показывается сразу, до подтверждения сервера. lead — за сколько мс до окна точка уже видна. */
import type { SoloQteKey, SoloQtePrompt } from '#shared/types'

const props = withDefaults(defineProps<{ prompts: SoloQtePrompt[]; now: number; lead?: number }>(), { lead: 260 })
const emit = defineEmits<{ answer: [id: number, key: SoloQteKey, at: number] }>()

const GLYPH: Record<SoloQteKey, string> = { up: '↑', down: '↓', left: '←', right: '→' }
const KEYS: Record<string, SoloQteKey> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', ц: 'up', ы: 'down', ф: 'left', в: 'right'
}
const local = reactive<Record<number, 'hit' | 'miss'>>({})
const result = (p: SoloQtePrompt) => p.result ?? local[p.id] ?? null
const visible = computed(() => props.prompts.filter(p => props.now >= p.from - props.lead && props.now <= p.to + 420))
const ring = (p: SoloQtePrompt) => Math.max(0, Math.min(1, (p.to - props.now) / Math.max(1, p.to - p.from)))
const active = computed(() => props.prompts.find(p => !result(p) && props.now >= p.from - 130 && props.now <= p.to + 130) ?? null)

function answer(p: SoloQtePrompt, key: SoloQteKey) {
  if (result(p)) return
  const inWindow = props.now >= p.from - 130 && props.now <= p.to + 130
  local[p.id] = key === p.key && inWindow ? 'hit' : 'miss'
  emit('answer', p.id, key, props.now)
}
function tap(p: SoloQtePrompt) { if (props.now >= p.from - 130) answer(p, p.key) }
function onKey(e: KeyboardEvent) {
  const key = KEYS[e.key] ?? KEYS[e.key.toLowerCase()]
  if (!key) return
  e.preventDefault()
  const p = active.value
  if (p) answer(p, key)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/* каждая новая точка — короткий тик */
const audio = useAudio()
const ticked = new Set<number>()
watch(visible, list => { for (const p of list) if (!ticked.has(p.id)) { ticked.add(p.id); void audio.sfx('qte-tick', 0.6) } })
defineExpose({ result })
</script>

<template>
  <div class="solo-qte-arena">
    <TransitionGroup name="qte">
      <button
        v-for="p in visible" :key="p.id" type="button" class="solo-qte"
        :class="[`solo-qte--${p.key}`, result(p) && `solo-qte--${result(p)}`]" :style="{ left: `${p.x}%`, top: `${p.y}%` }"
        :aria-label="`стрелка ${GLYPH[p.key]}`" @pointerdown.prevent="tap(p)"
      >
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="solo-qte__ring" cx="50" cy="50" r="46" :style="{ strokeDashoffset: (1 - ring(p)) * 289 }" /></svg>
        <span class="solo-qte__glyph">{{ GLYPH[p.key] }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>
