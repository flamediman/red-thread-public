<script setup lang="ts">
/* Телефон во время обучения: тот же шаг коротко и свой сыщик — пока ведущий объясняет, каждый узнаёт свою способность. */
import type { PublicState, YouState } from '#shared/types'
import { TUTORIAL_STEPS } from '#shared/tutorial'
import { ART } from '~/utils/art'
import { tutorialSteps } from '~/utils/tutorial'
import { abilityUses } from '~/utils/ability'

const props = defineProps<{ you: YouState; state: PublicState }>()
const step = computed(() => tutorialSteps(props.state.setting.crew, props.state.caseInfo.mode, Number(props.state.settings.duration))[Math.min(props.state.tutorialStep, TUTORIAL_STEPS - 1)]!)
const role = computed(() => props.state.detectives.find(d => d.id === props.you.detectiveId) ?? null)
const usesText = computed(() => abilityUses(role.value?.ability))
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
