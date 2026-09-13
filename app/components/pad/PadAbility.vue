<script setup lang="ts">
/* Способность со счётчиком — действие сверх хода: её можно выбрать до хода, после хода или вместе с ним. */
import type { ClientMessage, PlanAction, PublicState, YouState } from '#shared/types'
import type { AbilityMode } from '~/utils/ability'

const props = defineProps<{ you: YouState; state: PublicState }>()
const emit = defineEmits<{ send: [ClientMessage]; open: [AbilityMode] }>()

const kind = computed(() => props.you.ability?.kind ?? null)
const uses = computed(() => props.you.usesLeft ?? 0)
const unchecked = computed(() => props.state.board.cards.filter(c => c.kind === 'testimony' && !c.verdict))

const available = computed(() => uses.value > 0 && (
  kind.value === 'intern' || kind.value === 'fixer' || kind.value === 'drone' || kind.value === 'coroner' || kind.value === 'patrol' || kind.value === 'reporter'
  || (kind.value === 'archivist' && props.state.board.cards.length > 0) || (kind.value === 'tracker' && unchecked.value.length > 0)))

const bonus = (action: PlanAction) => emit('send', { type: 'bonus', action })
</script>

<template>
  <div v-if="you.bonus" class="plan__bonus">
    <span class="plan__tag">Способность сверх хода</span>
    <b>{{ you.bonus.label }}</b>
    <button class="plan__bonus-undo" type="button" @click="emit('send', { type: 'unbonus' })">убрать</button>
  </div>
  <div v-else-if="available" class="plan__group">
    <p class="plan__tag">Способность — сверх хода · осталось {{ uses }}</p>
    <button v-if="kind === 'intern'" type="button" class="plan__act plan__act--ability" @click="bonus({ type: 'intern' })">
      <span>Подслушать разговор <small>на доску ляжет то, о чём свидетели шепчутся между собой</small></span>
    </button>
    <button v-if="kind === 'fixer'" type="button" class="plan__act plan__act--ability" :disabled="!you.market.length" @click="bonus({ type: 'fixer' })">
      <span>Достать улику через фиксера <small>{{ you.market.length ? `сейчас можно достать: «${you.market[0]!.name}»` : 'рынок пуст — всё уже у команды' }}</small></span>
    </button>
    <button v-if="kind === 'drone'" type="button" class="plan__act plan__act--ability" @click="emit('open', 'drone')">
      <span>Поднять дрон <small>ещё один осмотр в любой комнате — кроме вашего хода</small></span>
    </button>
    <button v-if="kind === 'coroner'" type="button" class="plan__act plan__act--ability" @click="bonus({ type: 'coroner' })">
      <span>Медицинское заключение <small>на доску ляжет заключение эксперта по главной улике дела</small></span>
    </button>
    <button v-if="kind === 'patrol'" type="button" class="plan__act plan__act--ability" @click="emit('open', 'summon')">
      <span>Вызвать на допрос <small>ещё один вопрос любому свидетелю — где бы он ни был</small></span>
    </button>
    <button v-if="kind === 'reporter'" type="button" class="plan__act plan__act--ability" @click="emit('open', 'reporter')">
      <span>Позвонить в редакцию <small>прошлое любого свидетеля ляжет на доску</small></span>
    </button>
    <button v-if="kind === 'archivist' && state.board.cards.length" type="button" class="plan__act plan__act--ability" @click="emit('open', 'archivist')">
      <span>Поднять архив <small>выберите карточку — архив скажет, где искать то, что ей противоречит</small></span>
    </button>
    <button v-if="kind === 'tracker' && unchecked.length" type="button" class="plan__act plan__act--ability" @click="emit('open', 'verify')">
      <span>Проверить показание <small>правда или ложь — пометку увидит вся команда</small></span>
    </button>
  </div>
</template>
