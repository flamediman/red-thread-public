<script setup lang="ts">
import type { ClientMessage, PublicState } from '#shared/types'

const props = defineProps<{ state: PublicState }>()
const emit = defineEmits<{ send: [ClientMessage] }>()

const grade = computed(() => {
  const s = props.state, o = s.caseInfo.outcomes
  if (s.outcome === 'failed') return { stamp: 'Дело не закрыто', title: o.failedTitle, sub: o.failedSub }
  if (s.outcome === 'partial') return { stamp: 'Закрыто с оговорками', title: 'Имя названо', sub: o.partialSub }
  // оценка — от доли потраченной ночи, чтобы одинаково работала при 10 и при 18 раундах
  const share = (s.round + 1) / Math.max(1, s.roundsTotal)
  if (share <= 0.6 && s.hintsUsed === 0) return { stamp: 'Золото', title: 'Дело закрыто', sub: o.solvedSub.gold }
  if (share <= 0.8 || s.hintsUsed <= 1) return { stamp: 'Серебро', title: 'Дело закрыто', sub: o.solvedSub.silver }
  return { stamp: 'Бронза', title: 'Дело закрыто', sub: o.solvedSub.bronze }
})
</script>

<template>
  <div class="final">
    <span class="stamp final__stamp">{{ grade.stamp }}</span>
    <h1 class="display final__title">{{ grade.title }}</h1>
    <p class="final__sub">{{ grade.sub }}</p>
    <div class="final__stats">
      <template v-if="state.field">
        <div><b class="tabnum">{{ state.field.questions.filter(q => q.solved).length }}</b>вопросов доски закрыто</div>
        <div><b class="tabnum">{{ state.board.cards.length }}</b>улик на доске</div>
        <div><b class="tabnum">{{ Math.round(state.field.penaltyMs / 1000) }}</b>секунд штрафа</div>
      </template>
      <template v-else>
        <div><b class="tabnum">{{ state.round + 1 }}</b>раундов</div>
        <div><b class="tabnum">{{ state.board.cards.length }}</b>улик на доске</div>
        <div><b class="tabnum">{{ state.board.links.length }}</b>противоречий</div>
      </template>
      <div><b class="tabnum">{{ state.hintsUsed }}</b>подсказок</div>
      <div><b class="tabnum">{{ 2 - state.attemptsLeft }}</b>ошибочных обвинений</div>
    </div>
    <button class="btn final__again" @click="emit('send', { type: 'restart' })">В лобби</button>
  </div>
</template>
