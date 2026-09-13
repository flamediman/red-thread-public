<script setup lang="ts">
import type { Beat, ClientMessage, SettingInfo } from '#shared/types'
import { ART } from '~/utils/art'
import { formatRoom } from '~/utils/room'

useHead({ title: 'Красная нить — экран' })

const { state, connected, ready, hostAuthorized, hostPending, hostReason, roomCode, send, authorize, createRoom } = useGame('host')
const { config, loaded: configLoaded } = useConfig()
const audio = useAudio()

/* ── ворота: код ведущего ── */
const digits = ref(['', '', '', ''])
const boxes = ref<HTMLInputElement[]>([])
function onDigit(i: number, e: Event) {
  const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(-1)
  digits.value[i] = v
  if (v && i < 3) boxes.value[i + 1]?.focus()
  if (digits.value.every(d => d)) authorize(digits.value.join(''))
}
function onKey(i: number, e: KeyboardEvent) {
  if (e.key === 'Backspace' && !digits.value[i] && i > 0) boxes.value[i - 1]?.focus()
}

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

const started = ref(false)
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
  if (s === 'menu' || s === 'lobby' || s === 'plan' || s === 'tutorial') return ART.cover
  if (s === 'epilogue' || s === 'final') return ART.dawn
  const stage = state.value?.caseInfo.stage
  if (s === 'discuss') return ART.location(stage?.discuss ?? '')
  if (s === 'accuse') return ART.location(stage?.accuse ?? '')
  return ART.location(currentBeat.value?.locationId ?? lastLocation.value ?? stage?.discuss ?? '')
})
const backdropDim = computed(() => screen.value === 'plan' || screen.value === 'discuss' || screen.value === 'menu' || screen.value === 'accuse' || screen.value === 'tutorial')
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
  const share = r / Math.max(1, (state.value?.roundsTotal ?? 12) - 1)
  const cue = s === 'lobby' || s === 'tutorial' ? amb.lobby
    : s === 'epilogue' || s === 'final' ? amb.ending
    : s === 'accuse' || s === 'verdict' ? amb.accuse
    : share < 0.35 ? amb.early : share < 0.7 ? amb.mid : amb.late
  audio.ambience(cue.names, cue.levels ?? {})
}, { immediate: true })

const theme = computed(() => {
  const s = screen.value, r = round.value
  if (s === 'menu') return menuWorld.value?.menu.music ?? null
  if (s === 'lobby' || s === 'tutorial') return 'lobby'
  if (s === 'prologue') return 'prologue'
  const share = r / Math.max(1, (state.value?.roundsTotal ?? 12) - 1)
  if (s === 'plan' || s === 'resolve') return share < 0.35 ? 'night-early' : share < 0.7 ? 'night-late' : 'night-dawn'
  if (s === 'discuss') return 'discuss'
  if (s === 'accuse') return 'accuse'
  if (s === 'verdict') return state.value?.verdict?.correct === false ? 'verdict-wrong' : 'epilogue'
  if (s === 'epilogue') return 'epilogue'
  return state.value?.outcome === 'failed' ? 'final-failed' : 'final-solved'
})
watch([theme, () => audio.unlocked.value, () => state.value?.caseInfo.id], ([t, ok]) => { if (ok) audio.theme(t ?? null) }, { immediate: true })

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
  menu: 'Выбор дела', lobby: 'Лобби', tutorial: 'Как играть', prologue: 'Пролог', plan: 'Ходы', resolve: 'Разбор', discuss: 'Совещание',
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

  <BrandBackdrop v-if="brand" />

  <div v-if="hostAuthorized !== true && configLoaded && config.mode === 'public'" class="gate gate--cover">
    <div class="gate__inner">
      <span class="eyebrow">Кооперативный детектив</span>
      <h1 class="display gate__title">Красная нить</h1>
      <p class="gate__lede">Один экран, телефоны вместо блокнотов, одна ночь на правду.</p>
      <button class="btn btn--stamp" style="margin-top: 0.6rem" :disabled="hostPending" @click="openRoom">
        {{ hostPending ? 'Открываю…' : 'Открыть комнату' }}
      </button>
      <p class="gate__hint">{{ hostReason || 'Этот экран станет общим столом. Телефоны подключатся по коду комнаты — без регистрации.' }}</p>
    </div>
  </div>

  <div v-else-if="hostAuthorized !== true" class="gate">
    <div v-if="configLoaded" class="gate__inner">
      <span class="eyebrow">Экран ведущего</span>
      <h1 class="gate__title">Код из терминала</h1>
      <div class="gate__code">
        <input
          v-for="(d, i) in digits"
          :key="i"
          :ref="el => { if (el) boxes[i] = el as HTMLInputElement }"
          class="gate__digit"
          type="tel"
          inputmode="numeric"
          maxlength="1"
          :value="d"
          @input="onDigit(i, $event)"
          @keydown="onKey(i, $event)"
        >
      </div>
      <p class="gate__hint">
        <template v-if="hostPending">Проверяю…</template>
        <template v-else-if="hostAuthorized === false">Код не подошёл — посмотрите в терминале или в .env</template>
        <template v-else>Четыре цифры, которые сервер печатает при запуске</template>
      </p>
    </div>
  </div>

  <div v-else-if="!started" class="gate gate--cover">
    <div class="gate__inner">
      <span class="eyebrow">Кооперативный детектив</span>
      <h1 class="display gate__title">Красная нить</h1>
      <p class="gate__lede">Один экран, телефоны вместо блокнотов, одна ночь на правду.</p>
      <button class="btn btn--stamp" style="margin-top: 0.6rem" @click="begin">Начать игру</button>
    </div>
  </div>

  <div v-else class="stage" :class="{ 'stage--menu': shownScreen === 'menu' }">
    <TheLoader v-if="!ready" />
    <p v-if="!connected" class="stage__offline">Нет связи с сервером — переподключаюсь…</p>
    <Transition name="fade"><div v-if="state?.paused" class="stage__pause">Пауза</div></Transition>

    <header v-if="shownScreen !== 'menu'" class="stage__bar">
      <span class="stage__title">{{ state?.caseInfo.title }}</span>
      <span v-if="roomCode" class="stage__room" title="Код комнаты для телефонов">комната <b class="tabnum">{{ formatRoom(roomCode) }}</b></span>
      <span class="stage__round">
        {{ screenTitle }}<template v-if="screen !== 'lobby' && screen !== 'final' && screen !== 'tutorial'"> · раунд {{ round + 1 }} из {{ state?.roundsTotal }}</template>
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

    <footer v-if="state && shownScreen !== 'lobby' && shownScreen !== 'menu' && shownScreen !== 'tutorial'" class="stage__strip">
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
