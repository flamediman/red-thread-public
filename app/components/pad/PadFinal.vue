<script setup lang="ts">
import type { PublicState, YouState } from '#shared/types'
import { ART } from '~/utils/art'

const props = defineProps<{ you: YouState; state: PublicState }>()
const { config } = useConfig()

const title = computed(() => props.state.outcome === 'failed' ? props.state.caseInfo.outcomes.failedTitle : props.state.outcome === 'partial' ? 'Закрыто с оговорками' : 'Дело закрыто')
const sub = computed(() => props.state.outcome === 'failed'
  ? props.state.caseInfo.outcomes.phoneFailed
  : 'Спасибо за ночь. Смотрите на экран — там рассказывают, как всё было.')
</script>

<template>
  <div class="pad-final">
    <img class="pad-final__cover" :src="ART.dawn" alt="">
    <span class="stamp">Итог</span>
    <h1 class="display pad-final__title">{{ title }}</h1>
    <p class="pad-final__sub">{{ sub }}</p>
    <p class="wait__foot">{{ you.name }} · {{ state.detectives.find(d => d.id === you.detectiveId)?.title ?? 'сыщик' }}</p>
    <div v-if="config.telegram || config.donate || config.bot" class="pad-links">
      <p>Понравилось? Расскажите в канале и выберите, каким будет следующее дело.</p>
      <a v-if="config.telegram" class="btn" :href="config.telegram" target="_blank" rel="noopener">Канал игры в Telegram</a>
      <a v-if="config.bot" class="btn btn--ghost" :href="`${config.bot}?start=review`" target="_blank" rel="noopener">Поделиться впечатлениями</a>
      <a v-if="config.donate" class="btn btn--ghost" :href="config.donate" target="_blank" rel="noopener">Поддержать проект</a>
    </div>
  </div>
</template>
