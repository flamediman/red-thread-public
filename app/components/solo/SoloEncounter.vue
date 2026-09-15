<script setup lang="ts">
/* Встреча: раунд идёт в настоящем времени (по часам сервера), по полосе бежит бегунок. Красные окна — удар попадает,
   синее — уход без урона: жать нужно, пока бегунок внутри. Время нажатия уходит на сервер, чтобы пинг не съедал окно.
   Цифры 1–5 — варианты. */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ enc: NonNullable<SoloView['encounter']>; story: string; offset: number; light: boolean; focus?: Record<string, string> }>()
const emit = defineEmits<{ send: [SoloClientMessage] }>()

const now = ref(Date.now())
let raf = 0
const loop = () => { now.value = Date.now() + props.offset; raf = requestAnimationFrame(loop) }
onMounted(() => { raf = requestAnimationFrame(loop) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

const total = computed(() => props.enc.windowMs || Math.max(1, props.enc.deadline - props.enc.startedAt))
/** где бегунок: доля раунда, 0…1 */
const pos = computed(() => Math.max(0, Math.min(1, (now.value - props.enc.startedAt) / total.value)))
const share = computed(() => 1 - pos.value)
const secondsLeft = computed(() => Math.max(0, Math.ceil((props.enc.deadline - now.value) / 1000)))
const band = (z: [number, number]) => ({ left: `${((z[0] - props.enc.startedAt) / total.value) * 100}%`, width: `${((z[1] - z[0]) / total.value) * 100}%` })
const inside = (z: [number, number] | null) => !!z && now.value >= z[0] && now.value <= z[1]
const inHit = computed(() => props.enc.zones.hit.some(inside))
const inFlee = computed(() => inside(props.enc.zones.flee))
const ready = (id: string) => (id === 'fight' || id === 'shoot') ? inHit.value : id === 'flee' ? inFlee.value : false

function pick(id: string) {
  const o = props.enc.options.find(x => x.id === id)
  if (!o?.enabled) return
  if (id === 'light') emit('send', { type: 'light', on: !props.light })
  else emit('send', { type: 'act', action: id as 'fight' | 'shoot' | 'flee' | 'hide', at: now.value })
}
function onKey(e: KeyboardEvent) {
  const n = Number(e.key)
  if (n >= 1 && n <= props.enc.options.length) { e.preventDefault(); pick(props.enc.options[n - 1]!.id) }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-enc" role="alertdialog" aria-modal="true">
    <img class="solo-enc__art" :src="`/art/${story}/m_${enc.monster}.jpg`" :style="{ objectPosition: focus?.[`m_${enc.monster}`] }" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
    <i class="solo-tint" aria-hidden="true" />
    <SoloFog :density="0.9" other />
    <div class="solo-enc__panel">
      <div class="solo-enc__head">
        <span class="solo-enc__name">{{ enc.name }}</span>
        <span class="solo-enc__hp"><i :style="{ transform: `scaleX(${enc.maxHp ? enc.hp / enc.maxHp : 0})` }" /></span>
      </div>
      <Transition name="fade" mode="out-in">
        <p :key="enc.round + enc.text" class="solo-enc__text">{{ enc.text }}</p>
      </Transition>
      <div class="solo-enc__track" :class="{ 'solo-enc__track--low': share < 0.3 }">
        <i v-for="(z, i) in enc.zones.hit" :key="`h${i}`" class="solo-enc__zone solo-enc__zone--hit" :class="{ on: inside(z) }" :style="band(z)" />
        <i v-if="enc.zones.flee" class="solo-enc__zone solo-enc__zone--flee" :class="{ on: inFlee }" :style="band(enc.zones.flee)" />
        <em class="solo-enc__cursor" :style="{ left: `${pos * 100}%` }" />
        <b class="tabnum">{{ secondsLeft }}</b>
      </div>
      <p class="solo-enc__legend"><i class="solo-enc__key solo-enc__key--hit" />удар · <i class="solo-enc__key solo-enc__key--flee" />уход без удара — жмите, пока бегунок в окне</p>
      <div class="solo-enc__options">
        <button
          v-for="(o, i) in enc.options" :key="o.id" type="button" class="solo-enc__opt"
          :class="[`solo-enc__opt--${o.id}`, { 'solo-enc__opt--ready': ready(o.id) }]" :disabled="!o.enabled" @click="pick(o.id)"
        ><kbd>{{ i + 1 }}</kbd>{{ o.label }}</button>
      </div>
    </div>
  </div>
</template>
