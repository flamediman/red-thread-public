<script setup lang="ts">
import type { Beat, ClientMessage, SettingInfo } from '#shared/types'
import { ART } from '~/utils/art'
import { formatRoom } from '~/utils/room'

useHead({ title: 'Красная нить — кооперативный детектив' })

const { state, connected, ready, hostAuthorized, hostPending, hostChecked, hostReason, roomCode, send, createRoom } = useGame('host')
const { config, loaded: configLoaded } = useConfig()
const audio = useAudio()

/** что показать под названием на заставке: пока сервер не ответил — ничего, чтобы кнопки не сменяли друг друга */
const gateAction = computed<'wait' | 'open' | 'start'>(() => {
  if (!configLoaded.value || !hostChecked.value) return 'wait'
  if (hostAuthorized.value === true) return 'start'
  return config.value.mode === 'public' ? 'open' : 'wait'
})

/* ── время ── */
const deadline = computed(() => state.value?.deadline ?? null)
const { seconds } = useCountdown(deadline)
const phaseTotal = computed(() => state.value?.phaseMs ? state.value.phaseMs / 1000 : null)
const progress = computed(() => (phaseTotal.value && seconds.value != null) ? Math.min(1, seconds.value / phaseTotal.value) : null)

/** «до катера 4 ч 50 мин» — сколько осталось до конца ночи этого дела */
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number) as [number, number]; return h * 60 + m }
const untilDawn = computed(() => {
  const info = state.value?.caseInfo
  if (!info) return ''
  const start = toMinutes(info.clock.start), end = toMinutes(info.clock.end)
  const night = (end - start + 1440) % 1440
  const passed = (toMinutes(state.value?.clock ?? info.clock.start) - start + 1440) % 1440
  const left = Math.max(0, night - passed)
  const hh = Math.floor(left / 60), mm = left % 60
  return left === 0 ? info.timeUp : `${info.countdown} ${hh ? hh + ' ч ' : ''}${mm ? mm + ' мин' : ''}`.trim()
})

/* заставка «Начать игру» нужна один раз — чтобы браузер разрешил звук. Вернулись из одиночной игры — сразу меню */
const started = useState('stage-started', () => audio.unlocked.value)
/** вернулись после перезагрузки: сервер ещё не ответил, пускают ли экран, — не мигать заставкой */
const checking = computed(() => started.value && !hostChecked.value)
const screen = computed(() => state.value?.screen ?? 'menu')
/** какой экран сейчас реально показан: во время затухания старого экрана шапка и тема не должны меняться */
const branchOf = (s: string) => ['prologue', 'resolve', 'verdict', 'epilogue'].includes(s) ? 'scene' : s
const shownScreen = ref<string>('menu')
watch(screen, (s, prev) => { if (!prev || branchOf(s) === branchOf(prev)) shownScreen.value = s })
watch(() => !!state.value, ok => { if (ok) shownScreen.value = screen.value }, { immediate: true })
/** мир, который сейчас на экране меню: от него тема, музыка и атмосфера */
const menuWorld = ref<SettingInfo | null>(null)
/* тема оформления: заставка и меню — бренд «Красной нити», дальше — сеттинг дела */
const brand = computed(() => hostAuthorized.value !== true || !started.value)
useHead({ htmlAttrs: { 'data-setting': computed(() => brand.value ? 'brand' : shownScreen.value === 'menu' ? menuWorld.value?.theme ?? 'noir' : state.value?.setting.theme ?? 'noir') } })
const round = computed(() => state.value?.round ?? 0)
/** «на время»: доля прошедшего поиска по отрезкам расписания (для музыки и атмосферы) */
const fieldShare = computed(() => state.value?.field && state.value.caseInfo.mode === 'realtime' ? (state.value.round + 0.5) / Math.max(1, state.value.roundsTotal) : null)
const realtime = computed(() => state.value?.caseInfo.mode === 'realtime')
const { leftMs: fieldLeft } = useFieldClock(computed(() => state.value))

/* ── фон: фотография по фазе и по текущей реплике ── */
const currentBeat = ref<Beat | null>(null)
/** какая реплика сейчас на экране — карточки доски внизу открываются вместе с ней */
const beatHere = ref<number | null>(null)
const lastLocation = ref<string | null>(null)
/** сцена сообщает, какая реплика на экране; сервер запоминает — после перезагрузки продолжим с неё */
function onBeat(b: Beat | null, index: number) {
  currentBeat.value = b
  beatHere.value = b ? index : null
  if (b) send({ type: 'beatAt', index, beatId: b.id })
}
watch(currentBeat, b => { if (b?.locationId) lastLocation.value = b.locationId })
const backdrop = computed(() => {
  const s = screen.value
  const at = currentBeat.value?.locationId
  // пролог — как ролик: у каждой реплики свой кадр
  if (s === 'prologue') return at && at !== 'cover' ? ART.location(at) : ART.cover
  if (s === 'menu' || s === 'lobby' || s === 'plan' || s === 'tutorial' || s === 'field') return ART.cover
  if (s === 'epilogue' || s === 'final') return ART.dawn
  const stage = state.value?.caseInfo.stage
  if (s === 'discuss') return ART.location(stage?.discuss ?? '')
  if (s === 'accuse') return ART.location(stage?.accuse ?? '')
  return ART.location(currentBeat.value?.locationId ?? lastLocation.value ?? stage?.discuss ?? '')
})
const backdropDim = computed(() => screen.value === 'plan' || screen.value === 'discuss' || screen.value === 'menu' || screen.value === 'accuse' || screen.value === 'tutorial' || screen.value === 'field')
const dawn = computed(() => screen.value === 'epilogue' || screen.value === 'final')
/* дождь в кадре — только на уличных фотографиях: поверх интерьера, карты или доски он выглядит нелепо */
const outdoors = computed(() => (state.value?.caseInfo.stage.outdoors ?? []).some(id => backdrop.value === (id === 'cover' ? ART.cover : ART.location(id))))
const rain = computed<'heavy' | 'soft' | 'off'>(() => {
  if (dawn.value || !outdoors.value || backdropDim.value || state.value?.caseInfo.weather !== 'rain') return 'off'
  return (screen.value === 'lobby' || screen.value === 'menu' || screen.value === 'prologue' || round.value < 5) ? 'heavy' : 'soft'
})

/* ── звук: атмосфера и музыка по фазе ── */
watch([screen, round, () => audio.unlocked.value, () => state.value?.caseInfo.id, menuWorld], ([s, r, ok]) => {
  const amb = state.value?.caseInfo.ambience
  if (!ok || !amb) return
  if (s === 'menu') { if (menuWorld.value) audio.ambience(menuWorld.value.menu.ambience.names, menuWorld.value.menu.ambience.levels ?? {}); return }
  const share = fieldShare.value ?? r / Math.max(1, (state.value?.roundsTotal ?? 12) - 1)
  const cue = s === 'lobby' || s === 'tutorial' ? amb.lobby
    : s === 'epilogue' || s === 'final' ? amb.ending
    : s === 'accuse' || s === 'verdict' ? amb.accuse
    : share < 0.35 ? amb.early : share < 0.7 ? amb.mid : amb.late
  audio.ambience(cue.names, cue.levels ?? {})
}, { immediate: true })

const theme = computed(() => {
  const s = screen.value, r = round.value
  // мир меню ещё не назван (меню только появилось) — музыку не трогаем: тема, что уже играет, дождётся своего мира
  if (s === 'menu') return menuWorld.value ? menuWorld.value.menu.music ?? null : undefined
  if (s === 'lobby' || s === 'tutorial') return 'lobby'
  if (s === 'prologue') return 'prologue'
  const share = fieldShare.value ?? r / Math.max(1, (state.value?.roundsTotal ?? 12) - 1)
  // рассветная тема — только на последней пятой части ночи: раньше она включалась с 70 % и давила остаток партии
  if (s === 'plan' || s === 'resolve' || s === 'field') return share < 0.35 ? 'night-early' : share < 0.8 ? 'night-late' : 'night-dawn'
  if (s === 'discuss') return 'discuss'
  if (s === 'accuse') return 'accuse'
  if (s === 'verdict') return state.value?.verdict?.correct === false ? 'verdict-wrong' : 'epilogue'
  if (s === 'epilogue') return 'epilogue'
  return state.value?.outcome === 'failed' ? 'final-failed' : 'final-solved'
})
watch([theme, () => audio.unlocked.value, () => state.value?.caseInfo.id], ([t, ok]) => { if (ok && t !== undefined) audio.theme(t, t === 'night-dawn' ? 0.7 : 1) }, { immediate: true })

// улица или помещение — от кадра на экране (карта и совещание — внутри)
watch([outdoors, backdropDim, () => audio.unlocked.value], ([out, dim]) => { audio.setOutdoors(!!out && !dim) }, { immediate: true })

// пауза: замирает и звук
watch(() => state.value?.paused ?? false, p => { void audio.setPaused(p) })

watch(screen, (s, prev) => {
  if (!audio.unlocked.value) return
  // новый раунд — тихий бой часов, без драматичных акцентов: они только для событий
  if (s === 'plan' && prev === 'discuss') audio.sfx('clock-bell', 0.22)
  if (s === 'accuse') audio.sfx('rumble', 0.7)
  if (s === 'final') audio.sfx(state.value?.outcome === 'failed' ? 'boat-storm' : 'clock-bell', 0.5)
})

/* ── управление ── */
const scene = ref<{ skip: () => void } | null>(null)
const confirmLobby = ref(false)

async function begin() {
  // если браузер тянет с разрешением звука, экран всё равно включаем — звук подхватится, когда разрешат
  await Promise.race([audio.unlock(), new Promise(r => setTimeout(r, 1500))])
  started.value = true
}
/** в сети: нажатие «Открыть комнату» — тоже жест пользователя, звук разблокируется сразу */
function openRoom() {
  createRoom()
  void begin()
}
function hostSend(msg: ClientMessage) { send(msg) }
function skip() {
  if (['prologue', 'resolve', 'verdict', 'epilogue'].includes(screen.value)) scene.value?.skip()
  else send({ type: 'skip' })
}

/* клавиатура и пульт-кликер: пробел / → / PageDown — «Дальше», P — пауза */
function onKeyboard(e: KeyboardEvent) {
  if (!started.value || !state.value || screen.value === 'lobby' || screen.value === 'menu') return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  if (screen.value === 'tutorial' && e.code === 'ArrowLeft') { e.preventDefault(); send({ type: 'tutorial', step: Math.max(0, (state.value.tutorialStep ?? 0) - 1) }); return }
  if (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'PageDown') { e.preventDefault(); skip() }
  else if (e.code === 'KeyP') { e.preventDefault(); send({ type: 'pause', paused: !state.value.paused }) }
}
onMounted(() => window.addEventListener('keydown', onKeyboard))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyboard))

const screenTitle = computed(() => ({
  menu: 'Выбор дела', lobby: 'Лобби', tutorial: 'Как играть', prologue: 'Пролог', plan: 'Ходы', resolve: 'Разбор', discuss: 'Совещание', field: 'Поиск',
  accuse: 'Обвинение', verdict: 'Вердикт', epilogue: 'Как это было', final: 'Итог'
}[shownScreen.value] ?? ''))

const isScene = computed(() => ['prologue', 'resolve', 'verdict', 'epilogue'].includes(screen.value))
const crew = computed(() => (state.value?.players ?? []).map(p => ({
  ...p, role: state.value?.detectives.find(d => d.id === p.detectiveId)?.title ?? ''
})))
</script>

<template>
  <StageBackdrop
    v-if="hostAuthorized === true && !brand && shownScreen !== 'menu'"
    :src="started ? backdrop : ART.cover"
    :dim="started && backdropDim"
    :rain="started ? rain : 'heavy'"
    :lightning="started && !dawn && !!state?.caseInfo.lightning && screen !== 'menu'"
  />

  <BrandBackdrop v-if="brand && !checking" />

  <TheLoader v-if="checking" />
  <div v-else-if="hostAuthorized !== true || !started" class="gate gate--cover">
    <div class="gate__inner">
      <span class="eyebrow">Кооперативный детектив</span>
      <h1 class="display gate__title">Красная нить</h1>
      <p class="gate__lede">Один экран, телефоны вместо блокнотов, одна ночь на правду.</p>
      <!-- заставка одна и та же, меняется только кнопка: пока сервер не ответил, место под неё просто пустое -->
      <div class="gate__action">
        <!-- без Transition: в фоновой вкладке переход «выход-вход» ждёт кадра и кнопка не появлялась бы -->
        <button v-if="gateAction === 'start'" key="start" class="btn btn--stamp gate__appear" @click="begin">Начать игру</button>
        <div v-else-if="gateAction === 'open'" key="open" class="gate__open gate__appear">
          <button class="btn btn--stamp" :disabled="hostPending" @click="openRoom">{{ hostPending ? 'Открываю…' : 'Открыть комнату' }}</button>
          <p class="gate__hint">{{ hostReason || 'Этот экран станет общим столом. Телефоны подключатся по коду комнаты — без регистрации.' }}</p>
        </div>
        <span v-else key="wait" class="gate__wait" aria-hidden="true" />
      </div>
    </div>
  </div>

  <div v-else class="stage" :class="{ 'stage--menu': shownScreen === 'menu' }">
    <TheLoader v-if="!ready" />
    <p v-if="!connected" class="stage__offline">Нет связи с сервером — переподключаюсь…</p>
    <Transition name="fade">
      <!-- пауза закрывает весь экран, поэтому кнопка «Продолжить» — прямо на ней -->
      <div v-if="state?.paused" class="stage__pause" @click.self="hostSend({ type: 'pause', paused: false })">
        <span class="stage__pause-title">Пауза</span>
        <button class="btn btn--stamp" type="button" @click="hostSend({ type: 'pause', paused: false })">Продолжить</button>
        <span class="stage__pause-hint">или клавиша P</span>
      </div>
    </Transition>

    <header v-if="shownScreen !== 'menu'" class="stage__bar">
      <span class="stage__title">{{ state?.caseInfo.title }}</span>
      <span v-if="roomCode" class="stage__room" title="Код комнаты для телефонов">комната <b class="tabnum">{{ formatRoom(roomCode) }}</b></span>
      <span class="stage__round">
        {{ screenTitle }}<template v-if="realtime && screen === 'field'"> · <b class="tabnum stage__left" :class="{ 'stage__left--low': (fieldLeft ?? 1e9) < 5 * 60_000 }">{{ state?.paused ? 'пауза' : mmss(fieldLeft) }}</b></template><template v-else-if="!realtime && screen !== 'lobby' && screen !== 'final' && screen !== 'tutorial'"> · раунд {{ round + 1 }} из {{ state?.roundsTotal }}</template>
      </span>
      <div v-if="progress != null" class="stage__timer"><i :style="{ transform: `scaleX(${progress})` }" /></div>
      <div class="stage__clock">
        <b class="tabnum">{{ screen === 'lobby' || screen === 'tutorial' ? state?.caseInfo.clock.start : state?.clock }}</b>
        <span>{{ screen === 'lobby' || screen === 'tutorial' ? 'ночь начнётся' : screen === 'final' ? state?.caseInfo.timeUp : untilDawn }}</span>
      </div>
      <div class="stage__controls">
        <button v-if="shownScreen !== 'lobby'" class="ctl" type="button" title="В лобби" @click="confirmLobby = true">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M14 8l-4 4 4 4M10 12h10" /></svg>
          <span>Лобби</span>
        </button>
        <button v-if="shownScreen !== 'lobby'" class="ctl" type="button" :title="state?.paused ? 'Продолжить (P)' : 'Пауза (P)'" @click="hostSend({ type: 'pause', paused: !state?.paused })">
          <svg v-if="state?.paused" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" /></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>
          <span>{{ state?.paused ? 'Продолжить' : 'Пауза' }}</span>
        </button>
        <button class="ctl ctl--icon" type="button" :title="audio.voiceOn.value ? 'Выключить озвучку реплик' : 'Включить озвучку реплик'" :aria-label="audio.voiceOn.value ? 'Выключить озвучку' : 'Включить озвучку'" :class="{ 'ctl--off': !audio.voiceOn.value }" @click="audio.setVoiceOn(!audio.voiceOn.value)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16v11H10l-4.5 3.5V16H4z" />
            <path v-if="audio.voiceOn.value" d="M8 9h8M8 12h5" />
            <path v-else d="M8 8.5l7 6M15 8.5l-7 6" />
          </svg>
        </button>
        <button class="ctl ctl--icon" type="button" :title="audio.muted.value ? 'Включить звук' : 'Выключить звук'" :aria-label="audio.muted.value ? 'Включить звук' : 'Выключить звук'" @click="audio.setMuted(!audio.muted.value)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
            <path v-if="!audio.muted.value" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
            <path v-else d="M16 9.5l5 5M21 9.5l-5 5" />
          </svg>
        </button>
      </div>
    </header>

    <main v-if="state" class="stage__body">
      <Transition name="screen" mode="out-in" @before-enter="shownScreen = screen">
        <StageMenu v-if="screen === 'menu'" :state="state" @send="hostSend" @world="menuWorld = $event" />
        <StageLobby v-else-if="screen === 'lobby'" :state="state" @send="hostSend" />
        <StageTutorial v-else-if="screen === 'tutorial'" :state="state" @send="hostSend" />

        <StageScene
          v-else-if="isScene"
          ref="scene"
          key="scene"
          :beats="state.beats"
          :witnesses="state.witnesses"
          :players="state.players"
          :paused="state.paused"
          :intro="screen === 'prologue'"
          :case-info="state.caseInfo"
          :manual="state.settings.stepping === 'manual' && screen !== 'prologue'"
          :start-at="state.beatIndex"
          :queue-label="screen === 'resolve' ? 'разбор раунда' : screen === 'prologue' ? 'пролог' : screen === 'verdict' ? 'вердикт' : 'как это было'"
          @done="hostSend({ type: 'beatsDone' })"
          @beat="onBeat"
        />

        <StageMap v-else-if="screen === 'plan'" :state="state" :seconds-left="seconds" />
        <StageField v-else-if="screen === 'field'" :state="state" />

        <div v-else-if="screen === 'discuss'" class="discuss">
          <div class="discuss__head">
            <h2 class="display discuss__title">Совещание</h2>
            <p class="lobby__hint">Обсуждайте. Любой может нажать «дальше» на телефоне — при большинстве раунд закрывается раньше.</p>
            <span class="discuss__votes tabnum">за «дальше» {{ state.proceedVotes }} из {{ state.players.filter(p => p.connected).length }}<b v-if="state.settings.timers === 'on' && seconds != null">{{ seconds }} с</b></span>
          </div>
          <StageBoard :state="state" mode="full" />
        </div>

        <StageAccuse v-else-if="screen === 'accuse'" :state="state" :seconds-left="seconds" />
        <StageFinal v-else-if="screen === 'final'" :state="state" @send="hostSend" />
      </Transition>
    </main>

    <footer v-if="state && shownScreen !== 'lobby' && shownScreen !== 'menu' && shownScreen !== 'tutorial' && shownScreen !== 'field'" class="stage__strip">
      <StageBoard v-if="screen === 'plan' || screen === 'resolve'" :state="state" mode="strip" :beat-at="screen === 'resolve' ? beatHere : null" />
      <div v-else class="crew">
        <div v-for="p in crew" :key="p.id" class="crew__item" :class="{ 'crew__item--away': !p.connected }">
          <PlayerAvatar :id="p.id" :name="p.name" :ink="p.ink" :photo="p.photo" :detective-id="p.detectiveId" size="xs" />
          <span class="crew__name">{{ p.name }}</span>
          <span class="crew__role">{{ p.role }}</span>
          <span v-if="screen === 'accuse'" class="crew__done" :class="{ 'crew__done--on': !!state.accusation?.votes[p.id]?.culprit }">✓</span>
        </div>
      </div>
    </footer>

    <div v-if="confirmLobby" class="veil" @click.self="confirmLobby = false">
      <div class="veil__card" role="dialog" aria-modal="true">
        <h2 class="veil__title">Прервать ночь?</h2>
        <p class="veil__text">Партия закончится, доска очистится, все вернутся в лобби.</p>
        <div class="veil__actions">
          <button class="btn btn--ghost" @click="confirmLobby = false">Играем дальше</button>
          <button class="btn btn--stamp" @click="confirmLobby = false; hostSend({ type: 'restart' })">Прервать</button>
        </div>
      </div>
    </div>
  </div>
</template>
