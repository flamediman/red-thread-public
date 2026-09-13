<script setup lang="ts">
/* Телефон в сети без комнаты: код с экрана ведущего. Обычно сюда не попадают — QR уже несёт код в ссылке. */
const props = defineProps<{ reason: string; code: string | null }>()
const emit = defineEmits<{ enter: [string] }>()

const raw = ref(props.code ?? '')
/** «abcdef» → «ABC DEF» прямо в поле: так проще сверять с экраном */
const shown = computed({
  get: () => { const c = raw.value; return c.length > 3 ? `${c.slice(0, 3)} ${c.slice(3)}` : c },
  set: (v: string) => { raw.value = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) }
})
const canEnter = computed(() => raw.value.length === 6)
</script>

<template>
  <form class="join room-entry" @submit.prevent="canEnter && emit('enter', raw)">
    <div class="join__brand"><span class="eyebrow">Кооперативный детектив</span></div>
    <h1 class="display join__title join__title--brand">Красная нить</h1>
    <p class="room-entry__lede">Код комнаты — на экране ведущего, под QR‑кодом.</p>
    <input
      v-model="shown"
      class="join__name room-entry__code"
      type="text"
      inputmode="text"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      placeholder="ABC DEF"
      maxlength="7"
      enterkeyhint="go"
      aria-label="Код комнаты"
    >
    <p class="join__note" :class="{ 'join__note--error': reason }">{{ reason || 'Шесть знаков, буквы и цифры' }}</p>
    <button class="btn join__submit" type="submit" :disabled="!canEnter">Войти</button>
  </form>
</template>
