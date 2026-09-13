<script setup lang="ts">
import type { ClientMessage, PublicState, YouState } from '#shared/types'
import { ART } from '~/utils/art'

const props = defineProps<{ you: YouState; state: PublicState }>()
const emit = defineEmits<{ send: [ClientMessage]; edit: [] }>()

const readyCount = computed(() => props.state.players.filter(p => p.ready).length)
const roles = computed(() => props.state.detectives.map((d, i) => {
  const owner = props.state.players.find(p => p.detectiveId === d.id)
  return { ...d, num: i + 1, art: ART.detective(d.id), mine: owner?.id === props.you.id, takenBy: owner && owner.id !== props.you.id ? owner.name : null }
}))

function pick(id: string) {
  const r = roles.value.find(x => x.id === id)
  if (!r || r.takenBy) return
  emit('send', { type: 'pickDetective', detectiveId: r.mine ? null : id })
}
</script>

<template>
  <div class="pad-lobby">
    <p class="label" style="text-align:center">Вы в бригаде</p>
    <h1 class="display pad-lobby__name">{{ you.name }}</h1>
    <p class="pad-lobby__wait">Собрались: <b class="tabnum">{{ state.players.length }}</b> · готовы: <b class="tabnum">{{ readyCount }}</b></p>

    <p class="label">Кем вы будете</p>
    <p v-if="state.settings.roles === 'random'" class="pad-lobby__random">Роли раздаст случай при старте. Своего сыщика и его способность вы увидите на телефоне — кнопка вверху.</p>
    <div v-else class="pad-lobby__roles">
      <button
        v-for="r in roles"
        :key="r.id"
        type="button"
        class="role"
        :class="{ 'role--mine': r.mine, 'role--taken': !!r.takenBy }"
        :disabled="!!r.takenBy"
        @click="pick(r.id)"
      >
        <img class="face" :src="r.art" :alt="r.title">
        <span>
          <span class="role__title">{{ r.title }}</span>
          <span class="role__who"> · {{ r.name }}</span>
          <span class="role__ability">{{ r.ability.text }}</span>
          <span class="role__example">Пример: {{ r.ability.example }}</span>
        </span>
        <span v-if="r.takenBy" class="role__taken">{{ r.takenBy }}</span>
        <span v-else-if="r.mine" class="role__taken">вы</span>
      </button>
    </div>

    <button
      class="btn pad-lobby__ready"
      :class="{ 'btn--ghost': you.ready }"
      type="button"
      @click="emit('send', { type: 'ready', ready: !you.ready })"
    >
      {{ you.ready ? 'Готов — отменить' : 'Я готов' }}
    </button>
    <button class="pad-lobby__edit" type="button" @click="emit('edit')">Изменить фото, имя или краску</button>
  </div>
</template>
