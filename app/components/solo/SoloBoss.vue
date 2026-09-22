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

const local = reactive<Record<number, 'hit' | 'miss'>>({})
const result = (p: Prompt) => p.result ?? local[p.id] ?? null
function onAnswer(id: number, key: SoloQteKey, at: number) {
  const p = props.boss.prompts.find(x => x.id === id)
  if (p) local[id] = key === p.key && at >= p.from - 130 && at <= p.to + 130 ? 'hit' : 'miss'
  emit('send', { type: 'qte', id, key, at })
}

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
  <div class="solo-enc solo-boss" :class="{ 'solo-enc--hurt': flash === 'miss' }" role="alertdialog" aria-modal="true">
    <i class="solo-enc__flash" :class="flash === 'hit' && 'solo-enc__flash--hit'" aria-hidden="true" />
    <img class="solo-enc__art" :src="`/art/${story}/m_${boss.art}.jpg`" :style="{ objectPosition: focus?.[`m_${boss.art}`] }" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
    <i class="solo-tint" aria-hidden="true" />
    <SoloFog :density="0.9" other />
    <div class="solo-boss__arena"><SoloQte :prompts="boss.prompts" :now="now" @answer="onAnswer" /></div>
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
      <p class="solo-enc__legend">Точки вспыхивают одна за другой: жмите их стрелку на клавиатуре или проводите пальцем в её сторону, пока кольцо не сомкнулось.</p>
    </div>
  </div>
</template>
