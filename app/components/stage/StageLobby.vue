<script setup lang="ts">
import type { ClientMessage, PublicState } from '#shared/types'
import { INKS } from '#shared/inks'
import { roomCode, roomPass, roomPin } from '~/composables/useGame'
/* сменить ПИН прямо в лобби */
const pinEdit = ref(false)
const pinDraft = ref('')
function savePin() { const p = pinDraft.value.replace(/\D/g, ''); if (p.length === 4) { emit('send', { type: 'setPin', pin: p }); pinEdit.value = false } }
import { formatRoom } from '~/utils/room'

/* phone — экран телефона: лобби с него не ведут, поверх — записка и выход в меню */
const props = defineProps<{ state: PublicState; phone?: boolean }>()
const emit = defineEmits<{ send: [ClientMessage] }>()
const { config } = useConfig()
/** в сети телефоны идут на адрес сайта с кодом комнаты; дома — на IP ноутбука в Wi‑Fi */
const online = computed(() => config.value.mode === 'public')
const siteHost = computed(() => import.meta.client ? location.host : '')

/* ── адрес для телефонов: IP вводится один раз и запоминается, порт — из адресной строки ── */
const HOST_KEY = 'meridian:host'
const net = ref<{ host: string | null } | null>(null)
const manualHost = ref('')
const editingHost = ref(false)
const hostDraft = ref('')

onMounted(async () => {
  if (online.value) return
  try { manualHost.value = localStorage.getItem(HOST_KEY) || '' } catch { /* приватный режим */ }
  try { net.value = await $fetch('/api/net') } catch { net.value = { host: null } }
})

const publicPort = computed(() => {
  if (!import.meta.client) return ''
  const p = location.port
  return p && p !== '80' ? `:${p}` : ''
})
const host = computed(() => manualHost.value.trim() || net.value?.host || '')
const joinUrl = computed(() => online.value
  ? (roomCode.value ? `${location.origin}/play?r=${roomCode.value}${roomPass.value ? `&p=${roomPass.value}` : ''}` : '')
  : host.value ? `http://${host.value}${publicPort.value}/play` : '')
const needsHost = computed(() => !online.value && net.value !== null && !host.value)

function openHostEditor() { hostDraft.value = manualHost.value || net.value?.host || ''; editingHost.value = true }
function saveHost() {
  const clean = hostDraft.value.trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '')
  manualHost.value = clean
  try { clean ? localStorage.setItem(HOST_KEY, clean) : localStorage.removeItem(HOST_KEY) } catch { /* приватный режим */ }
  editingHost.value = false
}

/* ── состав ── */
const players = computed(() => props.state.players.map(p => ({
  ...p, color: INKS[p.ink] ?? INKS[0], role: props.state.detectives.find(d => d.id === p.detectiveId)?.title ?? null
})))
const readyCount = computed(() => players.value.filter(p => p.ready).length)
const canStart = computed(() => players.value.length >= 2)
const notReady = computed(() => players.value.filter(p => !p.ready).map(p => p.name))
const noRole = computed(() => props.state.settings.roles === 'random' ? [] : players.value.filter(p => !p.detectiveId).map(p => p.name))
const confirm = ref(false)
const rulesOpen = ref(false)

/* ── дело и история ── */
const gameDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
/** кто уже слышал разгадку — чтобы не сажать их за то же дело */
const caseHistory = computed(() => props.state.history.filter(g => g.caseId === props.state.caseInfo.id))
const knowers = computed(() => [...new Set(caseHistory.value.filter(g => g.outcome !== 'failed').flatMap(g => g.players))].slice(0, 12))

/* настройки партии: название, варианты и пояснение под выбранный вариант */
type Opt = { key: 'hints' | 'stepping' | 'timers' | 'roles' | 'tutorial' | 'duration'; name: string; values: { id: string; label: string }[]; notes: Partial<Record<string, string>> }
const realtime = computed(() => props.state.caseInfo.mode === 'realtime')
const options = computed<Opt[]>(() => [
  ...(realtime.value ? [{ key: 'duration' as const, name: 'Время на поиск',
    values: [{ id: '30', label: '30 мин' }, { id: '45', label: '45 мин' }, { id: '60', label: '60 мин' }],
    notes: { '30': 'Быстрая партия: успеть можно, но придётся делиться и не ходить толпой.', '45': 'Обычная партия: хватит на весь дом, если не терять время на лестницах.', '60': 'Спокойная партия для большой компании или первого раза.' } }] : []),
  { key: 'tutorial', name: 'Обучение',
    values: [{ id: 'on', label: 'показать' }, { id: 'off', label: 'без' }],
    notes: { on: 'Перед прологом — шесть коротких экранов о том, как играть. Листает ведущий, у каждого на телефоне — его сыщик.', off: 'Сразу к истории — для тех, кто уже играл.' } },
  { key: 'stepping', name: 'Смена реплик',
    values: [{ id: 'manual', label: 'вручную' }, { id: 'auto', label: 'сама' }],
    notes: { manual: 'Реплика не сменится, пока ведущий не нажмёт «Дальше» или пробел.', auto: 'Реплики идут одна за другой в темпе озвучки.' } },
  ...(realtime.value ? [] : [{ key: 'timers' as const, name: 'Время на ход',
    values: [{ id: 'on', label: 'с таймером' }, { id: 'off', label: 'без' }],
    notes: { on: 'Полторы минуты на выбор хода, совещание — от двух до четырёх минут.', off: 'Никто не торопит: раунд идёт, пока все не выберут ход.' } }]),
  { key: 'roles', name: 'Сыщики',
    values: [{ id: 'pick', label: 'выбирают' }, { id: 'random', label: 'случайно' }],
    notes: { pick: 'Каждый сам выбирает сыщика на телефоне.', random: 'Роли раздаст случай в момент старта.' } },
  { key: 'hints', name: props.state.caseInfo.helper.hints,
    values: [{ id: 'soft', label: 'если застряли' }, { id: 'off', label: 'без' }],
    notes: { soft: `${props.state.caseInfo.helper.name} позвонит, только если команда давно не находит главного.`, off: 'Никаких подсказок — только вы и доска.' } }
])

function tryStart() {
  if (!canStart.value) return
  if (notReady.value.length || noRole.value.length) confirm.value = true
  else emit('send', { type: 'start' })
}
</script>

<template>
  <div class="lobby">
    <div class="lobby__intro">
      <div class="lobby__top">
        <span class="lobby__nav">
          <button class="lobby__back" type="button" @click="emit('send', { type: 'toMenu' })">← Все дела</button>
          <button class="lobby__rules" type="button" @click="rulesOpen = true"><i>?</i>Правила</button>
        </span>
        <span class="stamp">{{ state.setting.title }} · {{ state.caseInfo.stamp }}</span>
      </div>
      <h1 class="display lobby__title">{{ state.caseInfo.title }}</h1>
      <p class="lobby__lede">{{ state.caseInfo.lede }}</p>
      <p class="lobby__history">
        <template v-if="caseHistory.length">
          Играли {{ caseHistory.length === 1 ? 'один раз' : `${caseHistory.length} раза` }}: {{ gameDate(caseHistory[0]!.finishedAt) }}, {{ state.caseInfo.outcomes.short[caseHistory[0]!.outcome] }}.
          <b v-if="knowers.length">Разгадку уже знают: {{ knowers.join(', ') }}.</b>
        </template>
        <template v-else>{{ state.caseInfo.players }} игроков · {{ state.caseInfo.minutes }} минут · ещё не сыграно</template>
      </p>

      <div class="lobby__join">
        <div class="lobby__qr" :class="{ 'lobby__qr--empty': !joinUrl }">
          <Qrcode v-if="joinUrl" :value="joinUrl" white-color="#efe6d3" black-color="#1c1a1f" />
          <span v-else>Укажите адрес — появится код для гостей</span>
        </div>
        <div>
          <p class="label">{{ joinUrl ? 'Наведите камеру телефона' : 'Настройка' }}</p>
          <template v-if="online">
            <p class="lobby__hint">или откройте {{ siteHost }}/play и введите код</p>
            <p class="lobby__room tabnum">{{ formatRoom(roomCode) }}</p>
            <p v-if="roomPin && !pinEdit" class="lobby__pin">ПИН <b class="tabnum">{{ roomPin }}</b><button type="button" class="lobby__pin-edit" @click="pinDraft = roomPin ?? ''; pinEdit = true">изменить</button><small>нужен телефонам без QR и другому экрану, чтобы войти в комнату</small></p>
            <form v-else-if="roomPin" class="lobby__pin lobby__pin-form" @submit.prevent="savePin">
              <span>ПИН</span>
              <input v-model="pinDraft" class="lobby__pin-input tabnum" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="Новый ПИН">
              <button class="btn btn--small" type="submit" :disabled="pinDraft.replace(/\D/g, '').length !== 4">Готово</button>
              <button class="btn btn--small btn--ghost" type="button" @click="pinEdit = false">Отмена</button>
            </form>
          </template>
          <form v-else-if="editingHost || needsHost" class="lobby__host-form" @submit.prevent="saveHost">
            <span class="lobby__hint">Адрес ноутбука в Wi-Fi</span>
            <div class="lobby__host-row">
              <input v-model="hostDraft" class="lobby__host-input" placeholder="192.168.1.42" inputmode="decimal" autocomplete="off">
              <button class="btn btn--small" type="submit">Готово</button>
            </div>
          </form>
          <template v-else>
            <p class="lobby__hint">Телефоны и ноутбук — в одной сети Wi-Fi</p>
            <button class="lobby__address" type="button" @click="openHostEditor">{{ host }}{{ publicPort }} <i>изменить</i></button>
          </template>
        </div>
      </div>
    </div>

    <div class="lobby__side">
      <div>
        <p class="label">{{ state.setting.crew }} <span class="tabnum">{{ players.length }}</span><template v-if="players.length"> · готовы <span class="tabnum">{{ readyCount }}</span></template></p>
        <div v-if="players.length" class="lobby__roster">
          <div
            v-for="p in players"
            :key="p.id"
            class="roster-item"
            :class="{ 'roster-item--away': !p.connected, 'roster-item--ready': p.ready }"
            :style="{ '--chip-ink': p.color }"
          >
            <PlayerAvatar :id="p.id" :name="p.name" :ink="p.ink" :photo="p.photo" :detective-id="p.detectiveId" size="sm" />
            <span class="roster-item__name">{{ p.name }}</span>
            <span v-if="p.role" class="roster-item__role">{{ p.role }}</span>
            <span class="roster-item__ready" :class="{ 'roster-item__ready--on': p.ready }" aria-hidden="true">✓</span>
            <button class="roster-item__kick" type="button" :aria-label="`Убрать ${p.name}`" @click="emit('send', { type: 'kick', playerId: p.id })">×</button>
          </div>
        </div>
        <p v-else class="lobby__empty">Пока никого. Сканируйте код — роль выбирают на телефоне.</p>
      </div>

      <div class="lobby__settings">
        <div v-for="o in options" :key="o.key" class="setting">
          <div>
            <span class="setting__name">{{ o.name }}</span>
            <span class="setting__note">{{ o.notes[state.settings[o.key]] }}</span>
          </div>
          <div class="setting__toggle" role="radiogroup" :aria-label="o.name">
            <button
              v-for="v in o.values"
              :key="v.id"
              type="button"
              role="radio"
              class="setting__opt"
              :class="{ 'setting__opt--on': state.settings[o.key] === v.id }"
              :aria-checked="state.settings[o.key] === v.id"
              @click="emit('send', { type: 'settings', settings: { [o.key]: v.id } })"
            >{{ v.label }}</button>
          </div>
        </div>
        <div v-if="realtime" class="setting">
          <div>
            <span class="setting__name">На время: все ходят одновременно</span>
            <span class="setting__note">Раундов нет. Каждый сам ходит по дому с телефона, осмотр и разговор занимают секунды, находки сразу ложатся на общую доску. Команда закрывает вопросы доски и успевает назвать имя до {{ state.caseInfo.clock.end }}.</span>
          </div>
        </div>
        <div v-else class="setting">
          <div>
            <span class="setting__name">Раундов на ночь: {{ state.roundsTotal }}</span>
            <span class="setting__note">Ночь с {{ state.caseInfo.clock.start }} до {{ state.caseInfo.clock.end }}. Чем больше команда, тем меньше раундов — ходов выходит примерно поровну.</span>
            <span v-if="state.smallBrigade" class="setting__note">Команда до трёх человек: осмотр сразу открывает второй слой, совещания короче.</span>
          </div>
        </div>
      </div>

      <button class="btn btn--stamp lobby__start" :disabled="!canStart" @click="tryStart">
        {{ players.length < 2 ? 'Нужны хотя бы двое' : realtime ? 'Начать поиск' : 'Начать ночь' }}
      </button>
    </div>

    <div v-if="phone" class="veil">
      <div class="veil__card" role="dialog" aria-modal="true">
        <h2 class="veil__title">Нужен экран побольше</h2>
        <p class="veil__text">Лобби открывается на планшете или компьютере. Телефон — для игроков: redthread-game.ru/play</p>
        <div class="veil__actions"><button class="btn" type="button" @click="emit('send', { type: 'toMenu' })">← Все дела</button></div>
      </div>
    </div>
    <div v-if="confirm" class="veil" @click.self="confirm = false">
      <div class="veil__card" role="dialog" aria-modal="true">
        <h2 class="veil__title">Не все готовы</h2>
        <p class="veil__text">
          <template v-if="notReady.length">Ещё не нажали «Готов»: {{ notReady.join(', ') }}. </template>
          <template v-if="noRole.length">Без сыщика: {{ noRole.join(', ') }} — получат свободную роль.</template>
        </p>
        <div class="veil__actions">
          <button class="btn btn--ghost" @click="confirm = false">Подождём</button>
          <button class="btn btn--stamp" @click="confirm = false; emit('send', { type: 'start' })">Всё равно начать</button>
        </div>
      </div>
    </div>
    <RulesDialog v-model="rulesOpen" variant="stage" :mode="state.caseInfo.mode" />
  </div>
</template>
