<script setup lang="ts">
/* Фон экрана: фотография с медленным наездом, перекрёстное затухание при смене,
   поверх — дождь, зерно плёнки и редкие молнии с громом. */
const props = withDefaults(defineProps<{
  src: string | null
  dim?: boolean
  rain?: 'heavy' | 'soft' | 'off'
  lightning?: boolean
}>(), { dim: false, rain: 'soft', lightning: false })

const audio = useAudio()

/* два слота под картинки — новая проявляется поверх старой */
interface Slot { src: string | null; on: boolean }
const slots = ref<Slot[]>([{ src: null, on: false }, { src: null, on: false }])
let active = 0
watch(() => props.src, (src) => {
  if (slots.value[active]?.src === src) return
  const next = active ^ 1
  slots.value[next] = { src, on: false }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    slots.value[next] = { src, on: !!src }
    slots.value[active] = { ...slots.value[active]!, on: false }
    active = next
  }))
}, { immediate: true })

/* молнии */
const flash = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function strike() {
  // не бьём посреди реплики — ждём тишины
  for (let i = 0; i < 30 && audio.speaking.value; i++) await sleep(500)
  if (!props.lightning) return
  flash.value = true; await sleep(70); flash.value = false; await sleep(90)
  flash.value = true; await sleep(140); flash.value = false
  const close = Math.random() < 0.3
  await sleep(close ? 300 + Math.random() * 500 : 900 + Math.random() * 1400)
  void audio.sfx(close ? 'thunder-clap' : 'thunder-roll', close ? 0.4 : 0.55)
}
function schedule() {
  if (timer) clearTimeout(timer)
  if (!props.lightning) return
  timer = setTimeout(async () => { await strike(); schedule() }, 20000 + Math.random() * 40000)
}
watch(() => props.lightning, schedule, { immediate: true })
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
</script>

<template>
  <div class="backdrop" :class="{ 'backdrop--dim': dim }" aria-hidden="true">
    <img v-for="(s, i) in slots" :key="i" class="backdrop__img" :class="{ 'backdrop__img--on': s.on }" :src="s.src ?? undefined" alt="">
    <div class="backdrop__shade" />
    <div class="backdrop__vignette" />
  </div>
  <div class="storm" aria-hidden="true">
    <div class="storm__rain storm__rain--far" :class="{ 'storm__rain--off': rain === 'off' }" />
    <div class="storm__rain" :class="{ 'storm__rain--off': rain !== 'heavy' }" />
    <div class="storm__flash" :class="{ 'storm__flash--on': flash }" />
    <div class="storm__grain" />
  </div>
</template>
