<script setup lang="ts">
/* Режим игры — плашкой со значком: «По ходам» (раунды), «Живое время» (все действуют одновременно), «В одиночку».
   explain — строка под плашкой: чем режим отличается, в двух словах */
const props = defineProps<{ mode: 'rounds' | 'realtime' | 'solo'; explain?: boolean }>()
const MODES = {
  rounds: { name: 'По ходам', text: 'совещаетесь, потом ходите — спешки нет' },
  realtime: { name: 'Живое время', text: 'все ищут одновременно, часы не ждут' },
  solo: { name: 'В одиночку', text: 'хоррор-приключение, наушники и темнота' }
} as const
const m = computed(() => MODES[props.mode])
</script>

<template>
  <span class="mode-chip" :class="`mode-chip--${mode}`">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path v-if="mode === 'rounds'" d="M4 19h4v-4h4v-4h4V7h4M4 19v2M20 7V3" />
      <path v-else-if="mode === 'realtime'" d="M12 8v5l3 2M9 2h6M12 2v3M5.5 13a6.5 6.5 0 1013 0 6.5 6.5 0 00-13 0z" />
      <path v-else d="M4 15v-3a8 8 0 0116 0v3M4 15a2 2 0 002 2h1v-5H6a2 2 0 00-2 2zM20 15a2 2 0 01-2 2h-1v-5h1a2 2 0 012 2z" />
    </svg>
    <b>{{ m.name }}</b>
    <small v-if="explain">{{ m.text }}</small>
  </span>
</template>
