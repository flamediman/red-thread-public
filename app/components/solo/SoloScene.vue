<script setup lang="ts">
/* Сцена на весь экран: реплики по одной, щелчок или пробел — дальше. Картинка реплики — фото или письмо. */
import type { SoloLine } from '#shared/types'

/** fallback — кадр места, где герой сейчас: сцена без своей картинки идёт поверх него, а не на пустом тумане */
const props = defineProps<{ lines: SoloLine[]; story: string; hero: string; speakers: Record<string, string>; fallback?: string | null }>()
const emit = defineEmits<{ done: [] }>()
const audio = useAudio()

const index = ref(0)
const line = computed(() => props.lines[index.value] ?? null)
const art = computed(() => {
  const a = [...props.lines.slice(0, index.value + 1)].reverse().find(l => l.art)?.art
  return a && a !== 'letter' ? `/art/${props.story}/${a}.jpg` : props.fallback ?? null
})
const letter = computed(() => line.value?.art === 'letter')
const who = computed(() => {
  const s = line.value?.speaker
  return !s || s === 'narrator' ? '' : s === 'hero' ? props.hero : props.speakers[s] ?? ''
})

async function play() {
  const l = line.value
  if (!l) return
  for (const s of l.sfx ?? []) void audio.sfx(s, 0.8)
}
function next() {
  audio.stopVoice()
  if (index.value + 1 >= props.lines.length) { emit('done'); return }
  index.value++
}
// сцена у страницы с ключом по номеру: новая сцена — новый компонент; обновления состояния с сервера реплику не сбрасывают
watch(index, play, { immediate: true })

function onKey(e: KeyboardEvent) {
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') { e.preventDefault(); next() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-scene" role="dialog" aria-modal="true" @click="next">
    <Transition name="fade" :duration="400">
      <img v-if="art" :key="art" class="solo-scene__art" :src="art" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
    </Transition>
    <i class="solo-tint" aria-hidden="true" />
    <SoloFog :density="0.6" />
    <div v-if="letter" class="solo-letter"><p>{{ line?.text }}</p></div>
    <div v-else class="solo-scene__box">
      <span v-if="who" class="solo-scene__who">{{ who }}</span>
      <Transition name="fade" mode="out-in">
        <p :key="index" class="solo-scene__text" :class="{ 'solo-scene__text--hero': line?.speaker === 'hero' }">{{ line?.text }}</p>
      </Transition>
    </div>
    <span class="solo-scene__next">{{ index + 1 < lines.length ? 'щелчок или пробел — дальше' : 'щелчок или пробел — продолжить' }}</span>
  </div>
</template>
