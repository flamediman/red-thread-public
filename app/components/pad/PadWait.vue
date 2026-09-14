<script setup lang="ts">
import type { ClientMessage, PublicState, YouState } from '#shared/types'
import { ART, tilt } from '~/utils/art'
import { KIND_LABEL } from '~/composables/useBoardFilter'

const props = defineProps<{ you: YouState; state: PublicState; secondsLeft: number | null }>()
const emit = defineEmits<{ send: [ClientMessage] }>()

const tab = ref<'board' | 'items'>('board')
const screen = computed(() => props.state.screen)

const text = computed(() => (({
  menu: 'Ведущий выбирает дело. Подождите немного.',
  prologue: 'Смотрите на большой экран — там начинается история.',
  resolve: 'Разбор ходов на экране. Слушайте — там ответы.',
  discuss: 'Совещание. Спорьте, читайте доску, решайте, куда идти дальше.',
  verdict: 'Вердикт читают на экране.',
  epilogue: 'Как это было на самом деле — на экране.'
} as Record<string, string>)[screen.value] ?? 'Смотрите на экран.'))

const f = useBoardFilter(computed(() => props.state))
/* на телефоне свежие сверху, отмеченные командой — первыми */
const cards = computed(() => [...f.visible.value].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.round - a.round))
const open = ref<Set<string>>(new Set())
function toggle(id: string) { const s = new Set(open.value); if (s.has(id)) s.delete(id); else s.add(id); open.value = s }
const sourceOf = (c: { witnessId?: string; locationId?: string; by: string }) =>
  props.state.witnesses.find(w => w.id === c.witnessId)?.name ?? props.state.locations.find(l => l.id === c.locationId)?.name ?? c.by

const confirmAccuse = ref(false)
</script>

<template>
  <div class="pad-board">
    <div v-if="screen !== 'discuss'" class="wait" style="flex: 0 0 auto; padding: 0.6rem 0">
      <div class="wait__icon" />
      <p class="wait__text">{{ text }}</p>
    </div>
    <template v-else>
      <p class="wait__text" style="text-align:center">{{ text }}<template v-if="state.settings.timers === 'on' && secondsLeft != null"> · {{ secondsLeft }} с</template></p>
      <div class="pad-board__actions">
        <button class="btn btn--small pad-board__proceed" :class="you.proceeded ? 'pad-board__proceed--on' : 'btn--ghost'" style="flex:1" type="button" :aria-pressed="you.proceeded" @click="emit('send', { type: 'proceed' })">
          {{ you.proceeded ? '✓ Вы за «дальше»' : 'Дальше' }} · {{ state.proceedVotes }} из {{ state.players.filter(p => p.connected).length }}
        </button>
        <button class="btn btn--stamp btn--small" style="flex:1" type="button" @click="confirmAccuse = true">Собрать всех</button>
      </div>
    </template>

    <div class="pad-board__tabs">
      <button type="button" class="pad-board__tab" :class="{ 'pad-board__tab--on': tab === 'board' }" @click="tab = 'board'">Доска · {{ f.cards.value.length }}</button>
      <button type="button" class="pad-board__tab" :class="{ 'pad-board__tab--on': tab === 'items' }" @click="tab = 'items'">Улики · {{ you.items.length }}</button>
    </div>

    <template v-if="tab === 'board'">
      <!-- фильтры листаются вбок -->
      <div v-if="f.cards.value.length" class="pad-filters">
        <button v-for="v in f.views.value" :key="v.id" type="button" class="chip" :class="{ 'chip--on': f.view.value === v.id }" :disabled="!v.count && v.id !== 'all'" @click="f.view.value = v.id">
          {{ v.label }} <b>{{ v.count }}</b>
        </button>
        <button v-for="k in f.kinds.value" :key="k.id" type="button" class="chip" :class="[`chip--${k.id}`, { 'chip--on': f.kind.value === k.id }]" @click="f.kind.value = f.kind.value === k.id ? null : k.id">
          <i class="chip__dot" />{{ k.label }} <b>{{ k.count }}</b>
        </button>
      </div>
      <div v-if="f.people.value.length || f.places.value.length" class="pad-filters">
        <button v-for="p in f.people.value" :key="p.id" type="button" class="chip chip--face" :class="{ 'chip--on': f.source.value === p.id }" @click="f.source.value = f.source.value === p.id ? null : p.id">
          <img class="face" :src="ART.witness(p.witnessId)" alt="">{{ p.label }} <b>{{ p.count }}</b>
        </button>
        <button v-for="p in f.places.value" :key="p.id" type="button" class="chip" :class="{ 'chip--on': f.source.value === p.id }" @click="f.source.value = f.source.value === p.id ? null : p.id">
          {{ p.label }} <b>{{ p.count }}</b>
        </button>
      </div>

      <div class="pad-board__list" :class="{ 'pad-board__list--pending': f.pending.value }">
        <div v-for="l in f.visibleLinks.value" :key="l.id" class="board__link">{{ l.text }}</div>
        <p v-if="!f.cards.value.length" class="lobby__empty">Пока пусто.</p>
        <p v-else-if="!cards.length" class="lobby__empty">Под этот фильтр ничего не подходит. <button type="button" class="pad-board__reset" @click="f.reset()">Сбросить</button></p>
        <div
          v-for="c in cards"
          :key="c.id"
          class="mcard"
          :class="[`mcard--${c.kind}`, { 'mcard--open': open.has(c.id), 'mcard--linked': f.linked.value.has(c.id), 'mcard--new': c.round === f.lastRound.value }]"
        >
          <button type="button" class="mcard__main" @click="toggle(c.id)">
            <i class="mcard__kind" :title="KIND_LABEL[c.kind]" />
            <span class="mcard__title">{{ c.title }}</span>
            <span class="mcard__meta">
              {{ sourceOf(c) }} · {{ c.time ?? `раунд ${c.round + 1}` }}
              <template v-if="c.verdict?.lie"> · <b class="mcard__lie">{{ c.verdict.by.toLowerCase() }}: ложь</b></template>
              <template v-else-if="c.verdict"> · <b class="mcard__truth">{{ c.verdict.by.toLowerCase() }}: правда</b></template>
            </span>
            <span v-if="open.has(c.id)" class="mcard__detail">{{ c.detail }}</span>
          </button>
          <button type="button" class="mcard__pin" :class="{ 'mcard__pin--on': c.pinned }" :aria-label="c.pinned ? 'Снять отметку' : 'Отметить как важное'" @click="emit('send', { type: 'pin', factId: c.id })">★</button>
        </div>
      </div>
    </template>

    <div v-else class="pad-board__items">
      <p v-if="!you.items.length" class="lobby__empty">Предметов пока нет — их находят при осмотре.</p>
      <div v-for="i in you.items" :key="i.id" class="pad-board__item">
        <img class="pad-board__thumb" :src="ART.item(i.id)" alt="" :style="{ '--tilt': tilt(i.id, 3) }">
        <div><b>{{ i.name }}</b><small>{{ i.description }}</small></div>
      </div>
    </div>

    <div v-if="confirmAccuse" class="veil" @click.self="confirmAccuse = false">
      <div class="veil__card" role="dialog" aria-modal="true">
        <h2 class="veil__title">Собрать всех для обвинения?</h2>
        <p class="veil__text">Все проголосуют: кто, чем и почему. Попыток всего две — после второй ошибки дело закроют без вас. Осталось попыток: {{ state.attemptsLeft }}.</p>
        <div class="veil__actions">
          <button class="btn btn--ghost" @click="confirmAccuse = false">Ещё рано</button>
          <button class="btn btn--stamp" @click="confirmAccuse = false; emit('send', { type: 'callAccuse' })">Собрать</button>
        </div>
      </div>
    </div>
  </div>
</template>
