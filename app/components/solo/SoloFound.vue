<script setup lang="ts">
/* Находка: предмет крупно, как снимок улики, с названием и описанием. Появляется, когда закончились сцена и разговор.
   Щелчок, пробел или Enter — дальше (если нашлось сразу несколько вещей — следующая). */
import type { SoloView } from '#shared/types'

const props = defineProps<{ item?: NonNullable<SoloView['feed'][number]['found']>; note?: NonNullable<SoloView['feed'][number]['note']>; story: string; more: number }>()
const emit = defineEmits<{ done: []; read: [string] }>()
const artOk = ref(true)
const audio = useAudio()
// вещь ложится в карман, записка шуршит
onMounted(() => { void audio.sfx(props.note ? 'paper' : 'pocket', 0.7) })
/** первые строки записки — на карточке, целиком — в журнале */
const excerpt = computed(() => { const t = (props.note?.text ?? '').replace(/\s+/g, ' ').trim(); return t.length > 180 ? t.slice(0, 180).replace(/\s+\S*$/, '') + '…' : t })

function onKey(e: KeyboardEvent) {
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); emit('done') }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="note" class="solo-veil" @click="emit('done')">
    <div class="solo-found solo-found--note" role="dialog" aria-modal="true" :aria-label="`Записка: ${note.title}`">
      <div class="solo-found__body">
        <span class="solo-label">В записках</span>
        <h2 class="solo-found__name">{{ note.title }}</h2>
        <p class="solo-found__paper">{{ excerpt }}</p>
        <div class="solo-found__row">
          <button type="button" class="solo-btn solo-btn--small" @click.stop="emit('read', note.id)">Прочитать</button>
          <span class="solo-found__next">{{ more ? 'щелчок — ещё находка' : 'щелчок или пробел — дальше' }}</span>
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="item" class="solo-veil" @click="emit('done')">
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
