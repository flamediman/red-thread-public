<script setup lang="ts">
/* Туман поверх кадра: несколько полупрозрачных слоёв медленно дрейфуют навстречу друг другу, плюс зерно плёнки.
   Только transform и opacity — дёшево для планшета. */
withDefaults(defineProps<{ density?: number; other?: boolean }>(), { density: 1, other: false })
</script>

<template>
  <div class="solo-fog" :class="{ 'solo-fog--other': other }" :style="{ '--fog': density }" aria-hidden="true">
    <i class="solo-fog__layer solo-fog__layer--a" />
    <i class="solo-fog__layer solo-fog__layer--b" />
    <i class="solo-fog__layer solo-fog__layer--c" />
    <i class="solo-fog__grain" />
  </div>
</template>
