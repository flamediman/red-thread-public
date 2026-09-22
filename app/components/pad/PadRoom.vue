<script setup lang="ts">
/* Телефон в сети без комнаты: код с экрана ведущего. Обычно сюда не попадают — QR уже несёт код в ссылке. */
/* pin — комната найдена, но вошли не по QR: нужен ПИН с экрана ведущего */
const props = defineProps<{ reason: string; code: string | null; pin?: boolean }>()
const emit = defineEmits<{ enter: [string]; pin: [string] }>()
const pinRaw = ref('')
const raw = ref(props.code ?? '')
/* «abcdef» → «ABC DEF» прямо в поле: так проще сверять с экраном */
const typeCode = onCodeInput(raw), typePin = onPinInput(pinRaw)
const canEnter = computed(() => raw.value.length === 6)
</script>

<template>
  <form v-if="pin" class="join room-entry" @submit.prevent="pinRaw.length === 4 && emit('pin', pinRaw)">
    <div class="join__brand"><span class="eyebrow">Кооперативный детектив</span></div>
    <h1 class="display join__title join__title--brand">Красная нить</h1>
    <p class="room-entry__lede">Комната <b class="tabnum">{{ code }}</b>. Вошли без QR — введите ПИН, он на экране под кодом комнаты.</p>
    <input :value="pinRaw" class="join__name room-entry__code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="0000" maxlength="4" enterkeyhint="go" aria-label="ПИН комнаты" @input="typePin">
    <p class="join__note" :class="{ 'join__note--error': reason }">{{ reason || 'Четыре цифры' }}</p>
    <button class="btn join__submit" type="submit" :disabled="pinRaw.length !== 4">Войти</button>
  </form>
  <form v-else class="join room-entry" @submit.prevent="canEnter && emit('enter', raw)">
    <div class="join__brand"><span class="eyebrow">Кооперативный детектив</span></div>
    <h1 class="display join__title join__title--brand">Красная нить</h1>
    <p class="room-entry__lede">Код комнаты — на экране ведущего, под QR‑кодом.</p>
    <input
      :value="formatRoom(raw)"
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
      @input="typeCode"
    >
    <p class="join__note" :class="{ 'join__note--error': reason }">{{ reason || 'Шесть знаков, буквы и цифры' }}</p>
    <button class="btn join__submit" type="submit" :disabled="!canEnter">Войти</button>
  </form>
</template>
