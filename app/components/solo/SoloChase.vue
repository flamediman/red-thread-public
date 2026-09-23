<script setup lang="ts">
/* Погоня: отбиться нельзя, только выбрать, куда бежать, пока не догнали. Цифры 1–4 — варианты. */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ chase: NonNullable<SoloView['chase']>; story: string; offset: number; focus?: Record<string, string>; depth?: string[]; wind?: string[] }>()
/* кадр шага объёмный, если для него есть карта глубины: камера бежит — покачивается в такт шагам и наезжает вперёд */
const depthFail = ref(false)
const deep = computed(() => !depthFail.value && !!props.depth?.includes(props.chase.art))
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
/* кадра шага ещё нет — показываем существо; нет и его — прячем */
function fallback(e: Event) {
  const img = e.target as HTMLImageElement
  const base = `/art/${props.story}/${props.chase.base}.jpg`
  if (!img.src.endsWith(base)) img.src = base
  else img.style.visibility = 'hidden'
}
function onKey(e: KeyboardEvent) {
  const n = Number(e.key)
  if (n >= 1 && n <= props.chase.options.length && !props.chase.options[n - 1]!.tried) { e.preventDefault(); pick(props.chase.options[n - 1]!.index) }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-enc solo-enc--chase" role="alertdialog" aria-modal="true" :style="{ '--glow': glow }">
    <Transition name="fade" mode="out-in">
      <SoloDepth v-if="deep" :key="`d-${chase.art}`" class="solo-enc__art" :src="`/art/${story}/${chase.art}.jpg`" :depth="`/art/${story}/z_${chase.art}.jpg`" mode="none" :lx="50" :ly="50" :focus="focus?.[chase.art]" :fog="0.18" motion="run" :wind="wind?.includes(chase.art) ? `/art/${story}/w_${chase.art}.jpg` : undefined" :windy="1.3" @fail="depthFail = true" />
      <img v-else :key="chase.art" class="solo-enc__art" :src="`/art/${story}/${chase.art}.jpg`" :style="{ objectPosition: focus?.[chase.art] }" alt="" @error="fallback($event)">
    </Transition>
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
        <button v-for="(o, i) in chase.options" :key="`${chase.step}-${o.index}`" type="button" class="solo-enc__opt" :class="{ 'solo-enc__opt--tried': o.tried }" :disabled="o.tried" @click="pick(o.index)"><kbd>{{ i + 1 }}</kbd>{{ o.label }}<small v-if="o.tried">не туда</small></button>
      </div>
    </div>
  </div>
</template>
