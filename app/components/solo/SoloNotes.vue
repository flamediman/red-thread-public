<script setup lang="ts">
/* Записки: список слева, текст справа. Машинописный шрифт — бумаги так и выглядели. */
import type { SoloNote } from '#shared/types'

const props = defineProps<{ notes: SoloNote[] }>()
const emit = defineEmits<{ close: [] }>()
const open = ref(props.notes.at(-1)?.id ?? null)
const current = computed(() => props.notes.find(n => n.id === open.value) ?? null)
function onKey(e: KeyboardEvent) { if (e.code === 'Escape' || e.code === 'KeyJ') { e.preventDefault(); emit('close') } }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-veil" @click.self="emit('close')">
    <div class="solo-notes" role="dialog" aria-modal="true" aria-label="Записки">
      <div class="solo-notes__list">
        <p class="solo-label">Записки · {{ notes.length }}</p>
        <button v-for="n in [...notes].reverse()" :key="n.id" type="button" :class="{ on: open === n.id }" @click="open = n.id">{{ n.title }}</button>
        <p v-if="!notes.length" class="solo-muted">Пока ничего.</p>
      </div>
      <article v-if="current" class="solo-notes__paper">
        <h3>{{ current.title }}</h3>
        <p v-for="(para, i) in current.text.split('\n')" :key="i">{{ para || ' ' }}</p>
      </article>
      <button type="button" class="solo-map__close solo-notes__close" aria-label="Закрыть" @click="emit('close')">×</button>
    </div>
  </div>
</template>
