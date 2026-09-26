<script setup lang="ts">
/* Записки: список слева, текст справа. Машинописный шрифт — бумаги так и выглядели. */
import type { SoloView } from '#shared/types'

/* focus — какую записку открыть сразу: «Прочитать» на карточке находки или та, что была открыта в прошлый раз (страница
   помнит её — в загадке не приходится каждый раз искать нужную). Такой нет — самая свежая. Открытая считается прочитанной */
const props = defineProps<{ notes: SoloView['notes']; focus?: string | null }>()
const emit = defineEmits<{ close: []; read: [string]; pick: [string] }>()
const open = ref((props.focus && props.notes.some(n => n.id === props.focus) ? props.focus : null) ?? props.notes.at(-1)?.id ?? null)
const current = computed(() => props.notes.find(n => n.id === open.value) ?? null)
/* памятки к загадкам — отдельно сверху; бумаги — свежие первыми */
const groups = computed(() => [
  { label: 'Памятки', notes: [...props.notes].reverse().filter(n => n.kind === 'memo') },
  { label: 'Бумаги', notes: [...props.notes].reverse().filter(n => n.kind !== 'memo') }
].filter(g => g.notes.length))
watch(open, id => { const n = props.notes.find(x => x.id === id); if (!n) return; emit('pick', n.id); if (!n.read) emit('read', n.id) }, { immediate: true })
/* открытая записка видна в списке сразу, даже если список длинный */
const list = ref<HTMLElement | null>(null)
onMounted(() => list.value?.querySelector<HTMLElement>('button.on')?.scrollIntoView({ block: 'nearest' }))
function onKey(e: KeyboardEvent) { if (e.code === 'Escape' || e.code === 'KeyJ') { e.preventDefault(); emit('close') } }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-veil solo-veil--notes" @click.self="emit('close')">
    <div class="solo-notes" role="dialog" aria-modal="true" aria-label="Записки">
      <div ref="list" class="solo-notes__list">
        <p class="solo-label">Записки · {{ notes.length }}</p>
        <template v-for="g in groups" :key="g.label">
          <p class="solo-notes__group">{{ g.label }}</p>
          <button v-for="n in g.notes" :key="n.id" type="button" :class="{ on: open === n.id, unread: !n.read && open !== n.id }" @click="open = n.id">
            <i v-if="!n.read && open !== n.id" class="solo-notes__dot" aria-label="не прочитано" />{{ n.title }}<small v-if="n.where">{{ n.where }}</small>
          </button>
        </template>
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
