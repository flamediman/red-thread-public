<script setup lang="ts">
import type { ClientMessage, PublicState, YouState } from '#shared/types'
import { ART } from '~/utils/art'

const props = defineProps<{ you: YouState; state: PublicState; secondsLeft: number | null }>()
const emit = defineEmits<{ send: [ClientMessage] }>()

const mine = computed(() => props.state.accusation?.votes[props.you.id] ?? {})
const done = computed(() => !!(mine.value.culprit && mine.value.method && mine.value.motive))
</script>

<template>
  <div class="vote">
    <h1 class="display vote__title">Кто, чем и почему</h1>
    <p class="wait__text" style="text-align:left">Голосует каждый. Решает большинство.<template v-if="secondsLeft != null"> Осталось {{ secondsLeft }} с.</template></p>

    <p class="label">Кто</p>
    <div class="vote__group">
      <button v-for="w in state.witnesses" :key="w.id" type="button" class="vote__opt" :class="{ 'vote__opt--on': mine.culprit === w.id }" @click="emit('send', { type: 'vote', culprit: w.id })">
        <img class="face" :src="ART.witness(w.id)" alt="">
        <span>{{ w.name }} <small>— {{ w.role }}</small></span>
      </button>
    </div>

    <p class="label">Чем</p>
    <div class="vote__group">
      <button v-for="m in state.accusationOptions.methods" :key="m.id" type="button" class="vote__opt vote__opt--plain" :class="{ 'vote__opt--on': mine.method === m.id }" @click="emit('send', { type: 'vote', method: m.id })">{{ m.text }}</button>
    </div>

    <p class="label">Почему</p>
    <div class="vote__group">
      <button v-for="m in state.accusationOptions.motives" :key="m.id" type="button" class="vote__opt vote__opt--plain" :class="{ 'vote__opt--on': mine.motive === m.id }" @click="emit('send', { type: 'vote', motive: m.id })">{{ m.text }}</button>
    </div>

    <p class="vote__hint">{{ done ? 'Ваш голос учтён. Можно передумать, пока идёт время.' : 'Выберите по одному пункту в каждом списке.' }}</p>
  </div>
</template>
