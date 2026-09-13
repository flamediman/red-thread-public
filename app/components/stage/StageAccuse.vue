<script setup lang="ts">
import type { PublicState } from '#shared/types'
import { ART } from '~/utils/art'

const props = defineProps<{ state: PublicState; secondsLeft: number | null }>()

const votes = computed(() => Object.values(props.state.accusation?.votes ?? {}))
const tally = (field: 'culprit' | 'method' | 'motive', id: string) => votes.value.filter(v => v[field] === id).length
const lead = (field: 'culprit' | 'method' | 'motive', id: string) => {
  const n = tally(field, id)
  if (!n) return false
  return votes.value.every(v => !v[field] || tally(field, v[field]!) <= n)
}
const voters = computed(() => props.state.players.filter(p => p.connected).length)
const complete = computed(() => votes.value.filter(v => v.culprit && v.method && v.motive).length)
const caller = computed(() => props.state.players.find(p => p.id === props.state.accusation?.calledBy)?.name)
</script>

<template>
  <div class="accuse">
    <div>
      <span class="stamp">Обвинение</span>
      <h2 class="display accuse__title">{{ state.caseInfo.stage.gather }}</h2>
      <p class="accuse__lede">
        <template v-if="state.accusation?.calledBy === 'dawn'">{{ state.caseInfo.outcomes.dawnAccuse }}</template>
        <template v-else>{{ caller ?? 'Кто-то из команды' }} собирает всех. Каждый сыщик голосует на телефоне: кто, чем и почему. Решает большинство.</template>
        <template v-if="state.attemptsLeft < 2"> Это последняя попытка.</template>
      </p>
    </div>
    <div class="accuse__cols">
      <div class="accuse__col">
        <p class="label">Кто</p>
        <div v-for="w in state.witnesses" :key="w.id" class="accuse__opt" :class="{ 'accuse__opt--lead': lead('culprit', w.id) }">
          <img class="face" :src="ART.witness(w.id)" :alt="w.name">
          <span>{{ w.name }}</span><b class="tabnum">{{ tally('culprit', w.id) || '' }}</b>
        </div>
      </div>
      <div class="accuse__col">
        <p class="label">Чем</p>
        <div v-for="m in state.accusationOptions.methods" :key="m.id" class="accuse__opt accuse__opt--noface" :class="{ 'accuse__opt--lead': lead('method', m.id) }">
          <span>{{ m.text }}</span><b class="tabnum">{{ tally('method', m.id) || '' }}</b>
        </div>
      </div>
      <div class="accuse__col">
        <p class="label">Почему</p>
        <div v-for="m in state.accusationOptions.motives" :key="m.id" class="accuse__opt accuse__opt--noface" :class="{ 'accuse__opt--lead': lead('motive', m.id) }">
          <span>{{ m.text }}</span><b class="tabnum">{{ tally('motive', m.id) || '' }}</b>
        </div>
      </div>
    </div>
    <p class="accuse__status">Проголосовали полностью {{ complete }} из {{ voters }}<template v-if="secondsLeft != null"> · осталось {{ secondsLeft }} с</template></p>
  </div>
</template>
