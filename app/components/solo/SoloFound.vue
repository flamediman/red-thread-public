<script setup lang="ts">
/* Находка: предмет крупно, как снимок улики, с названием и описанием. Появляется, когда закончились сцена и разговор.
   Щелчок, пробел или Enter — дальше (если нашлось сразу несколько вещей — следующая). */
import type { SoloView } from '#shared/types'

defineProps<{ item: NonNullable<SoloView['feed'][number]['found']>; story: string; more: number }>()
const emit = defineEmits<{ done: [] }>()
const artOk = ref(true)
const audio = useAudio()
// вещь ложится в карман
onMounted(() => { void audio.sfx('pocket', 0.7) })

function onKey(e: KeyboardEvent) {
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); emit('done') }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-veil" @click="emit('done')">
    <div class="solo-found" :class="{ 'solo-found--noart': !artOk }" role="dialog" aria-modal="true" :aria-label="`Найдено: ${item.name}`">
      <img v-if="artOk" class="solo-found__art" :src="`/art/${story}/${item.art}.jpg`" alt="" @error="artOk = false">
      <div class="solo-found__body">
        <span class="solo-label">В карманах</span>
        <h2 class="solo-found__name">{{ item.name }}</h2>
        <p class="solo-found__text">{{ item.description }}</p>
        <span class="solo-found__next">{{ more ? `щелчок — ещё находка` : 'щелчок или пробел — дальше' }}</span>
      </div>
    </div>
  </div>
</template>
