<script setup lang="ts">
import { INKS } from '#shared/inks'
import { ART } from '~/utils/art'

const props = withDefaults(defineProps<{
  id: string
  name: string
  ink: number
  photo: number | null
  /** без своего фото — портрет выбранного сыщика */
  detectiveId?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>(), { size: 'md', detectiveId: null })

const color = computed(() => INKS[props.ink] ?? INKS[0])
const failed = ref<string | null>(null)

const src = computed(() => {
  const s = props.photo ? `/api/photo/${props.id}?v=${props.photo}` : props.detectiveId ? ART.detective(props.detectiveId) : null
  return s && s !== failed.value ? s : null
})
const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || '?')
</script>

<template>
  <span class="avatar" :class="`avatar--${size}`" :style="{ '--chip-ink': color }">
    <img v-if="src" class="avatar__img" :src="src" :alt="name" loading="lazy" @error="failed = src">
    <span v-else class="avatar__initial">{{ initial }}</span>
    <i class="avatar__ring" />
  </span>
</template>
