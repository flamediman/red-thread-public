<script setup lang="ts">
/* Босс: серия точек со стрелками, одна за другой. На компьютере — нажать эту стрелку (или WASD), на планшете —
   коснуться точки, пока кольцо вокруг неё не сомкнулось. Время нажатия уходит на сервер, чтобы пинг не съедал окно.
   Ответ показывается сразу, до подтверждения сервера. */
import type { SoloClientMessage, SoloQteKey, SoloView } from '#shared/types'

type Prompt = NonNullable<SoloView['boss']>['prompts'][number]
const props = defineProps<{ boss: NonNullable<SoloView['boss']>; story: string; offset: number; focus?: Record<string, string> }>()
const emit = defineEmits<{ send: [SoloClientMessage] }>()

const now = ref(Date.now())
let raf = 0
const loop = () => { now.value = Date.now() + props.offset; raf = requestAnimationFrame(loop) }
onMounted(() => { raf = requestAnimationFrame(loop) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

const GLYPH: Record<SoloQteKey, string> = { up: '↑', down: '↓', left: '←', right: '→' }
const KEYS: Record<string, SoloQteKey> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', ц: 'up', ы: 'down', ф: 'left', в: 'right'
}
/** мгновенный отклик: что нажали, пока сервер не ответил */
const local = reactive<Record<number, 'hit' | 'miss'>>({})
const result = (p: Prompt) => p.result ?? local[p.id] ?? null
/** точка на экране: чуть раньше своего окна (чтобы глаз успел найти), и чуть после — показать итог */
const visible = computed(() => props.boss.prompts.filter(p => now.value >= p.from - 260 && now.value <= p.to + 420))
/** сколько времени у точки осталось, 1 → 0 */
const ring = (p: Prompt) => Math.max(0, Math.min(1, (p.to - now.value) / Math.max(1, p.to - p.from)))
/** точка, которую сейчас ловят клавишей: та, чьё окно идёт (с запасом на края) */
const active = computed(() => props.boss.prompts.find(p => !result(p) && now.value >= p.from - 130 && now.value <= p.to + 130) ?? null)

function answer(p: Prompt, key: SoloQteKey) {
  if (result(p)) return
  const inWindow = now.value >= p.from - 130 && now.value <= p.to + 130
  local[p.id] = key === p.key && inWindow ? 'hit' : 'miss'
  emit('send', { type: 'qte', id: p.id, key, at: now.value })
}
function tap(p: Prompt) { if (now.value >= p.from - 130) answer(p, p.key) }
function onKey(e: KeyboardEvent) {
  const key = KEYS[e.key] ?? KEYS[e.key.toLowerCase()]
  if (!key) return
  e.preventDefault()
  const p = active.value
  if (p) answer(p, key)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/* вспышка по итогу серии: удар по боссу — свет, удар по герою — тряска */
const flash = ref<'hit' | 'miss' | null>(null)
let flashTimer = 0
watch(() => props.boss.round, () => {
  flash.value = props.boss.last
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => { flash.value = null }, 600)
})
const caught = computed(() => props.boss.prompts.filter(p => result(p) === 'hit').length)
const secondsLeft = computed(() => Math.max(0, Math.ceil((props.boss.deadline - now.value) / 1000)))
</script>

<template>
  <div class="solo-enc solo-boss" :class="flash && `solo-boss--${flash}`" role="alertdialog" aria-modal="true">
    <img class="solo-enc__art" :src="`/art/${story}/m_${boss.art}.jpg`" :style="{ objectPosition: focus?.[`m_${boss.art}`] }" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
    <i class="solo-tint" aria-hidden="true" />
    <SoloFog :density="0.9" other />
    <div class="solo-boss__arena">
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
    <div class="solo-enc__panel">
      <div class="solo-enc__head">
        <span class="solo-enc__name">{{ boss.name }}</span>
        <span class="solo-enc__hp"><i :style="{ transform: `scaleX(${boss.maxHp ? boss.hp / boss.maxHp : 0})` }" /></span>
        <b class="solo-boss__time tabnum">{{ secondsLeft }}</b>
      </div>
      <Transition name="fade" mode="out-in">
        <p :key="boss.round + boss.text" class="solo-enc__text">{{ boss.text }}</p>
      </Transition>
      <div class="solo-boss__series" :aria-label="`поймано ${caught} из ${boss.prompts.length}, нужно ${boss.need}`">
        <i v-for="p in boss.prompts" :key="p.id" :class="result(p)" />
        <span>нужно {{ boss.need }} из {{ boss.prompts.length }}</span>
      </div>
      <p class="solo-enc__legend">Точки вспыхивают одна за другой: жмите их стрелку на клавиатуре или касайтесь точки, пока кольцо не сомкнулось.</p>
    </div>
  </div>
</template>
