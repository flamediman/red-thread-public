<script setup lang="ts">
/* Телефон во время обучения: тот же шаг коротко и свой сыщик — пока ведущий объясняет, каждый узнаёт свою способность. */
import type { PublicState, YouState } from '#shared/types'
import { TUTORIAL_STEPS } from '#shared/tutorial'
import { ART } from '~/utils/art'
import { tutorialSteps } from '~/utils/tutorial'

const props = defineProps<{ you: YouState; state: PublicState }>()
const step = computed(() => tutorialSteps(props.state.setting.crew)[Math.min(props.state.tutorialStep, TUTORIAL_STEPS - 1)]!)
const role = computed(() => props.state.detectives.find(d => d.id === props.you.detectiveId) ?? null)
/** способности, которые — действие сверх хода (остальные со счётчиком срабатывают внутри обычного хода) */
const EXTRA = new Set(['drone', 'patrol', 'reporter', 'intern', 'fixer', 'archivist', 'tracker', 'coroner'])
const usesText = computed(() => {
  const a = role.value?.ability
  if (!a || a.uses == null) return 'Работает сама, всегда.'
  const times = `${a.uses} ${a.uses === 1 ? 'раз' : 'раза'} за ночь`
  return EXTRA.has(a.kind) ? `Сверх хода, ${times}.` : `${times[0]!.toUpperCase()}${times.slice(1)}.`
})
</script>

<template>
  <div class="pad-tutorial">
    <span class="label tabnum">Как играть · {{ state.tutorialStep + 1 }} из {{ TUTORIAL_STEPS }}</span>
    <Transition name="fade" mode="out-in">
      <div :key="step.id" class="pad-tutorial__step">
        <h1 class="display pad-tutorial__title">{{ step.title }}</h1>
        <p class="pad-tutorial__text">{{ step.phone }}</p>
      </div>
    </Transition>
    <div v-if="role" class="pad-tutorial__role" :class="{ 'pad-tutorial__role--on': step.id === 'roles' }">
      <div class="veil__role">
        <img class="face" :src="ART.detective(role.id)" alt="">
        <div><h2 class="veil__title">{{ role.title }}</h2><p class="veil__who">{{ role.name }}</p></div>
      </div>
      <p><b>Способность.</b> {{ role.ability.text }}</p>
      <p class="pad-tutorial__example"><b>Пример.</b> {{ role.ability.example }}</p>
      <p class="pad-tutorial__uses">{{ usesText }}</p>
    </div>
    <p class="wait__foot">Ведущий листает обучение на экране.</p>
  </div>
</template>
