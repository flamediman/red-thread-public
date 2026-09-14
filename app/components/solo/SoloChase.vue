<script setup lang="ts">
/* Погоня: отбиться нельзя, только выбрать, куда бежать, пока не догнали. Цифры 1–4 — варианты. */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ chase: NonNullable<SoloView['chase']>; story: string; offset: number; focus?: Record<string, string> }>()
const emit = defineEmits<{ send: [SoloClientMessage] }>()

const now = ref(Date.now())
let raf = 0
const loop = () => { now.value = Date.now() + props.offset; raf = requestAnimationFrame(loop) }
onMounted(() => { raf = requestAnimationFrame(loop) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

const share = computed(() => {
  const total = props.chase.deadline - props.chase.startedAt
  return total > 0 ? Math.max(0, Math.min(1, (props.chase.deadline - now.value) / total)) : 0
})
/* чем меньше времени, тем ближе свет фонаря за спиной */
const glow = computed(() => 0.25 + (1 - share.value) * 0.75)

const pick = (index: number) => emit('send', { type: 'run', index })
function onKey(e: KeyboardEvent) {
  const n = Number(e.key)
  if (n >= 1 && n <= props.chase.options.length) { e.preventDefault(); pick(props.chase.options[n - 1]!.index) }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-enc solo-enc--chase" role="alertdialog" aria-modal="true" :style="{ '--glow': glow }">
    <img class="solo-enc__art" :src="`/art/${story}/m_${chase.art}.jpg`" :style="{ objectPosition: focus?.[`m_${chase.art}`] }" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
    <i class="solo-tint" aria-hidden="true" />
    <SoloFog :density="1" other />
    <i class="solo-chase__lamp" aria-hidden="true" />
    <div class="solo-enc__panel">
      <div class="solo-enc__head">
        <span class="solo-enc__name">{{ chase.name }}</span>
        <span class="solo-chase__steps" :aria-label="`шаг ${chase.step + 1} из ${chase.total}`">
          <i v-for="n in chase.total" :key="n" :class="{ done: n <= chase.step, now: n === chase.step + 1 }" />
        </span>
      </div>
      <Transition name="fade" mode="out-in">
        <p :key="chase.step + chase.text" class="solo-enc__text">{{ chase.text }}</p>
      </Transition>
      <div class="solo-enc__timer" :class="{ 'solo-enc__timer--low': share < 0.35 }">
        <i :style="{ transform: `scaleX(${share})` }" />
      </div>
      <div class="solo-enc__options">
        <button v-for="(o, i) in chase.options" :key="`${chase.step}-${o.index}`" type="button" class="solo-enc__opt" @click="pick(o.index)"><kbd>{{ i + 1 }}</kbd>{{ o.label }}</button>
      </div>
    </div>
  </div>
</template>
