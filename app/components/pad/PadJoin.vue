<script setup lang="ts">
import { INKS } from '#shared/inks'
import type { Player } from '#shared/types'
import { ART } from '~/utils/art'

const props = defineProps<{
  players: Player[]
  savedName: string
  /** дело уже выбрано — показываем его обложку и название; иначе бренд игры */
  caseTitle?: string | null
  /** режим правки: что у игрока сейчас */
  editing?: { id: string; name: string; ink: number; photo: string | null; photoVersion: number | null }
}>()
const emit = defineEmits<{ join: [string, number, string | null, boolean]; back: [] }>()
/* в сети фото выключены: персональные данные не собираем */
const { config } = useConfig()

const name = ref(props.editing?.name ?? props.savedName)
const photo = ref<string | null>(props.editing?.photo ?? null)
const photoChanged = ref(false)

/** Что показать в кружке: новый снимок, иначе то, что уже лежит на сервере. */
const preview = computed(() => {
  if (photo.value) return photo.value
  const e = props.editing
  return e && e.photoVersion != null ? `/api/photo/${e.id}?v=${e.photoVersion}` : null
})
const busy = ref(false)
const error = ref('')

const taken = computed(() => new Set(props.players.filter(p => p.id !== props.editing?.id).map(p => p.ink)))
const ink = ref(props.editing ? props.editing.ink : INKS.findIndex((_, i) => !taken.value.has(i)))

watch(taken, (set) => {
  if (set.has(ink.value)) ink.value = INKS.findIndex((_, i) => !set.has(i))
})

const canJoin = computed(() => name.value.trim().length >= 1 && ink.value >= 0)

const note = computed(() => {
  if (error.value) return error.value
  if (!config.value.photos) return ''
  if (!preview.value) return 'Фото по желанию — с ним вас узнают на экране'
  return 'Если не нравится — нажмите «Переснять»'
})

async function shrink(file: File): Promise<string> {
  const SIDE = 360
  const canvas = document.createElement('canvas')
  canvas.width = SIDE
  canvas.height = SIDE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('нет canvas')

  let source: ImageBitmap | HTMLImageElement
  let width: number
  let height: number

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    source = bitmap
    width = bitmap.width
    height = bitmap.height
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('картинка не открылась'))
        img.src = url
      })
      source = img
      width = img.naturalWidth
      height = img.naturalHeight
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const side = Math.min(width, height)
  ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, SIDE, SIDE)
  return canvas.toDataURL('image/jpeg', 0.75)
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  busy.value = true
  error.value = ''
  try {
    photo.value = await shrink(file)
    photoChanged.value = true
  } catch {
    error.value = 'Не получилось обработать снимок. Попробуйте ещё раз.'
  } finally {
    busy.value = false
  }
}

function submit() {
  if (!canJoin.value) return
  emit('join', name.value.trim().slice(0, 14), ink.value, photo.value, photoChanged.value)
}
</script>

<template>
  <form class="join" @submit.prevent="submit">
    <div v-if="!editing && caseTitle" class="join__cover"><img :src="ART.cover" alt=""></div>
    <div v-else-if="!editing" class="join__brand"><span class="eyebrow">Кооперативный детектив</span></div>
    <h1 class="display join__title" :class="{ 'join__title--brand': !caseTitle && !editing }">{{ editing ? 'Ваш профиль' : caseTitle ?? 'Красная нить' }}</h1>

    <label v-if="config.photos" class="shot" :class="{ 'shot--filled': preview, 'shot--busy': busy }">
      <input
        class="shot__input"
        type="file"
        accept="image/*"
        capture="user"
        @change="onFile"
      >
      <img v-if="preview" class="shot__img" :src="preview" alt="Ваш снимок">
      <span v-else class="shot__placeholder">
        <svg class="shot__icon" viewBox="0 0 48 48" aria-hidden="true">
          <path
            d="M6 14h9l3-5h12l3 5h9a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z"
            fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"
          />
          <circle cx="24" cy="27" r="8" fill="none" stroke="currentColor" stroke-width="3" />
        </svg>
      </span>
      <span class="shot__caption">{{ preview ? 'Переснять' : busy ? 'Секунду…' : 'Сфотографироваться' }}</span>
    </label>

    <p v-if="config.photos || error" class="join__note" :class="{ 'join__note--error': error }">{{ note }}</p>

    <input
      v-model="name"
      class="join__name"
      type="text"
      maxlength="14"
      autocomplete="off"
      autocapitalize="words"
      placeholder="Имя"
      enterkeyhint="done"
    >

    <p class="label join__label">Ваша краска</p>
    <div class="join__inks">
      <button
        v-for="(color, i) in INKS"
        :key="color"
        type="button"
        class="ink-swatch"
        :class="{ 'ink-swatch--active': ink === i, 'ink-swatch--taken': taken.has(i) }"
        :style="{ '--chip-ink': color }"
        :disabled="taken.has(i)"
        :aria-label="`Краска ${i + 1}`"
        @click="ink = i"
      />
    </div>

    <button class="btn join__submit" type="submit" :disabled="!canJoin">{{ editing ? 'Сохранить' : 'В игру' }}</button>
    <button v-if="editing" class="join__back" type="button" @click="emit('back')">
      Назад, ничего не менять
    </button>
  </form>
</template>
