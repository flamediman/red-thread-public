<script setup lang="ts">
import type { ClientMessage, PlanAction, PublicState, YouState } from '#shared/types'
import { ART } from '~/utils/art'
import type { AbilityMode } from '~/utils/ability'

const props = defineProps<{ you: YouState; state: PublicState; secondsLeft: number | null }>()
const emit = defineEmits<{ send: [ClientMessage] }>()

/** шаг выбора: куда идти, что делать в комнате или экран способности */
const locId = ref<string | null>(null)
const mode = ref<'where' | 'room' | AbilityMode>('where')
const pendingAsk = ref<{ witnessId: string; questionId: string; force: boolean } | null>(null)

const kind = computed(() => props.you.ability?.kind ?? null)
const uses = computed(() => props.you.usesLeft ?? 0)
const timed = computed(() => props.state.settings.timers === 'on')

const optionsOf = (id: string) => props.you.options.find(o => o.locationId === id) ?? null
const locName = (id: string) => props.state.locations.find(l => l.id === id)?.name ?? ''

/* плитки комнат по этажам: кто там и что можно сделать */
const floors = computed(() => props.state.floors.map(fl => ({
  ...fl,
  rooms: props.state.locations.filter(l => l.floor === fl.id).map(l => {
    const o = optionsOf(l.id)
    const open = o?.spots.filter(s => s.stage !== 'done' && (!s.locked || s.canUnlock)).length ?? 0
    const talk = o?.witnesses.reduce((n, w) => n + w.questions.filter(q => !q.asked && (!q.locked || q.canForce)).length + w.confronts.filter(c => !c.done).length, 0) ?? 0
    return { ...l, art: ART.location(l.id), faces: props.state.witnesses.filter(w => w.locationId === l.id), open, talk, here: props.you.locationId === l.id }
  })
})))

const room = computed(() => locId.value ? optionsOf(locId.value) : null)
const summary = computed(() => {
  const o = room.value
  if (!o) return ''
  const parts: string[] = []
  const spots = o.spots.filter(s => s.stage !== 'done').length
  if (spots) parts.push(`${spots} ${spots === 1 ? 'место осмотра' : 'места осмотра'}`)
  if (o.witnesses.length) parts.push(`${o.witnesses.length} ${o.witnesses.length === 1 ? 'человек' : 'человека'}`)
  return parts.length ? `Здесь: ${parts.join(' · ')}` : 'Здесь больше нечего делать — можно просто понаблюдать'
})

/** пометка места: неосмотренное без пометки — «новое» стояло бы на всём подряд */
const STAGE: Record<string, string> = { new: '', second: 'второй осмотр', memory: 'запись памяти', done: 'осмотрено' }
/** пометка вопроса: «новое» — только у открывшихся в прошлом разборе */
const qState = (q: { asked: boolean; locked: string | null; canForce: boolean; fresh: boolean }) =>
  q.asked ? { cls: 'done', label: 'спросили' } : q.locked ? (q.canForce ? { cls: 'force', label: 'можно' } : { cls: 'locked', label: 'закрыто' }) : q.fresh ? { cls: 'new', label: 'новое' } : null

function plan(action: PlanAction, at = locId.value ?? props.you.locationId) {
  emit('send', { type: 'plan', locationId: at, action })
  pendingAsk.value = null
}
/** способность сверх хода: после выбора — обратно туда, откуда пришли */
function bonus(action: PlanAction) {
  emit('send', { type: 'bonus', action })
  mode.value = locId.value ? 'room' : 'where'
}
function goRoom(id: string) { locId.value = id; mode.value = 'room'; pendingAsk.value = null }
function back() { locId.value = null; mode.value = 'where'; pendingAsk.value = null }
function closeAbility() { mode.value = locId.value ? 'room' : 'where' }

/* следователь: первый выбранный вопрос ждёт второго */
function askQ(witnessId: string, questionId: string, force = false) {
  if (kind.value === 'investigator' && !pendingAsk.value) { pendingAsk.value = { witnessId, questionId, force }; return }
  const first = pendingAsk.value
  if (first && first.questionId !== questionId) plan({ type: 'ask', witnessId: first.witnessId, questionId: first.questionId, second: questionId, force: first.force })
  else plan({ type: 'ask', witnessId, questionId, force })
}

/* улика, которую свидетелю пока нечем объяснить: по нажатию — что нужно */
const lockedItem = ref<string | null>(null)
/** ширина размытой строки закрытого вопроса — от id, чтобы строки не прыгали */
const blurWidth = (id: string) => `${55 + ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 40)}%`

/* все свидетели, где бы они ни были, — для вызова на допрос */
const everyone = computed(() => props.you.options.flatMap(o => o.witnesses.map(w => ({ ...w, locationId: o.locationId }))))
/* показания без проверки — для аналитика */
const unchecked = computed(() => props.state.board.cards.filter(c => c.kind === 'testimony' && !c.verdict))

/* дрон: все места, где осмотр что-то даст, во всех комнатах */
const droneTargets = computed(() => props.state.locations.map(l => ({
  ...l, spots: (optionsOf(l.id)?.spots ?? []).filter(s => s.stage !== 'done' && !s.locked)
})).filter(l => l.spots.length))

watch(() => props.you.planned, p => { if (!p) pendingAsk.value = null })
</script>

<template>
  <div class="plan">
    <div class="plan__head">
      <h1 class="display plan__title">Раунд {{ state.round + 1 }}</h1>
      <span v-if="timed && secondsLeft != null" class="plan__timer tabnum" :class="{ 'plan__timer--low': secondsLeft <= 10 }">{{ secondsLeft }} с</span>
    </div>

    <Transition name="screen" mode="out-in">
      <!-- способности сверх хода -->
      <div v-if="mode === 'drone'" key="drone" class="plan__actions">
        <button type="button" class="plan__back" @click="closeAbility">← назад</button>
        <p class="plan__hint">Дрон осмотрит одно место в любой комнате — сверх вашего хода. Осталось полётов: {{ uses }}.</p>
        <section v-for="l in droneTargets" :key="l.id" class="plan__group">
          <p class="plan__tag">{{ l.name }}</p>
          <button v-for="s in l.spots" :key="s.id" type="button" class="plan__act" @click="bonus({ type: 'drone', spotId: s.id })">
            <span>{{ s.name }} <small>{{ s.glance }}</small></span>
            <em v-if="STAGE[s.stage]" class="plan__state" :class="`plan__state--${s.stage}`">{{ STAGE[s.stage] }}</em>
          </button>
        </section>
      </div>

      <div v-else-if="mode === 'archivist'" key="arch" class="plan__actions">
        <button type="button" class="plan__back" @click="closeAbility">← назад</button>
        <p class="plan__hint">Выберите карточку. В разборе архив назовёт место или человека, у которых есть то, что с ней не сходится. Осталось: {{ uses }}.</p>
        <button v-for="c in state.board.cards" :key="c.id" type="button" class="plan__act" @click="bonus({ type: 'archivist', factId: c.id })">
          <span>{{ c.title }} <small>{{ c.detail }}</small></span>
        </button>
      </div>

      <div v-else-if="mode === 'verify'" key="verify" class="plan__actions">
        <button type="button" class="plan__back" @click="closeAbility">← назад</button>
        <p class="plan__hint">Выберите чьи-то слова с доски. В разборе станет ясно, правда это или ложь, — пометка появится у всей команды. Осталось: {{ uses }}.</p>
        <button v-for="c in unchecked" :key="c.id" type="button" class="plan__act" @click="bonus({ type: 'verify', factId: c.id })">
          <span>{{ c.title }} <small>{{ c.detail }}</small></span>
        </button>
      </div>

      <div v-else-if="mode === 'summon'" key="summon" class="plan__actions">
        <button type="button" class="plan__back" @click="closeAbility">← назад</button>
        <p class="plan__hint">Свидетель придёт туда, где вы будете, и ответит на один вопрос — сверх вашего хода. Осталось вызовов: {{ uses }}.</p>
        <section v-for="w in everyone" :key="w.id" class="plan__person">
          <div class="plan__person-head">
            <img class="face" :src="ART.witness(w.id)" alt="">
            <span><b>{{ w.name }}</b><small>сейчас: {{ locName(w.locationId) }}</small></span>
          </div>
          <button
            v-for="q in w.questions.filter(x => !x.asked)"
            :key="q.id"
            type="button"
            class="plan__act"
            :class="{ 'plan__act--locked': !!q.locked }"
            :disabled="!!q.locked"
            @click="bonus({ type: 'ask', witnessId: w.id, questionId: q.id, remote: true })"
          >
            <span v-if="q.locked" class="plan__secret"><i class="plan__blur" :style="{ width: blurWidth(q.id) }" /><small>{{ q.locked }}</small></span>
            <span v-else>{{ q.text }}</span>
            <em v-if="q.locked || q.fresh" class="plan__state" :class="`plan__state--${q.locked ? 'locked' : 'new'}`">{{ q.locked ? 'закрыто' : 'новое' }}</em>
          </button>
          <p v-if="!w.questions.some(x => !x.asked)" class="plan__hint">Спросить больше нечего.</p>
        </section>
      </div>

      <div v-else-if="mode === 'reporter'" key="reporter" class="plan__actions">
        <button type="button" class="plan__back" @click="closeAbility">← назад</button>
        <p class="plan__hint">Редакция поднимет архив по одному человеку: на доску ляжет факт из его прошлого. Осталось звонков: {{ uses }}.</p>
        <button v-for="w in state.witnesses" :key="w.id" type="button" class="plan__act plan__act--item" @click="bonus({ type: 'reporter', witnessId: w.id })">
          <img class="plan__thumb" :src="ART.witness(w.id)" alt="">
          <span>{{ w.name }} <small>{{ w.role }}</small></span>
        </button>
      </div>

      <!-- ход уже выбран -->
      <div v-else-if="you.planned" key="planned" class="plan__actions">
        <div class="plan__chosen">
          <span class="label">Ваш ход</span>
          <b>{{ you.planned.label }}</b>
          <button class="btn btn--ghost btn--small" type="button" @click="emit('send', { type: 'unplan' })">Изменить</button>
        </div>
        <PadAbility :you="you" :state="state" @send="emit('send', $event)" @open="mode = $event" />
        <p class="wait__foot">Ждём остальных. Ходы разберут на большом экране.</p>
      </div>

      <!-- шаг 1: куда -->
      <div v-else-if="mode === 'where'" key="where" class="plan__actions">
        <p class="plan__hint">Выберите, куда идти. В комнате можно осмотреть место, поговорить с тем, кто там сейчас, показать ему улику или уличить во лжи.</p>

        <PadAbility :you="you" :state="state" @send="emit('send', $event)" @open="mode = $event" />

        <div class="plan__where">
          <template v-for="fl in floors" :key="fl.id">
            <p class="label plan__floor">{{ fl.label }}</p>
            <button v-for="l in fl.rooms" :key="l.id" type="button" class="plan__loc" :style="{ '--art': `url(${l.art})` }" @click="goRoom(l.id)">
              <span class="plan__loc-faces">
                <img v-for="w in l.faces" :key="w.id" class="face" :src="ART.witness(w.id)" :alt="w.name">
              </span>
              <span class="plan__loc-name">{{ l.name }}</span>
              <small>
                <template v-if="l.open">осмотреть: {{ l.open }}</template>
                <template v-if="l.open && l.talk"> · </template>
                <template v-if="l.talk">спросить: {{ l.talk }}</template>
                <template v-if="!l.open && !l.talk">{{ l.faces.length ? 'можно показать улику' : 'нечего делать' }}</template>
              </small>
              <span v-if="l.here" class="plan__loc-here">вы здесь</span>
            </button>
          </template>
        </div>
      </div>

      <!-- шаг 2: что в комнате -->
      <div v-else-if="mode === 'room' && locId && room" key="room" class="plan__actions">
        <button type="button" class="plan__loc plan__loc--on" :style="{ '--art': `url(${ART.location(locId)})` }" @click="back">
          <span class="plan__loc-name">{{ locName(locId) }}</span>
          <small>← выбрать другое место</small>
        </button>
        <p class="plan__hint">{{ summary }}</p>

        <div v-if="pendingAsk" class="plan__ability">
          <b>Следователь:</b> первый вопрос выбран. Выберите второй — или задайте только его.
          <button type="button" class="btn btn--small" style="margin-top:.4rem" @click="plan({ type: 'ask', witnessId: pendingAsk.witnessId, questionId: pendingAsk.questionId, force: pendingAsk.force })">Только этот вопрос</button>
        </div>

        <section v-if="room.spots.length" class="plan__group">
          <p class="plan__tag">Осмотреть место</p>
          <button
            v-for="s in room.spots"
            :key="s.id"
            type="button"
            class="plan__act"
            :class="{ 'plan__act--done': s.stage === 'done', 'plan__act--locked': !!s.locked && !s.canUnlock }"
            :disabled="s.stage === 'done' || (!!s.locked && !s.canUnlock)"
            @click="plan({ type: 'search', spotId: s.id, force: !!s.locked && s.canUnlock })"
          >
            <span>{{ s.name }} <small>{{ s.locked ? s.locked : s.glance }}</small></span>
            <em v-if="s.locked || STAGE[s.stage]" class="plan__state" :class="`plan__state--${s.locked ? (s.canUnlock ? 'force' : 'locked') : s.stage}`">{{ s.locked ? (s.canUnlock ? 'вскрыть' : 'заперто') : STAGE[s.stage] }}</em>
          </button>
        </section>

        <section v-for="w in room.witnesses" :key="w.id" class="plan__person">
          <div class="plan__person-head">
            <img class="face" :src="ART.witness(w.id)" alt="">
            <span><b>{{ w.name }}</b><small>{{ state.witnesses.find(x => x.id === w.id)?.role }}</small></span>
          </div>

          <template v-if="w.confronts.length">
            <p class="plan__tag">Уличить во лжи</p>
            <button
              v-for="c in w.confronts"
              :key="c.linkId"
              type="button"
              class="plan__act plan__act--confront"
              :class="{ 'plan__act--done': c.done }"
              :disabled="c.done"
              @click="plan({ type: 'confront', witnessId: w.id, linkId: c.linkId })"
            >
              <span>{{ c.text }} <small>{{ c.done ? 'уже уличали' : 'выложить обе карточки и посмотреть, кто соврал' }}</small></span>
              <em class="plan__state" :class="`plan__state--${c.done ? 'done' : 'force'}`">{{ c.done ? 'было' : 'нить' }}</em>
            </button>
          </template>

          <p v-if="w.questions.length" class="plan__tag">Спросить</p>
          <button
            v-for="q in w.questions"
            :key="q.id"
            type="button"
            class="plan__act"
            :class="{ 'plan__act--done': q.asked, 'plan__act--locked': !!q.locked && !q.canForce, 'plan__act--second': pendingAsk?.questionId === q.id }"
            :disabled="q.asked || (!!q.locked && !q.canForce) || pendingAsk?.questionId === q.id"
            @click="askQ(w.id, q.id, !!q.locked && q.canForce)"
          >
            <span v-if="q.locked" class="plan__secret">
              <i class="plan__blur" :style="{ width: blurWidth(q.id) }" aria-label="закрытый вопрос" />
              <small>{{ q.locked }}{{ q.canForce ? ' — или открыть авторитетом' : '' }}</small>
            </span>
            <span v-else>{{ q.text }}</span>
            <em v-if="qState(q)" class="plan__state" :class="`plan__state--${qState(q)!.cls}`">{{ qState(q)!.label }}</em>
          </button>

          <template v-if="w.presents.length">
            <p class="plan__tag">Показать улику</p>
            <div class="plan__items">
              <button
                v-for="pr in w.presents"
                :key="pr.itemId"
                type="button"
                class="plan__item"
                :class="{ 'plan__item--done': pr.done, 'plan__item--locked': !!pr.locked }"
                :disabled="pr.done"
                @click="pr.locked ? (lockedItem = lockedItem === `${w.id}:${pr.itemId}` ? null : `${w.id}:${pr.itemId}`) : plan({ type: 'present', witnessId: w.id, itemId: pr.itemId })"
              >
                <img class="plan__item-img" :src="ART.item(pr.itemId)" alt="">
                <span>{{ pr.name }}</span>
                <small v-if="pr.done">показали</small>
                <small v-else-if="pr.locked">рано</small>
              </button>
            </div>
            <p v-if="lockedItem?.startsWith(`${w.id}:`)" class="plan__hint plan__hint--lock">
              {{ w.presents.find(x => `${w.id}:${x.itemId}` === lockedItem)?.locked }}
            </p>
          </template>
        </section>

        <div class="plan__group">
          <button type="button" class="plan__act" @click="plan({ type: 'wait' })"><span>Просто побыть здесь <small>наблюдать, ничего не трогать</small></span></button>
        </div>
      </div>
    </Transition>
  </div>
</template>
