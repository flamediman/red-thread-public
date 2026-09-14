<script setup lang="ts">
/* Режим «на время» на телефоне: сыщик ходит по карте сам, действия занимают настоящие секунды,
   находки ложатся на общую доску, а вопросы доски команда закрывает, прикалывая к ним карточки. */
import type { BoardCard, ClientMessage, FieldLogEntry, PlanAction, PublicState, YouState } from '#shared/types'
import { INKS } from '#shared/inks'
import { ART } from '~/utils/art'
import { KIND_LABEL } from '~/composables/useBoardFilter'

const props = defineProps<{ you: YouState; state: PublicState }>()
const emit = defineEmits<{ send: [ClientMessage] }>()
const send = (m: ClientMessage) => emit('send', m)

const { now, leftMs } = useFieldClock(computed(() => props.state))
const field = computed(() => props.state.field)
const me = computed(() => props.you.field)

type Tab = 'here' | 'map' | 'board' | 'log'
const tab = ref<Tab>('here')

const locName = (id?: string | null) => props.state.locations.find(l => l.id === id)?.name ?? ''
const witnessName = (id: string) => props.state.witnesses.find(w => w.id === id)?.name ?? ''
const kind = computed(() => props.you.ability?.kind ?? null)
const uses = computed(() => props.you.usesLeft ?? 0)

/* ── что я сейчас делаю ── */
const walk = computed(() => {
  const w = me.value?.walk
  if (!w) return null
  const total = w.legs.reduce((a, b) => a + b, 0)
  const left = Math.max(0, w.startedAt + total - now.value)
  return { to: locName(w.path[w.path.length - 1]), left, share: total ? Math.min(1, 1 - left / total) : 1, target: w.path[w.path.length - 1]! }
})
const busy = computed(() => {
  const b = me.value?.busy
  if (!b) return null
  const total = b.until - b.startedAt
  const left = Math.max(0, b.until - now.value)
  return { label: b.label, left, share: total ? Math.min(1, 1 - left / total) : 1 }
})
const idle = computed(() => !walk.value && !busy.value && !props.state.paused)

/* ── здесь ── */
const here = computed(() => props.you.options.find(o => o.locationId === props.you.locationId) ?? null)
const STAGE: Record<string, string> = { new: '', second: 'ещё раз', memory: 'запись', done: 'осмотрено' }
const qState = (q: { asked: boolean; locked: string | null; canForce: boolean; fresh: boolean }) =>
  q.asked ? { cls: 'done', label: 'спросили' } : q.locked ? (q.canForce ? { cls: 'force', label: 'можно' } : { cls: 'locked', label: 'закрыто' }) : q.fresh ? { cls: 'new', label: 'новое' } : null
const act = (action: PlanAction) => { if (idle.value) send({ type: 'act', action }) }
const blurWidth = (id: string) => `${55 + ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 40)}%`
const lockedItem = ref<string | null>(null)

/* ── способность ── */
type Ability = 'drone' | 'archivist' | 'verify' | 'summon' | 'reporter' | null
const ability = ref<Ability>(null)
const unchecked = computed(() => props.state.board.cards.filter(c => c.kind === 'testimony' && !c.verdict))
const abilityReady = computed(() => uses.value > 0 && (
  ['intern', 'fixer', 'drone', 'coroner', 'patrol', 'reporter'].includes(kind.value ?? '')
  || (kind.value === 'archivist' && props.state.board.cards.length > 0) || (kind.value === 'tracker' && unchecked.value.length > 0)))
const droneTargets = computed(() => props.state.locations.map(l => ({
  ...l, spots: (props.you.options.find(o => o.locationId === l.id)?.spots ?? []).filter(s => s.stage !== 'done' && !s.locked)
})).filter(l => l.spots.length))
const everyone = computed(() => props.you.options.flatMap(o => o.witnesses.map(w => ({ ...w, locationId: o.locationId }))))
function useAbility(action: PlanAction) { act(action); ability.value = null }

/* ── карта ── */
const inkOf = (i: number) => INKS[i] ?? INKS[0]
const floors = computed(() => props.state.floors.map(fl => ({
  ...fl,
  rooms: props.state.locations.filter(l => l.floor === fl.id).map(l => {
    const o = props.you.options.find(x => x.locationId === l.id)
    const todo = (o?.spots.filter(s => s.stage !== 'done' && !s.locked).length ?? 0)
    return {
      ...l, art: ART.location(l.id), todo,
      faces: props.state.witnesses.filter(w => w.locationId === l.id),
      team: props.state.players.filter(p => p.connected && p.locationId === l.id && p.id !== props.you.id),
      here: props.you.locationId === l.id,
      target: walk.value?.target === l.id
    }
  })
})))
const lockedRoom = ref<string | null>(null)
const canForceDoor = (l: { locked?: { kind?: string } }) => uses.value > 0 && (l.locked?.kind === 'digital' ? kind.value === 'netrunner' : kind.value === 'burglar')
function goTo(l: (typeof floors.value)[number]['rooms'][number]) {
  if (props.state.paused) return
  if (!l.open) { lockedRoom.value = l.id; return }
  send({ type: 'go', locationId: l.id })
  tab.value = 'here'
}
const lockedInfo = computed(() => props.state.locations.find(l => l.id === lockedRoom.value) ?? null)

/* ── доска ── */
const boardView = ref<'questions' | 'cards' | 'items'>('questions')
const groups = computed(() => {
  const out: { name: string; questions: NonNullable<typeof field.value>['questions'] }[] = []
  for (const q of field.value?.questions ?? []) {
    let g = out.find(x => x.name === q.group)
    if (!g) { g = { name: q.group, questions: [] }; out.push(g) }
    g.questions.push(q)
  }
  return out
})
const solvedCount = computed(() => field.value?.questions.filter(q => q.solved).length ?? 0)
const cardTitle = (id: string | null) => props.state.board.cards.find(c => c.id === id)?.title ?? ''

const picking = ref<string | null>(null)
const picked = ref<string[]>([])
const pickKind = ref<BoardCard['kind'] | null>(null)
const pickQ = computed(() => field.value?.questions.find(q => q.id === picking.value) ?? null)
const pickCards = computed(() => [...props.state.board.cards].reverse()
  .filter(c => !pickKind.value || c.kind === pickKind.value)
  .sort((a, b) => Number(picked.value.includes(b.id)) - Number(picked.value.includes(a.id)) || Number(b.pinned) - Number(a.pinned)))
function openPick(id: string) { picking.value = id; picked.value = []; pickKind.value = null }
function togglePick(id: string) {
  const q = pickQ.value
  if (!q) return
  if (picked.value.includes(id)) picked.value = picked.value.filter(x => x !== id)
  else if (picked.value.length < q.slots) picked.value = [...picked.value, id]
}
function pin() {
  const q = pickQ.value
  if (!q || picked.value.length !== q.slots) return
  send({ type: 'solve', questionId: q.id, factIds: picked.value })
  picking.value = null
}
const coolLeft = (until: number | null) => until ? Math.max(0, Math.ceil((until - now.value) / 1000)) : 0

/* ── журнал: новое сообщение открывается само ── */
const reading = ref<FieldLogEntry | null>(null)
/** что было в журнале, когда экран открылся, — старое не всплывает */
let lastSeen: number | null = null
watch(() => me.value?.log.at(-1)?.seq ?? 0, seq => {
  if (lastSeen === null) { lastSeen = seq; return }
  if (seq > lastSeen) { lastSeen = seq; reading.value = me.value!.log.at(-1)! }
}, { immediate: true })
const logNewest = computed(() => [...(me.value?.log ?? [])].reverse())
const speakerOf = (sp: string) => sp === 'narrator' ? null
  : sp === 'inspector' ? { name: props.state.caseInfo.helper.name, face: ART.witness('inspector') }
  : { name: witnessName(sp), face: ART.witness(sp) }

/* решение доски — всплывающая строка */
const toast = ref<{ text: string; ok: boolean } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
watch(() => field.value?.feed.at(-1)?.seq, () => {
  const e = field.value?.feed.at(-1)
  if (!e || e.playerId !== props.you.id || (e.kind !== 'solve' && e.kind !== 'fail')) return
  toast.value = { text: e.text, ok: e.kind === 'solve' }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 5000)
})
onBeforeUnmount(() => { if (toastTimer) clearTimeout(toastTimer) })

const confirmAccuse = ref(false)
const secs = (ms: number) => `${Math.ceil(ms / 1000)} с`
</script>

<template>
  <div class="field-pad">
    <!-- время и что я делаю -->
    <div class="field-pad__status">
      <div class="field-pad__clock">
        <b class="tabnum" :class="{ 'field-pad__clock--low': (leftMs ?? 1e9) < 5 * 60_000 }">{{ state.paused ? 'пауза' : mmss(leftMs) }}</b>
        <span>{{ state.clock }} · {{ state.caseInfo.countdown }}</span>
      </div>
      <div class="field-pad__doing">
        <template v-if="walk">
          <span>Идёте: <b>{{ walk.to }}</b> · {{ secs(walk.left) }}</span>
          <i class="field-pad__bar"><i :style="{ transform: `scaleX(${walk.share})` }" /></i>
        </template>
        <template v-else-if="busy">
          <span>{{ busy.label }} · {{ secs(busy.left) }}</span>
          <i class="field-pad__bar"><i :style="{ transform: `scaleX(${busy.share})` }" /></i>
        </template>
        <span v-else>Вы здесь: <b>{{ locName(you.locationId) }}</b></span>
      </div>
      <button v-if="walk || busy" class="field-pad__halt" type="button" @click="send({ type: 'halt' })">стоп</button>
    </div>

    <nav class="field-pad__tabs">
      <button type="button" :class="{ on: tab === 'here' }" @click="tab = 'here'">Здесь</button>
      <button type="button" :class="{ on: tab === 'map' }" @click="tab = 'map'">Карта</button>
      <button type="button" :class="{ on: tab === 'board' }" @click="tab = 'board'">Доска <small>{{ solvedCount }}/{{ field?.questions.length ?? 0 }}</small></button>
      <button type="button" :class="{ on: tab === 'log' }" @click="tab = 'log'">Журнал</button>
    </nav>

    <!-- ЗДЕСЬ -->
    <div v-if="tab === 'here'" class="plan__actions field-pad__page">
      <button type="button" class="plan__loc plan__loc--on" :style="{ '--art': `url(${ART.location(you.locationId)})` }" @click="tab = 'map'">
        <span class="plan__loc-name">{{ locName(you.locationId) }}</span>
        <small>{{ walk ? `уходите: ${walk.to}` : 'карта — куда идти дальше' }}</small>
      </button>

      <!-- способность -->
      <template v-if="ability === 'drone'">
        <button type="button" class="plan__back" @click="ability = null">← назад</button>
        <p class="plan__hint">Дрон осмотрит одно место в любой комнате. Осталось: {{ uses }}.</p>
        <section v-for="l in droneTargets" :key="l.id" class="plan__group">
          <p class="plan__tag">{{ l.name }}</p>
          <button v-for="s in l.spots" :key="s.id" type="button" class="plan__act" :disabled="!idle" @click="useAbility({ type: 'drone', spotId: s.id })"><span>{{ s.name }} <small>{{ s.glance }}</small></span></button>
        </section>
      </template>
      <template v-else-if="ability === 'reporter'">
        <button type="button" class="plan__back" @click="ability = null">← назад</button>
        <p class="plan__hint">Редакция поднимет архив по одному человеку. Осталось звонков: {{ uses }}.</p>
        <button v-for="w in state.witnesses" :key="w.id" type="button" class="plan__act plan__act--item" :disabled="!idle" @click="useAbility({ type: 'reporter', witnessId: w.id })">
          <img class="plan__thumb" :src="ART.witness(w.id)" alt=""><span>{{ w.name }} <small>{{ w.role }}</small></span>
        </button>
      </template>
      <template v-else-if="ability === 'archivist' || ability === 'verify'">
        <button type="button" class="plan__back" @click="ability = null">← назад</button>
        <p class="plan__hint">{{ ability === 'archivist' ? 'Выберите карточку — архив скажет, где искать то, что ей противоречит.' : 'Выберите чьи-то слова — станет ясно, правда это или ложь.' }} Осталось: {{ uses }}.</p>
        <button v-for="c in (ability === 'verify' ? unchecked : state.board.cards)" :key="c.id" type="button" class="plan__act" :disabled="!idle" @click="useAbility(ability === 'verify' ? { type: 'verify', factId: c.id } : { type: 'archivist', factId: c.id })">
          <span>{{ c.title }} <small>{{ c.detail }}</small></span>
        </button>
      </template>
      <template v-else-if="ability === 'summon'">
        <button type="button" class="plan__back" @click="ability = null">← назад</button>
        <p class="plan__hint">Свидетель ответит вам на вопрос, где бы он ни был. Осталось вызовов: {{ uses }}.</p>
        <section v-for="w in everyone" :key="w.id" class="plan__person">
          <div class="plan__person-head"><img class="face" :src="ART.witness(w.id)" alt=""><span><b>{{ w.name }}</b><small>сейчас: {{ locName(w.locationId) }}</small></span></div>
          <button v-for="q in w.questions.filter(x => !x.asked && !x.locked)" :key="q.id" type="button" class="plan__act" :disabled="!idle" @click="useAbility({ type: 'ask', witnessId: w.id, questionId: q.id, remote: true })"><span>{{ q.text }}</span></button>
        </section>
      </template>

      <template v-else-if="here">
        <div v-if="abilityReady" class="plan__group">
          <p class="plan__tag">Способность · осталось {{ uses }}</p>
          <button v-if="kind === 'intern'" type="button" class="plan__act plan__act--ability" :disabled="!idle" @click="act({ type: 'intern' })"><span>Подслушать разговор <small>о чём шепчутся свидетели</small></span></button>
          <button v-if="kind === 'fixer'" type="button" class="plan__act plan__act--ability" :disabled="!idle || !you.market.length" @click="act({ type: 'fixer' })"><span>Достать улику через фиксера <small>{{ you.market[0]?.name ?? 'рынок пуст' }}</small></span></button>
          <button v-if="kind === 'coroner'" type="button" class="plan__act plan__act--ability" :disabled="!idle" @click="act({ type: 'coroner' })"><span>Медицинское заключение <small>из любого места</small></span></button>
          <button v-if="kind === 'drone'" type="button" class="plan__act plan__act--ability" @click="ability = 'drone'"><span>Поднять дрон <small>осмотр в любой комнате</small></span></button>
          <button v-if="kind === 'patrol'" type="button" class="plan__act plan__act--ability" @click="ability = 'summon'"><span>Вызвать на допрос <small>вопрос свидетелю из любой комнаты</small></span></button>
          <button v-if="kind === 'reporter'" type="button" class="plan__act plan__act--ability" @click="ability = 'reporter'"><span>Позвонить в редакцию <small>прошлое любого свидетеля</small></span></button>
          <button v-if="kind === 'archivist'" type="button" class="plan__act plan__act--ability" @click="ability = 'archivist'"><span>Поднять архив <small>где искать противоречие</small></span></button>
          <button v-if="kind === 'tracker'" type="button" class="plan__act plan__act--ability" @click="ability = 'verify'"><span>Проверить показание <small>правда или ложь</small></span></button>
        </div>

        <section v-if="here.spots.length" class="plan__group">
          <p class="plan__tag">Осмотреть</p>
          <button
            v-for="s in here.spots" :key="s.id" type="button" class="plan__act"
            :class="{ 'plan__act--done': s.stage === 'done', 'plan__act--locked': !!s.locked && !s.canUnlock }"
            :disabled="!idle || s.stage === 'done' || (!!s.locked && !s.canUnlock)"
            @click="act({ type: 'search', spotId: s.id, force: !!s.locked && s.canUnlock })"
          >
            <span>{{ s.name }} <small>{{ s.locked ? s.locked : s.glance }}</small></span>
            <em v-if="s.locked || STAGE[s.stage]" class="plan__state" :class="`plan__state--${s.locked ? (s.canUnlock ? 'force' : 'locked') : s.stage}`">{{ s.locked ? (s.canUnlock ? 'вскрыть' : 'заперто') : STAGE[s.stage] }}</em>
          </button>
        </section>

        <section v-for="w in here.witnesses" :key="w.id" class="plan__person">
          <div class="plan__person-head">
            <img class="face" :src="ART.witness(w.id)" alt="">
            <span><b>{{ w.name }}</b><small>{{ state.witnesses.find(x => x.id === w.id)?.role }}</small></span>
          </div>
          <button
            v-for="q in w.questions" :key="q.id" type="button" class="plan__act"
            :class="{ 'plan__act--done': q.asked, 'plan__act--locked': !!q.locked && !q.canForce }"
            :disabled="!idle || q.asked || (!!q.locked && !q.canForce)"
            @click="act({ type: 'ask', witnessId: w.id, questionId: q.id, force: !!q.locked && q.canForce })"
          >
            <span v-if="q.locked" class="plan__secret"><i class="plan__blur" :style="{ width: blurWidth(q.id) }" /><small>{{ q.locked }}{{ q.canForce ? ' — или авторитетом' : '' }}</small></span>
            <span v-else>{{ q.text }}</span>
            <em v-if="qState(q)" class="plan__state" :class="`plan__state--${qState(q)!.cls}`">{{ qState(q)!.label }}</em>
          </button>
          <template v-if="w.presents.length">
            <p class="plan__tag">Показать улику</p>
            <div class="plan__items">
              <button
                v-for="pr in w.presents" :key="pr.itemId" type="button" class="plan__item"
                :class="{ 'plan__item--done': pr.done, 'plan__item--locked': !!pr.locked }"
                :disabled="pr.done || !idle"
                @click="pr.locked ? (lockedItem = lockedItem === `${w.id}:${pr.itemId}` ? null : `${w.id}:${pr.itemId}`) : act({ type: 'present', witnessId: w.id, itemId: pr.itemId })"
              >
                <img class="plan__item-img" :src="ART.item(pr.itemId)" alt="">
                <span>{{ pr.name }}</span>
                <small v-if="pr.done">показали</small><small v-else-if="pr.locked">рано</small>
              </button>
            </div>
            <p v-if="lockedItem?.startsWith(`${w.id}:`)" class="plan__hint plan__hint--lock">{{ w.presents.find(x => `${w.id}:${x.itemId}` === lockedItem)?.locked }}</p>
          </template>
        </section>

        <p v-if="!here.spots.length && !here.witnesses.length" class="plan__hint">Здесь ничего не осталось. Откройте карту — и дальше.</p>
      </template>
    </div>

    <!-- КАРТА -->
    <div v-else-if="tab === 'map'" class="plan__actions field-pad__page">
      <p class="plan__hint">Нажмите на место — сыщик пойдёт туда. Переход занимает секунды, лестница — дольше.</p>
      <template v-for="fl in floors" :key="fl.id">
        <p class="label plan__floor">{{ fl.label }}</p>
        <div class="field-map__row">
          <button
            v-for="l in fl.rooms" :key="l.id" type="button" class="plan__loc field-map__room"
            :class="{ 'field-map__room--here': l.here, 'field-map__room--target': l.target, 'field-map__room--locked': !l.open }"
            :style="{ '--art': `url(${l.art})` }"
            @click="goTo(l)"
          >
            <span class="plan__loc-faces">
              <img v-for="w in l.faces" :key="w.id" class="face" :src="ART.witness(w.id)" :alt="w.name">
            </span>
            <span class="plan__loc-name">{{ l.name }}</span>
            <small>
              <template v-if="!l.open">заперто</template>
              <template v-else-if="l.todo">осмотреть: {{ l.todo }}</template>
              <template v-else>осмотрено</template>
            </small>
            <span class="field-map__team">
              <i v-for="p in l.team" :key="p.id" :style="{ background: inkOf(p.ink) }" :title="p.name" />
            </span>
            <span v-if="l.here" class="plan__loc-here">вы здесь</span>
            <span v-else-if="l.target" class="plan__loc-here">идёте</span>
          </button>
        </div>
      </template>
    </div>

    <!-- ДОСКА -->
    <div v-else-if="tab === 'board'" class="plan__actions field-pad__page">
      <div class="pad-board__tabs">
        <button type="button" class="pad-board__tab" :class="{ 'pad-board__tab--on': boardView === 'questions' }" @click="boardView = 'questions'">Вопросы · {{ solvedCount }}/{{ field?.questions.length ?? 0 }}</button>
        <button type="button" class="pad-board__tab" :class="{ 'pad-board__tab--on': boardView === 'cards' }" @click="boardView = 'cards'">Карточки · {{ state.board.cards.length }}</button>
        <button type="button" class="pad-board__tab" :class="{ 'pad-board__tab--on': boardView === 'items' }" @click="boardView = 'items'">Улики · {{ you.items.length }}</button>
      </div>

      <template v-if="boardView === 'questions'">
        <p class="plan__hint">Приколите к вопросу карточки, которые на него отвечают. Неверный набор отнимет 45 секунд у всей команды.</p>
        <section v-for="g in groups" :key="g.name" class="plan__group">
          <p class="plan__tag">{{ g.name }}</p>
          <button
            v-for="q in g.questions" :key="q.id" type="button" class="field-q"
            :class="{ 'field-q--solved': q.solved, 'field-q--cool': coolLeft(q.cooldownUntil) > 0 }"
            :disabled="q.solved || coolLeft(q.cooldownUntil) > 0"
            @click="openPick(q.id)"
          >
            <span class="field-q__title">{{ q.title }}</span>
            <span v-if="q.solved" class="field-q__answer">{{ cardTitle(q.yieldsFactId) }}</span>
            <span v-else class="field-q__hint">
              <i v-for="n in q.slots" :key="n" class="field-q__slot" />
              {{ coolLeft(q.cooldownUntil) > 0 ? `остывает ${coolLeft(q.cooldownUntil)} с` : q.hint }}
            </span>
          </button>
        </section>
      </template>

      <template v-else-if="boardView === 'cards'">
        <div v-for="c in [...state.board.cards].reverse()" :key="c.id" class="mcard" :class="`mcard--${c.kind}`">
          <div class="mcard__main">
            <i class="mcard__kind" :title="KIND_LABEL[c.kind]" />
            <span class="mcard__title">{{ c.title }}</span>
            <span class="mcard__meta">{{ c.by }}<template v-if="c.time"> · {{ c.time }}</template></span>
            <span class="mcard__detail">{{ c.detail }}</span>
          </div>
          <button type="button" class="mcard__pin" :class="{ 'mcard__pin--on': c.pinned }" @click="send({ type: 'pin', factId: c.id })">★</button>
        </div>
        <p v-if="!state.board.cards.length" class="lobby__empty">Пока пусто: карточки дают осмотры и разговоры.</p>
      </template>

      <div v-else class="pad-board__items">
        <p v-if="!you.items.length" class="lobby__empty">Предметов пока нет — их находят при осмотре.</p>
        <div v-for="i in you.items" :key="i.id" class="pad-board__item">
          <img class="pad-board__thumb" :src="ART.item(i.id)" alt="">
          <div><b>{{ i.name }}</b><small>{{ i.description }}</small></div>
        </div>
      </div>

      <button class="btn btn--stamp field-pad__accuse" type="button" @click="confirmAccuse = true">Собрать всех и обвинить</button>
    </div>

    <!-- ЖУРНАЛ -->
    <div v-else class="plan__actions field-pad__page">
      <p v-if="!logNewest.length" class="lobby__empty">Здесь будет всё, что вы нашли и услышали сами.</p>
      <article v-for="e in logNewest" :key="e.seq" class="field-log">
        <span class="field-log__at tabnum">{{ e.at }}</span>
        <p v-for="(b, i) in e.beats" :key="i" class="field-log__line" :class="{ 'field-log__line--said': b.speaker !== 'narrator' }">
          <b v-if="speakerOf(b.speaker)">{{ speakerOf(b.speaker)!.name }}: </b>{{ b.text }}
        </p>
      </article>
    </div>

    <!-- новое в журнале: ответ или находка -->
    <div v-if="reading" class="veil" @click.self="reading = null">
      <div class="veil__card field-read" role="dialog" aria-modal="true">
        <template v-for="(b, i) in reading.beats" :key="i">
          <div v-if="speakerOf(b.speaker)" class="field-read__who"><img class="face" :src="speakerOf(b.speaker)!.face" alt=""><b>{{ speakerOf(b.speaker)!.name }}</b></div>
          <p class="field-read__text" :class="{ 'field-read__text--said': b.speaker !== 'narrator' }">{{ b.text }}</p>
        </template>
        <div class="veil__actions"><button class="btn" type="button" @click="reading = null">Понятно</button></div>
      </div>
    </div>

    <!-- выбор карточек для вопроса доски -->
    <div v-if="pickQ" class="veil" @click.self="picking = null">
      <div class="veil__card field-pick" role="dialog" aria-modal="true">
        <h2 class="veil__title">{{ pickQ.title }}</h2>
        <p class="veil__text">Нужно карточек: {{ pickQ.slots }} — {{ pickQ.hint }}.</p>
        <div class="pad-filters">
          <button type="button" class="chip" :class="{ 'chip--on': !pickKind }" @click="pickKind = null">все</button>
          <button v-for="(label, k) in KIND_LABEL" :key="k" type="button" class="chip" :class="[`chip--${k}`, { 'chip--on': pickKind === k }]" @click="pickKind = pickKind === k ? null : k"><i class="chip__dot" />{{ label }}</button>
        </div>
        <div class="field-pick__list">
          <button v-for="c in pickCards" :key="c.id" type="button" class="field-pick__card" :class="[`mcard--${c.kind}`, { 'field-pick__card--on': picked.includes(c.id) }]" @click="togglePick(c.id)">
            <i class="mcard__kind" />
            <span><b>{{ c.title }}</b><small>{{ c.detail }}</small></span>
            <em>{{ picked.includes(c.id) ? picked.indexOf(c.id) + 1 : '' }}</em>
          </button>
        </div>
        <div class="veil__actions">
          <button class="btn btn--ghost" type="button" @click="picking = null">Отмена</button>
          <button class="btn btn--stamp" type="button" :disabled="picked.length !== pickQ.slots" @click="pin">Приколоть · {{ picked.length }}/{{ pickQ.slots }}</button>
        </div>
      </div>
    </div>

    <div v-if="lockedInfo" class="veil" @click.self="lockedRoom = null">
      <div class="veil__card" role="dialog" aria-modal="true">
        <h2 class="veil__title">{{ lockedInfo.name }}</h2>
        <p class="veil__text">{{ lockedInfo.locked?.text }}</p>
        <div class="veil__actions">
          <button class="btn btn--ghost" type="button" @click="lockedRoom = null">Понятно</button>
          <button v-if="canForceDoor(lockedInfo)" class="btn btn--stamp" type="button" @click="send({ type: 'go', locationId: lockedInfo.id, force: true }); lockedRoom = null; tab = 'here'">Вскрыть · осталось {{ uses }}</button>
        </div>
      </div>
    </div>

    <div v-if="confirmAccuse" class="veil" @click.self="confirmAccuse = false">
      <div class="veil__card" role="dialog" aria-modal="true">
        <h2 class="veil__title">Обвинить сейчас?</h2>
        <p class="veil__text">Поиск остановится, все проголосуют: кто, чем и почему. Ошибка отнимет пять минут. Осталось попыток: {{ state.attemptsLeft }}.</p>
        <div class="veil__actions">
          <button class="btn btn--ghost" type="button" @click="confirmAccuse = false">Ещё рано</button>
          <button class="btn btn--stamp" type="button" @click="confirmAccuse = false; send({ type: 'callAccuse' })">Обвинить</button>
        </div>
      </div>
    </div>

    <Transition name="fade">
      <div v-if="toast" class="field-toast" :class="{ 'field-toast--ok': toast.ok }" @click="toast = null">{{ toast.text }}</div>
    </Transition>
  </div>
</template>
