<script setup lang="ts">
/* Сцена на весь экран: реплики по одной. С озвучкой реплика сменяется сама, когда голос дозвучал;
   щелчок или пробел, пока голос звучит, — обрывает голос (текст уже весь на экране), следующий — дальше.
   Без озвучки — только по щелчку. Картинка реплики — фото или письмо. */
import type { SoloLine } from '#shared/types'
import { currentCase } from '~/utils/case-store'

/** fallback — кадр места, где герой сейчас: сцена без своей картинки идёт поверх него, а не на пустом тумане */
const props = defineProps<{ lines: SoloLine[]; story: string; hero: string; speakers: Record<string, string>; fallback?: string | null; focus?: Record<string, string> }>()
const emit = defineEmits<{ done: [] }>()
const audio = useAudio()

const index = ref(0)
const line = computed(() => props.lines[index.value] ?? null)
/* кадр — последняя картинка до этой реплики; письмо кадр не меняет, оно ложится поверх */
const art = computed(() => {
  const a = [...props.lines.slice(0, index.value + 1)].reverse().find(l => l.art && l.art !== 'letter')?.art
  return a ? `/art/${props.story}/${a}.jpg` : props.fallback ?? null
})
const focusOf = (src: string) => props.focus?.[src.split('/').pop()!.replace(/\.jpg$/, '')] ?? undefined
const letter = computed(() => line.value?.art === 'letter')
const who = computed(() => {
  const s = line.value?.speaker
  return !s || s === 'narrator' ? '' : s === 'hero' ? props.hero : props.speakers[s] ?? ''
})
const voiced = ref(false)

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
let run = 0
async function play() {
  const my = ++run
  const l = line.value
  if (!l) return
  audio.stopVoice()
  for (const s of l.sfx ?? []) void audio.sfx(s, 0.8)
  if (!l.id) return
  const v = await audio.voice(l.id)
  // пока файл грузился, игрок ушёл дальше — эта реплика не должна дозвучивать
  if (my !== run) { if (v.played) audio.stopVoice(); return }
  voiced.value = v.played
  if (!v.played) return
  await v.done
  if (my !== run) return
  await sleep(l.speaker === 'narrator' ? 900 : 700)
  if (my !== run) return
  next()
}
function next() {
  run++
  // первый щелчок при звучащем голосе — только обрывает его; реплика остаётся дочитать
  if (voiced.value && audio.speaking.value) { audio.stopVoice(); voiced.value = false; return }
  audio.stopVoice()
  if (index.value + 1 >= props.lines.length) { emit('done'); return }
  index.value++
}
// сцена у страницы с ключом по номеру: новая сцена — новый компонент; обновления состояния с сервера реплику не сбрасывают
watch(index, play, { immediate: true })
onMounted(() => { for (const l of props.lines.slice(1)) if (l.id) void audio.preload(`/voice/${currentCase.value}/${l.id}.mp3`) })
onBeforeUnmount(() => { run++; audio.stopVoice() })

function onKey(e: KeyboardEvent) {
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') { e.preventDefault(); next() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-scene" role="dialog" aria-modal="true" @click="next">
    <Transition name="fade" :duration="400">
      <img v-if="art" :key="art" class="solo-scene__art" :src="art" :style="{ objectPosition: focusOf(art) }" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
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
    <span class="solo-scene__next">{{ voiced ? 'щелчок или пробел — пропустить' : index + 1 < lines.length ? 'щелчок или пробел — дальше' : 'щелчок или пробел — продолжить' }}</span>
  </div>
</template>
