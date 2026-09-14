<script setup lang="ts">
/* Обучение на экране перед прологом: шесть шагов, ведущий листает пробелом или кнопками. */
import type { ClientMessage, PublicState } from '#shared/types'
import { TUTORIAL_STEPS } from '#shared/tutorial'
import { ART, tilt } from '~/utils/art'
import { tutorialSteps } from '~/utils/tutorial'

const props = defineProps<{ state: PublicState }>()
const emit = defineEmits<{ send: [ClientMessage] }>()

const steps = computed(() => tutorialSteps(props.state.setting.crew, props.state.caseInfo.mode, Number(props.state.settings.duration)))
const index = computed(() => Math.min(props.state.tutorialStep, steps.value.length - 1))
const step = computed(() => steps.value[index.value]!)
const go = (to: number) => emit('send', { type: 'tutorial', step: to })

const room = computed(() => props.state.locations[0])
const witness = computed(() => props.state.witnesses[0])
const brigade = computed(() => props.state.detectives.slice(0, 8))
</script>

<template>
  <div class="tutorial">
    <div class="tutorial__text">
      <span class="tutorial__count tabnum">Как играть · {{ index + 1 }} из {{ TUTORIAL_STEPS }}</span>
      <Transition name="fade" mode="out-in">
        <div :key="step.id">
          <h1 class="display tutorial__title">{{ step.title }}</h1>
          <p class="tutorial__lede">{{ step.text }}</p>
        </div>
      </Transition>
      <div class="tutorial__dots" aria-hidden="true">
        <i v-for="n in TUTORIAL_STEPS" :key="n" :class="{ on: n - 1 === index }" />
      </div>
      <div class="tutorial__actions">
        <button v-if="index > 0" class="btn btn--ghost" type="button" @click="go(index - 1)">Назад</button>
        <button class="btn btn--stamp" type="button" @click="go(index + 1)">{{ index + 1 < TUTORIAL_STEPS ? 'Дальше' : 'К истории' }}</button>
        <button v-if="index + 1 < TUTORIAL_STEPS" class="tutorial__skip" type="button" @click="go(TUTORIAL_STEPS)">пропустить обучение</button>
      </div>
      <p class="tutorial__hint">Пробел или → — дальше, ← — назад</p>
    </div>

    <Transition name="fade" mode="out-in">
      <div :key="step.id" class="tutorial__art" aria-hidden="true">
        <!-- 1: дело -->
        <div v-if="step.id === 'night'" class="tut-photo" :style="{ '--tilt': '-2.5deg' }">
          <img :src="ART.cover" alt="">
          <span class="stamp tut-photo__stamp">{{ state.caseInfo.stamp }}</span>
          <span class="tut-photo__cap">{{ state.caseInfo.title }}</span>
        </div>

        <!-- 2: телефон с выбором хода -->
        <div v-else-if="step.id === 'turn'" class="tut-phone">
          <div class="tut-phone__room" :style="{ '--art': room ? `url(${ART.location(room.id)})` : 'none' }"><b>{{ room?.name }}</b></div>
          <div class="tut-phone__row"><span>Осмотреть место</span><em>новое</em></div>
          <div class="tut-phone__row"><span>Спросить свидетеля</span><em>новое</em></div>
          <div class="tut-phone__row"><span>Показать улику</span></div>
          <div class="tut-phone__row tut-phone__row--dim"><span>Просто побыть здесь</span></div>
        </div>

        <!-- 3: разбор -->
        <div v-else-if="step.id === 'resolve'" class="tut-scene">
          <img v-if="witness" class="tut-scene__face" :src="ART.witness(witness.id)" alt="">
          <div class="tut-scene__bubble"><b>{{ witness?.name }}</b><span class="tut-scene__lines"><i /><i /><i /></span></div>
          <div class="card card--testimony tut-scene__card" :style="{ '--tilt': tilt('tut-card', 2) }"><i class="card__kind" /><div class="card__title">Новая карточка</div><div class="card__meta">раунд 1</div></div>
        </div>

        <!-- 4: нить -->
        <div v-else-if="step.id === 'thread'" class="tut-thread">
          <div class="card card--testimony tut-thread__a" style="--tilt: -3deg"><i class="card__kind" /><div class="card__title">«Всю ночь был дома»</div><div class="card__meta">показание</div><span class="card__verdict card__verdict--lie">ложь</span></div>
          <div class="card card--physical tut-thread__b" style="--tilt: 2deg"><i class="card__kind" /><div class="card__title">Следы у двери в 3:10</div><div class="card__meta">осмотр</div></div>
          <svg class="tut-thread__line" viewBox="0 0 400 200" preserveAspectRatio="none"><path d="M90 40 Q 200 190 310 70" /></svg>
          <span class="tut-thread__btn">Уличить во лжи</span>
        </div>

        <!-- 5: бригада -->
        <div v-else-if="step.id === 'roles'" class="tut-roles">
          <div v-for="(d, i) in brigade" :key="d.id" class="tut-roles__one" :style="{ '--i': i }">
            <img class="face" :src="ART.detective(d.id)" alt="">
            <span>{{ d.title }}</span>
          </div>
        </div>

        <!-- 6: обвинение -->
        <div v-else class="tut-accuse">
          <img class="tut-accuse__dawn" :src="ART.dawn" alt="">
          <div class="tut-accuse__chips"><span>Кто</span><span>Чем</span><span>Почему</span></div>
          <span class="stamp tut-accuse__stamp">две попытки</span>
        </div>
      </div>
    </Transition>
  </div>
</template>
