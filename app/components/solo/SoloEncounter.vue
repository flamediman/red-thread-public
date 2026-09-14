<script setup lang="ts">
/* Встреча: секунды на решение. Полоса тает в настоящем времени (по часам сервера), цифры 1–5 — варианты. */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ enc: NonNullable<SoloView['encounter']>; story: string; offset: number; light: boolean }>()
const emit = defineEmits<{ send: [SoloClientMessage] }>()

const now = ref(Date.now())
let raf = 0
const loop = () => { now.value = Date.now() + props.offset; raf = requestAnimationFrame(loop) }
onMounted(() => { raf = requestAnimationFrame(loop) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

const share = computed(() => {
  const total = props.enc.deadline - props.enc.startedAt
  return total > 0 ? Math.max(0, Math.min(1, (props.enc.deadline - now.value) / total)) : 0
})
const secondsLeft = computed(() => Math.max(0, Math.ceil((props.enc.deadline - now.value) / 1000)))

function pick(id: string) {
  const o = props.enc.options.find(x => x.id === id)
  if (!o?.enabled) return
  if (id === 'light') emit('send', { type: 'light', on: !props.light })
  else emit('send', { type: 'act', action: id as 'fight' | 'shoot' | 'flee' | 'hide' })
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
    <img class="solo-enc__art" :src="`/art/${story}/m_${enc.monster}.jpg`" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
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
      <div class="solo-enc__timer" :class="{ 'solo-enc__timer--low': share < 0.35 }">
        <i :style="{ transform: `scaleX(${share})` }" /><b class="tabnum">{{ secondsLeft }}</b>
      </div>
      <div class="solo-enc__options">
        <button
          v-for="(o, i) in enc.options" :key="o.id" type="button" class="solo-enc__opt"
          :class="`solo-enc__opt--${o.id}`" :disabled="!o.enabled" @click="pick(o.id)"
        ><kbd>{{ i + 1 }}</kbd>{{ o.label }}</button>
      </div>
    </div>
  </div>
</template>
