<script setup lang="ts">
/* Карта: планы районов, где герой уже был, и соседние места. Сохранения — отметкой, запертое — красным. */
import type { SoloView } from '#shared/types'

const props = defineProps<{ map: SoloView['map']; area: string }>()
const emit = defineEmits<{ close: [] }>()
const tab = ref(props.area)
const areas = computed(() => props.map.areas.filter(a => props.map.places.some(p => p.area === a.id)))
const places = computed(() => props.map.places.filter(p => p.area === tab.value))
const aspect = computed(() => props.map.areas.find(a => a.id === tab.value)?.aspect ?? 1.5)
const lines = computed(() => {
  const at = new Map(places.value.map(p => [p.id, { x: p.x + p.w / 2, y: p.y + p.h / 2 }]))
  return props.map.links.flatMap(([a, b]) => {
    const pa = at.get(a), pb = at.get(b)
    return pa && pb ? [{ key: `${a}-${b}`, x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y }] : []
  })
})

function onKey(e: KeyboardEvent) { if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); emit('close') } }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-veil" @click.self="emit('close')">
    <div class="solo-map" role="dialog" aria-modal="true" aria-label="Карта">
      <div class="solo-map__tabs">
        <button v-for="a in areas" :key="a.id" type="button" :class="{ on: tab === a.id }" @click="tab = a.id">{{ a.name }}</button>
        <button type="button" class="solo-map__close" aria-label="Закрыть" @click="emit('close')">×</button>
      </div>
      <div class="solo-map__paper" :style="{ aspectRatio: String(aspect) }">
        <svg class="solo-map__roads" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line v-for="l in lines" :key="l.key" :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2" />
        </svg>
        <div
          v-for="p in places" :key="p.id" class="solo-map__place"
          :class="{ 'solo-map__place--seen': p.visited, 'solo-map__place--here': p.here, 'solo-map__place--locked': p.locked }"
          :style="{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%` }"
        >
          <span>{{ p.visited ? p.name : '?' }}</span>
          <i v-if="p.save" class="solo-map__save" title="здесь можно сохраниться">☎</i>
        </div>
      </div>
      <p class="solo-map__legend">☎ — здесь можно сохраниться · красным — заперто · ? — ещё не были<span class="solo-keys"> · клавиша M</span></p>
    </div>
  </div>
</template>
