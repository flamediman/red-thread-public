<script setup lang="ts">
/* Погоня: отбиться нельзя, только выбрать, куда бежать, пока не догнали. Цифры 1–4 — варианты.
   Чтобы это был бег, а не выбор из списка: «Бегите!» на старте (удар, тряска), кадр трясётся в такт шагам и наезжает,
   смена шага — резкий рывок в новый кадр со свистом воздуха, за спиной всё ближе слышно преследователя, края экрана
   краснеют, пока тает время; неверный поворот — удар, красная вспышка и сильная тряска */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ chase: NonNullable<SoloView['chase']>; story: string; offset: number; health: number; focus?: Record<string, string>; depth?: string[]; wind?: string[] }>()
/* кадр шага объёмный, если для него есть карта глубины: один холст на всю погоню, шаг сменяется за четверть секунды */
const depthFail = ref(false)
const deep = computed(() => !depthFail.value && !!props.depth?.includes(props.chase.art))
const emit = defineEmits<{ send: [SoloClientMessage] }>()
const audio = useAudio()

const now = ref(Date.now())
let raf = 0
const loop = () => { now.value = Date.now() + props.offset; raf = requestAnimationFrame(loop) }

const share = computed(() => {
  const total = props.chase.deadline - props.chase.startedAt
  return total > 0 ? Math.max(0, Math.min(1, (props.chase.deadline - now.value) / total)) : 0
})
/* чем меньше времени, тем ближе свет фонаря за спиной и краснее края */
const glow = computed(() => 0.25 + (1 - share.value) * 0.75)
/* «Бегите!» — пока часы сервера не дошли до начала первого шага */
const intro = computed(() => props.chase.step === 0 && now.value < props.chase.startedAt)

const stage = ref<HTMLElement | null>(null)
const jolt = (frames: Keyframe[], ms: number) => stage.value?.animate(frames, { duration: ms, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
const hit = ref(0)

/* кадры всех шагов — заранее (лёгкая копия и глубина): смена шага без ожидания сети */
function preload() {
  for (const a of props.chase.arts) {
    for (const url of [`/art/${props.story}/${a}.lq.jpg`, ...(props.depth?.includes(a) ? [`/art/${props.story}/z_${a}.jpg`] : [])]) { const i = new Image(); i.src = url }
  }
}

/* преследователь за спиной: его звук раз в 1–1,6 с, всё ближе, пока тает время */
let behindTimer = 0
function behind() {
  behindTimer = window.setTimeout(() => {
    if (!intro.value) {
      const s = share.value
      void audio.spatial(props.chase.sfx, { az: Math.PI + (Math.random() - 0.5) * 0.9, dist: 1.8 + 12 * s, volume: 0.45 + 0.45 * (1 - s) })
    }
    behind()
  }, 1000 + Math.random() * 600)
}

onMounted(() => {
  raf = requestAnimationFrame(loop)
  preload()
  behind()
  if (intro.value) {
    void audio.sfx('enc-sting', 0.9)
    jolt([{ transform: 'scale(1.2) translate(-1.5%, 1%)' }, { transform: 'scale(1.16) translate(1.6%, -1%)', offset: 0.12 }, { transform: 'scale(1.12) translate(-0.8%, 0.5%)', offset: 0.26 }, { transform: 'none' }], 1300)
  }
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearTimeout(behindTimer) })

/* новый шаг — рывок: свист воздуха, вспышка, кадр влетает */
watch(() => props.chase.step, (n, o) => {
  if (n <= o) return
  void audio.sfx('chase-cut', 0.9)
  jolt([{ transform: 'scale(1.14) translateY(-1%)', filter: 'brightness(1.8)' }, { transform: 'none', filter: 'none' }], 420)
})
/* удар (промедлил или не туда): красная вспышка и сильная тряска */
watch(() => props.health, (n, o) => {
  if (o == null || n >= o) return
  hit.value++
  // размах — в пределах запаса картинки (у кадра бега 3 % с каждой стороны): чёрный край не мелькает
  jolt([{ transform: 'translate(1.6%, -1.2%) rotate(0.8deg)' }, { transform: 'translate(-1.5%, 1.1%) rotate(-0.7deg)', offset: 0.2 }, { transform: 'translate(0.8%, -0.6%) rotate(0.35deg)', offset: 0.45 }, { transform: 'none' }], 520)
})

const pick = (index: number) => { if (!intro.value) emit('send', { type: 'run', index }) }
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
  <div class="solo-enc solo-enc--chase" role="alertdialog" aria-modal="true" :style="{ '--glow': glow, '--danger': 1 - share }">
    <div ref="stage" class="solo-enc__stage">
      <div class="solo-chase__bob">
        <SoloDepth
          v-if="deep" class="solo-enc__art" :src="`/art/${story}/${chase.art}.jpg`" :depth="`/art/${story}/z_${chase.art}.jpg`" mode="none" :grade="[0.5, 1.25, 0.7]" :lx="50" :ly="50"
          :focus="focus?.[chase.art]" :fog="0.18" motion="run" :fade-ms="240" :wind="wind?.includes(chase.art) ? `/art/${story}/w_${chase.art}.jpg` : undefined" :windy="1.3" :leaves="1.3" @fail="depthFail = true"
        />
        <Transition v-else name="chase-cut">
          <img :key="chase.art" class="solo-enc__art" :src="`/art/${story}/${chase.art}.jpg`" :style="{ objectPosition: focus?.[chase.art] }" alt="" @error="fallback($event)">
        </Transition>
      </div>
      <i class="solo-tint" aria-hidden="true" />
      <SoloFog :density="1" other />
    </div>
    <i v-if="chase.lamp" class="solo-chase__lamp" aria-hidden="true" />
    <i class="solo-chase__danger" aria-hidden="true" />
    <i :key="hit" class="solo-enc__flash" :class="{ 'solo-enc__flash--hurt': hit }" aria-hidden="true" />
    <Transition name="enc-title"><p v-if="intro && now < chase.startedAt - 650" class="solo-enc__title solo-chase__call">Бегите!</p></Transition>
    <div class="solo-enc__panel" :class="{ 'solo-enc__panel--wait': intro }">
      <div class="solo-enc__head">
        <span class="solo-enc__name">{{ chase.name }}</span>
        <span class="solo-chase__steps" :aria-label="`шаг ${chase.step + 1} из ${chase.total}`">
          <i v-for="n in chase.total" :key="n" :class="{ done: n <= chase.step, now: n === chase.step + 1 }" />
        </span>
      </div>
      <!-- текст шага сменяется за доли секунды: на выбор пути всего несколько секунд -->
      <Transition name="quick-text" mode="out-in">
        <p :key="chase.step + chase.text" class="solo-enc__text">{{ chase.text }}</p>
      </Transition>
      <div class="solo-enc__timer" :class="{ 'solo-enc__timer--low': share < 0.35 }">
        <i :style="{ transform: `scaleX(${share})` }" />
      </div>
      <div class="solo-enc__options">
        <button
          v-for="(o, i) in chase.options" :key="`${chase.step}-${o.index}`" type="button" class="solo-enc__opt solo-chase__opt" :class="{ 'solo-enc__opt--tried': o.tried }"
          :style="{ '--i': i }" :disabled="o.tried || intro" @click="pick(o.index)"
        ><kbd>{{ i + 1 }}</kbd>{{ o.label }}<small v-if="o.tried">не туда</small></button>
      </div>
    </div>
  </div>
</template>
