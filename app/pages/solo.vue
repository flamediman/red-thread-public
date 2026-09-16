<script setup lang="ts">
/* Одиночная игра («Туман»): один экран — компьютер или планшет.
   Слева кадр места в тумане и текст, справа — состояние героя, что осмотреть, куда идти и что в карманах.
   Сцены, встречи, головоломки и разговоры — поверх, по одному за раз. */
import type { SoloClientMessage, SoloView } from '#shared/types'

useHead({ title: 'Туман — Красная нить', htmlAttrs: { 'data-setting': 'tuman' } })

const route = useRoute()
const storyId = typeof route.query.story === 'string' ? route.query.story : undefined
const { view, connected, error, clockOffset, send } = useSolo(storyId)
const audio = useAudio()

const v = computed(() => view.value)
const story = computed(() => v.value?.info.id ?? '')
const cover = computed(() => story.value ? `/art/${story.value}/cover.jpg` : '')
const coverReady = ref(false)

/* ── заставка и меню ── */
const entered = ref(false)
const menuOpen = ref(false)
const confirmNew = ref(false)
const saveOpen = ref(false)
const mapOpen = ref(false)
const notesOpen = ref(false)
watch(mapOpen, on => { if (on) void audio.sfx('map-unfold', 0.55) })
watch(notesOpen, on => { if (on) void audio.sfx('paper', 0.45) })

async function enter(action: 'continue' | 'new' | { load: number }) {
  await Promise.race([audio.unlock(), new Promise(r => setTimeout(r, 1500))])
  if (action === 'new') { send({ type: 'new' }); endingPlayed.value = null }
  else if (action !== 'continue') send({ type: 'load', slot: action.load })
  entered.value = true
  menuOpen.value = false
  confirmNew.value = false
}
const canContinue = computed(() => !!v.value?.started && !v.value.ending)
function askNew() {
  if (v.value?.started && !v.value.ending && !confirmNew.value) { confirmNew.value = true; return }
  void enter('new')
}

/* ── место ── */
const place = computed(() => v.value?.place ?? null)
/* крупный план: если последнее, что игрок узнал, — осмотр с картинкой, большой кадр места на время сменяется ею.
   Следующее действие, шаг в другое место или щелчок по кадру — обратно к месту */
const closeDismissed = ref(0)
const closeup = computed(() => {
  const last = (v.value?.feed ?? []).filter(f => f.seq > feedFloor.value && (f.text || f.art)).at(-1)
  return last?.art && last.seq > closeDismissed.value ? last : null
})
const shownArt = computed(() => closeup.value?.art ?? place.value?.art ?? '')
const artOk = ref(true)
const artSrc = computed(() => place.value && story.value && shownArt.value ? `/art/${story.value}/${shownArt.value}.jpg` : '')
watch(artSrc, () => { artOk.value = true })
const backToPlace = () => { if (closeup.value) closeDismissed.value = closeup.value.seq }
const darkness = computed(() => !place.value ? 'none' : !place.value.dark ? 'none' : place.value.lit ? 'torch' : 'black')

/* фонарь следует за курсором или пальцем */
const torch = reactive({ x: 62, y: 42 })
function onPointer(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  torch.x = Math.round(((e.clientX - r.left) / r.width) * 100)
  torch.y = Math.round(((e.clientY - r.top) / r.height) * 100)
}

/* лента последствий: после перехода старое уходит, новое — со звуком */
const feedFloor = ref(0)
let lastPlayed = -1
let lastPlace = ''
let lastHealth = 100
const hurtFlash = ref(0)
watch(view, (nv, ov) => {
  if (!nv) return
  const maxSeq = nv.feed.at(-1)?.seq ?? 0
  const prevMax = ov?.feed.at(-1)?.seq ?? 0
  if (lastPlayed < 0) { lastPlayed = maxSeq; feedFloor.value = Math.max(0, maxSeq - 3); lastPlace = nv.place?.id ?? ''; lastHealth = nv.health; return }
  if (nv.place && nv.place.id !== lastPlace) {
    if (lastPlace) void audio.sfx(`step-${nv.place.surface}`, 0.7)
    feedFloor.value = prevMax
    lastPlace = nv.place.id
    mode.value = null
  }
  for (const f of nv.feed) {
    if (f.seq <= lastPlayed) continue
    for (const s of f.sfx ?? []) void audio.sfx(s, 0.9)
    if (f.found) found.value = [...found.value, f.found]
  }
  lastPlayed = maxSeq
  if (nv.health < lastHealth) { hurtFlash.value++; void audio.sfx('groan-m', 0.5) }
  if (nv.dead && !ov?.dead) void audio.sfx('sting-soft', 0.9)
  lastHealth = nv.health
  if (!nv.started) { lastPlace = ''; feedFloor.value = 0; found.value = [] }
})
const feed = computed(() => (v.value?.feed ?? []).filter(f => f.seq > feedFloor.value && f.text).slice(-4))

/* ── здоровье, свет, радио ── */
const healthState = computed(() => {
  const h = v.value?.health ?? 100
  return h > 60 ? { key: 'ok', label: 'Норма' } : h > 30 ? { key: 'hurt', label: 'Ранен' } : { key: 'bad', label: 'Тяжело ранен' }
})
const hasFlashlight = computed(() => !!v.value?.inventory.some(i => i.id === 'flashlight'))
const hasRadio = computed(() => !!v.value?.inventory.some(i => i.id === 'radio'))
const toggleLight = () => { if (v.value && hasFlashlight.value) send({ type: 'light', on: !v.value.light }) }
const toggleRadio = () => { if (v.value && hasRadio.value) { void audio.sfx('radio-click', 0.6); send({ type: 'radio', on: !v.value.radioOn }) } }

/* ── вещи: применить к месту или соединить с другой вещью ── */
type Mode = { kind: 'use' | 'combine'; item: string; name: string } | null
const mode = ref<Mode>(null)
const picked = ref<string | null>(null)
const pickedItem = computed(() => v.value?.inventory.find(i => i.id === picked.value) ?? null)
watch(() => v.value?.inventory, inv => { if (picked.value && !inv?.some(i => i.id === picked.value)) picked.value = null })

function clickItem(id: string) {
  if (mode.value?.kind === 'combine' && mode.value.item !== id) {
    send({ type: 'combine', item: mode.value.item, with: id })
    mode.value = null
    picked.value = null
    return
  }
  mode.value = null
  picked.value = picked.value === id ? null : id
}
function clickHotspot(id: string) {
  if (mode.value?.kind === 'use') { send({ type: 'use', item: mode.value.item, hotspot: id }); mode.value = null; picked.value = null; return }
  send({ type: 'look', hotspot: id })
}
function startMode(kind: 'use' | 'combine') {
  const it = pickedItem.value
  if (!it) return
  mode.value = { kind, item: it.id, name: it.name }
}
function useSelf() {
  const it = pickedItem.value
  if (!it) return
  send({ type: 'use', item: it.id })
  if (it.kind !== 'weapon') picked.value = null
}
const itemVerb = (kind: string) => kind === 'heal' ? 'Перевязаться' : kind === 'battery' ? 'Вставить в фонарь' : kind === 'weapon' ? 'Взять в руки' : 'Рассмотреть'

/* ── оверлеи ── */
const endingPlayed = ref<string | null>(null)
/** находки ждут своей очереди: карточка — когда закончились сцена, разговор и головоломка */
const found = ref<NonNullable<SoloView['feed'][number]['found']>[]>([])
const nextFound = () => { found.value = found.value.slice(1) }
const overlay = computed<'scene' | 'ending-scene' | 'ending' | 'dead' | 'chase' | 'boss' | 'encounter' | 'dialogue' | 'puzzle' | 'found' | null>(() => {
  const s = v.value
  if (!s?.started || !entered.value) return null
  if (s.scene) return 'scene'
  if (s.ending) return endingPlayed.value === s.ending.id ? 'ending' : 'ending-scene'
  if (s.dead) return 'dead'
  if (s.chase) return 'chase'
  if (s.boss) return 'boss'
  if (s.encounter) return 'encounter'
  if (s.dialogue) return 'dialogue'
  if (s.puzzle) return 'puzzle'
  if (found.value.length) return 'found'
  return null
})
const speakers = computed(() => v.value?.speakers ?? {})
const puzzleFail = computed(() => {
  const last = v.value?.feed.at(-1)
  return v.value?.puzzle && last && last.seq > lastPuzzleOpen.value && last.text === v.value.puzzle.puzzle.fail ? last.text : null
})
const lastPuzzleOpen = ref(0)
watch(() => v.value?.puzzle?.hotspot, h => { if (h) lastPuzzleOpen.value = v.value?.feed.at(-1)?.seq ?? 0 })

const sceneDone = () => { if (v.value?.scene) send({ type: 'sceneDone', seq: v.value.scene.seq }) }
const relay = (m: SoloClientMessage) => send(m)

/* ── звук: атмосфера места, радио, сердце, дрожь встречи ── */
/** петли, которые в ленте места должны быть тише остальных (часы в кабинете — не громче гула) */
const AMB_LEVEL: Record<string, number> = { 'clock-tick-slow': 0.3, 'loudspeaker-hum': 0.7, pines: 0.8, 'fog-drip': 0.8 }
watch([() => place.value?.ambience.join(','), () => v.value?.radio, () => !!(v.value?.encounter || v.value?.chase || v.value?.boss), () => (v.value?.health ?? 100) <= 30, entered, () => audio.unlocked.value, () => !!v.value?.ending],
  ([, radio, enc, low, inGame, ok, ended]) => {
    if (!ok) return
    if (!inGame || !v.value?.started || ended) { audio.ambience(['fog-wind'], { 'fog-wind': 0.5 }); return }
    const names = [...(place.value?.ambience ?? [])]
    const levels: Record<string, number> = { ...AMB_LEVEL }
    if (radio) { names.push('radio-static'); levels['radio-static'] = radio === 2 ? 0.95 : 0.35 }
    if (enc) { names.push('dread-drone'); levels['dread-drone'] = 0.8 }
    if (low) { names.push('heartbeat'); levels.heartbeat = 0.7 }
    audio.ambience(names, levels)
  }, { immediate: true })
watch([() => place.value?.outdoor, () => audio.unlocked.value], ([outdoor]) => audio.setOutdoors(!!outdoor), { immediate: true })

/* музыка: тема по району и состоянию, под исследованием — тише ленты атмосферы, в погоне и на заставке — в полную.
   Темы лежат в папке истории; которой нет — заменяется темой мира из меню */
const themeName = computed<string | null>(() => {
  const s = v.value
  if (!s) return null
  if (!entered.value || !s.started) return 'title'
  if (s.ending) return s.ending.id
  if (s.dead) return null
  if (s.chase) return 'chase'
  const area = place.value?.area
  if (area === 'camp') return 'camp'
  if (area === 'sana') return s.otherworld ? 'otherworld' : 'sanatorium'
  return 'town'
})
const themeLevel = computed(() => {
  const s = v.value
  if (!s || !entered.value || !s.started || s.ending || s.chase) return 1
  if (s.encounter || s.boss) return 0.3
  if (s.scene || s.dialogue) return 0.45
  return 0.6
})
// пока история грузится, играет то, что было в меню: у мира и заставки истории одна тема, она не должна обрываться
watch([themeName, themeLevel, () => audio.unlocked.value], ([t, lvl, ok]) => { if (ok && v.value) void audio.theme(t, lvl) }, { immediate: true })

/* далёкие звуки: раз в минуту-полторы где-то в тумане что-то есть — горн, шёпот, ветка, громкоговоритель. Только когда герой
   просто идёт; всё играет через цепочку «далеко» (глухо, с эхом, тише ветра) */
const FAR: Record<string, string[]> = {
  road: ['whisper-far', 'branch-far', 'bugle-far-cut', 'branch-far'],
  town: ['bugle-far-cut', 'whisper-far', 'oarlocks', 'announce-far'],
  sana: ['lantern-chain', 'whisper-far', 'water-lap', 'door-locked'],
  camp: ['bugle-far-cut', 'announce-far', 'whisper-far', 'branch-far', 'lantern-chain']
}
let farTimer: ReturnType<typeof setTimeout> | null = null
function scheduleFar() {
  if (farTimer) clearTimeout(farTimer)
  farTimer = setTimeout(() => {
    const s = v.value
    if (entered.value && s?.started && !overlay.value && !anyPanel.value && !s.ending && audio.unlocked.value && !audio.speaking.value) {
      const pool = FAR[place.value?.area ?? ''] ?? FAR.town!
      void audio.sfx(pool[Math.floor(Math.random() * pool.length)]!, 0.6, true)
    }
    scheduleFar()
  }, 40_000 + Math.random() * 50_000)
}
onMounted(scheduleFar)
onBeforeUnmount(() => { if (farTimer) clearTimeout(farTimer) })

/* ── клавиатура ── */
const anyPanel = computed(() => menuOpen.value || saveOpen.value || mapOpen.value || notesOpen.value)
function onKey(e: KeyboardEvent) {
  if (!entered.value || !v.value?.started || overlay.value) return
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
  // карта и записки закрываются сами — клавиша не должна заодно открыть паузу
  if (mapOpen.value || notesOpen.value) return
  if (e.code === 'Escape') {
    e.preventDefault()
    if (mode.value || picked.value) { mode.value = null; picked.value = null }
    else if (saveOpen.value) saveOpen.value = false
    else menuOpen.value = !menuOpen.value
    return
  }
  if (anyPanel.value) return
  if (e.code === 'KeyM') { e.preventDefault(); mapOpen.value = true }
  else if (e.code === 'KeyJ') { e.preventDefault(); notesOpen.value = true }
  else if (e.code === 'KeyF') { e.preventDefault(); toggleLight() }
  else if (e.code === 'KeyR') { e.preventDefault(); toggleRadio() }
}
onMounted(() => window.addEventListener('keydown', onKey))
// музыку не глушим: уйти отсюда можно только в меню, а оно само сменит тему (или оставит ту же — без обрыва)
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); audio.ambience([]) })

/* в меню «Красной нити»: экран гаснет, потом переход — как смена экранов внутри игры */
const leaving = ref(false)
function toMenu() {
  if (leaving.value) return
  leaving.value = true
  setTimeout(() => void navigateTo('/'), 500)
}

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const slots = computed(() => [0, 1, 2].map(slot => v.value?.saves.find(s => s.slot === slot) ?? null))
type Saves = SoloView['saves']
const lastSave = computed<Saves[number] | null>(() => [...(v.value?.saves ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null)
</script>

<template>
  <div class="solo" :class="{ 'solo--other': v?.otherworld, 'solo--leaving': leaving }">
    <TheLoader v-if="!v && !error" />

    <!-- ── заставка ── -->
    <section v-else-if="!entered || !v?.started" class="solo-title">
      <!-- обложка проявляется, когда догрузилась, а не выскакивает поверх уже проявившейся заставки -->
      <img v-if="cover" class="solo-title__art" :class="{ on: coverReady }" :src="cover" alt="" @load="coverReady = true" @error="($event.target as HTMLImageElement).hidden = true">
      <i class="solo-tint" aria-hidden="true" />
      <SoloFog :density="1" />
      <div class="solo-title__body">
        <a href="/" class="solo-title__back" @click.prevent="toMenu">← Красная нить</a>
        <span class="solo-label">Туман · одиночная игра</span>
        <h1 class="solo-title__name">{{ v?.info.title ?? 'Туман' }}</h1>
        <p v-if="v" class="solo-title__lede">{{ v.info.lede }}</p>
        <p v-if="error" class="solo-title__error">{{ error }}</p>
        <div v-if="v" class="solo-title__actions">
          <button v-if="canContinue" type="button" class="solo-btn" @click="enter('continue')">Продолжить</button>
          <button type="button" class="solo-btn" :class="{ 'solo-btn--ghost': canContinue }" @click="askNew">{{ confirmNew ? 'Точно начать заново?' : 'Новая игра' }}</button>
          <button v-for="s in v.saves" :key="s.slot" type="button" class="solo-btn solo-btn--ghost" @click="enter({ load: s.slot })">Загрузить: {{ s.place }} · {{ when(s.at) }}</button>
        </div>
        <p class="solo-title__hint">{{ v?.info.minutes }} минут · лучше в наушниках и в темноте · сохраняться можно только у телефонов</p>
        <p v-if="!connected && v" class="solo-title__error">Нет связи — переподключаюсь…</p>
      </div>
    </section>

    <!-- ── игра ── -->
    <template v-else>
      <main class="solo-main">
        <div
          class="solo-view" :class="[`solo-view--${darkness}`, { 'solo-view--noart': !artOk, 'solo-view--weak': v.battery < 15 }]"
          :style="{ '--lx': `${torch.x}%`, '--ly': `${torch.y}%` }"
          @pointermove="onPointer" @pointerdown="onPointer" @click="backToPlace"
        >
          <!-- длительность явно: у кадра бесконечная анимация наезда, и без неё Vue ждал бы её конца, а старый кадр висел бы минуту -->
          <Transition name="solo-cut" :duration="{ enter: 1400, leave: 900 }">
            <!-- темнота — классом на самом кадре: уходящий кадр тёмной комнаты остаётся тёмным, пока растворяется, а не вспыхивает серым -->
            <img v-if="artOk && artSrc" :key="artSrc" class="solo-view__art" :class="`solo-view__art--${darkness}`" :src="artSrc" :style="{ objectPosition: v.artFocus[shownArt] }" alt="" @error="artOk = false">
          </Transition>
          <Transition name="fade">
            <button v-if="closeup && artOk" type="button" class="solo-view__back" @click.stop="backToPlace">← {{ place?.name }}</button>
          </Transition>
          <i class="solo-tint" aria-hidden="true" />
          <SoloFog :density="place?.ambience.includes('room-hum') ? 0.45 : 1" :other="v.otherworld" />
          <i class="solo-view__dark" aria-hidden="true" />
          <i :key="hurtFlash" class="solo-view__hurt" :class="{ on: hurtFlash > 0 }" aria-hidden="true" />
          <i v-if="v.health <= 30" class="solo-view__pulse" aria-hidden="true" />
        </div>

        <div class="solo-story">
          <Transition name="fade" mode="out-in">
            <h2 :key="place?.id" class="solo-story__place">{{ place?.name }}</h2>
          </Transition>
          <Transition name="fade" mode="out-in">
            <div :key="`${place?.id}-${place?.text.join('').length ?? 0}`" class="solo-story__text">
              <p v-for="(t, i) in place?.text" :key="i">{{ t }}</p>
            </div>
          </Transition>
          <TransitionGroup name="solo-feed" tag="div" class="solo-feed" aria-live="polite">
            <p v-for="f in feed" :key="f.seq" class="solo-feed__line">{{ f.text }}</p>
          </TransitionGroup>
        </div>
      </main>

      <aside class="solo-side">
        <div class="solo-tools">
          <button type="button" class="solo-tool" title="Карта (M)" @click="mapOpen = true"><SoloIcon name="map" /><span>Карта</span></button>
          <button type="button" class="solo-tool" title="Записки (J)" @click="notesOpen = true"><SoloIcon name="notes" /><span>Записки</span><b v-if="v.notes.length" class="tabnum">{{ v.notes.length }}</b></button>
          <button type="button" class="solo-tool" :disabled="!v.canSave" :title="v.canSave ? place?.save ?? '' : 'Сохраниться можно только у телефона'" @click="saveOpen = true"><SoloIcon name="phone" /><span>Сохранить</span></button>
          <button type="button" class="solo-tool" title="Меню (Esc)" @click="menuOpen = true"><SoloIcon name="menu" /><span>Меню</span></button>
        </div>

        <div class="solo-status">
          <div class="solo-ecg" :class="`solo-ecg--${healthState.key}`" :title="healthState.label">
            <svg viewBox="0 0 200 40" aria-hidden="true">
              <path class="solo-ecg__base" pathLength="100" d="M0 22 H40 L46 22 L50 6 L55 36 L60 22 H100 H140 L146 22 L150 6 L155 36 L160 22 H200" />
              <path class="solo-ecg__beat" pathLength="100" d="M0 22 H40 L46 22 L50 6 L55 36 L60 22 H100 H140 L146 22 L150 6 L155 36 L160 22 H200" />
            </svg>
            <span>{{ healthState.label }}</span>
          </div>
          <button v-if="hasFlashlight" type="button" class="solo-light" :class="{ on: v.light }" title="Фонарь (F)" @click="toggleLight">
            <SoloIcon name="item-flashlight" />
            <span class="solo-light__bar"><i :style="{ transform: `scaleX(${v.battery / 100})` }" /></span>
            <span class="tabnum">{{ v.battery }}%</span>
          </button>
          <button v-if="hasRadio" type="button" class="solo-radio" :class="[`solo-radio--${v.radio}`, { 'solo-radio--off': !v.radioOn }]" :title="v.radioOn ? 'Приёмник шипит, когда рядом что-то есть. Щелчок — выключить (R)' : 'Приёмник выключен. Щелчок — включить (R)'" @click="toggleRadio">
            <SoloIcon name="item-radio" /><span><i /><i /><i /><i /><i /></span><small>{{ v.radioOn ? '' : 'выкл' }}</small>
          </button>
          <div v-if="v.weapon || v.ammo" class="solo-weapon"><SoloIcon :name="v.inventory.find(i => i.equipped)?.icon ?? 'weapon'" />{{ v.weapon ?? 'без оружия' }}<b v-if="v.ammo" class="tabnum"> · патронов {{ v.ammo }}</b></div>
        </div>

        <p v-if="mode" class="solo-mode">
          {{ mode.kind === 'use' ? `Применить «${mode.name}» — к чему?` : `Соединить «${mode.name}» — с чем?` }}
          <button type="button" @click="mode = null; picked = null">отмена</button>
        </p>

        <section v-if="v.hotspots.length" class="solo-block">
          <p class="solo-label">Осмотреть</p>
          <button
            v-for="h in v.hotspots" :key="h.id" type="button" class="solo-row"
            :class="[`solo-row--${h.kind}`, { 'solo-row--done': h.done, 'solo-row--target': mode?.kind === 'use' }]"
            @click="clickHotspot(h.id)"
          ><SoloIcon :name="h.kind === 'talk' ? 'talk' : h.kind === 'puzzle' ? 'lock' : 'eye'" />{{ h.name }}</button>
        </section>

        <section class="solo-block">
          <p class="solo-label">Идти</p>
          <button
            v-for="x in v.exits" :key="x.to" type="button" class="solo-row solo-row--exit"
            :class="{ 'solo-row--locked': x.locked, 'solo-row--new': !x.known }"
            :disabled="!!mode" @click="send({ type: 'go', to: x.to })"
          ><SoloIcon :name="x.locked ? 'lock' : 'step'" />{{ x.label }}</button>
        </section>

        <section class="solo-block solo-block--bag">
          <p class="solo-label">В карманах</p>
          <div class="solo-bag">
            <button
              v-for="it in v.inventory" :key="it.id" type="button" class="solo-item"
              :class="{ on: picked === it.id, 'solo-item--equipped': it.equipped, 'solo-item--target': mode?.kind === 'combine' && mode.item !== it.id }"
              :title="it.description" @click="clickItem(it.id)"
            ><SoloIcon :name="it.icon" /><span>{{ it.name }}</span><b v-if="it.count > 1" class="tabnum">×{{ it.count }}</b></button>
          </div>
          <div v-if="pickedItem && !mode" class="solo-detail">
            <img :key="pickedItem.art" class="solo-detail__art" :src="`/art/${story}/${pickedItem.art}.jpg`" alt="" @error="($event.target as HTMLImageElement).hidden = true">
            <p>{{ pickedItem.description }}</p>
            <div class="solo-detail__actions">
              <button v-if="pickedItem.usable && !pickedItem.equipped" type="button" class="solo-btn solo-btn--small" @click="useSelf">{{ itemVerb(pickedItem.kind) }}</button>
              <button v-if="v.hotspots.length" type="button" class="solo-btn solo-btn--small solo-btn--ghost" @click="startMode('use')">Применить к…</button>
              <button v-if="v.inventory.length > 1" type="button" class="solo-btn solo-btn--small solo-btn--ghost" @click="startMode('combine')">Соединить с…</button>
            </div>
          </div>
        </section>
      </aside>

      <!-- ── панели ── -->
      <SoloMap v-if="mapOpen" :map="v.map" :area="place?.area ?? ''" @close="mapOpen = false" />
      <SoloNotes v-if="notesOpen" :notes="v.notes" @close="notesOpen = false" />

      <div v-if="saveOpen" class="solo-veil" @click.self="saveOpen = false">
        <div class="solo-card" role="dialog" aria-modal="true">
          <p class="solo-label">Сохранение</p>
          <p class="solo-card__lede">{{ place?.save }}.</p>
          <button v-for="(s, i) in slots" :key="i" type="button" class="solo-slot" :disabled="!v.canSave" @click="send({ type: 'save', slot: i }); saveOpen = false">
            <b>Ячейка {{ i + 1 }}</b><span>{{ s ? `${s.place} · ${when(s.at)} · ${s.minutes} мин` : 'пусто' }}</span>
          </button>
          <button type="button" class="solo-btn solo-btn--ghost" @click="saveOpen = false">Назад</button>
        </div>
      </div>

      <div v-if="menuOpen" class="solo-veil" @click.self="menuOpen = false">
        <div class="solo-card" role="dialog" aria-modal="true">
          <p class="solo-label">Пауза · {{ v.info.title }}</p>
          <button type="button" class="solo-btn" @click="menuOpen = false">Вернуться</button>
          <button v-for="s in v.saves" :key="s.slot" type="button" class="solo-btn solo-btn--ghost" @click="enter({ load: s.slot })">Загрузить: {{ s.place }} · {{ when(s.at) }}</button>
          <button type="button" class="solo-btn solo-btn--ghost" @click="audio.setVoiceOn(!audio.voiceOn.value)">{{ audio.voiceOn.value ? 'Озвучка: включена' : 'Озвучка: выключена' }}</button>
          <button type="button" class="solo-btn solo-btn--ghost" @click="audio.setMuted(!audio.muted.value)">{{ audio.muted.value ? 'Включить звук' : 'Выключить звук' }}</button>
          <button type="button" class="solo-btn solo-btn--ghost" @click="askNew">{{ confirmNew ? 'Точно? Несохранённое пропадёт' : 'Начать заново' }}</button>
          <button type="button" class="solo-btn solo-btn--ghost" @click="entered = false; menuOpen = false">На заставку</button>
          <p class="solo-muted solo-keys">M — карта · J — записки · F — фонарь · R — приёмник · 1–5 — действия во встрече</p>
        </div>
      </div>

      <!-- ── поверх всего ── -->
      <SoloScene v-if="overlay === 'scene' && v.scene" :key="v.scene.seq" :lines="v.scene.lines" :story="story" :hero="v.info.hero" :speakers="speakers" :focus="v.artFocus" :fallback="artOk ? artSrc : null" @done="sceneDone" />
      <SoloScene v-else-if="overlay === 'ending-scene' && v.ending" :key="`end-${v.ending.id}`" :lines="v.ending.lines" :story="story" :hero="v.info.hero" :speakers="speakers" :focus="v.artFocus" :fallback="artOk ? artSrc : null" @done="endingPlayed = v.ending!.id" />
      <SoloChase v-else-if="overlay === 'chase' && v.chase" :chase="v.chase" :story="story" :focus="v.artFocus" :offset="clockOffset" @send="relay" />
      <SoloBoss v-else-if="overlay === 'boss' && v.boss" :boss="v.boss" :story="story" :focus="v.artFocus" :offset="clockOffset" @send="relay" />
      <SoloEncounter v-else-if="overlay === 'encounter' && v.encounter" :enc="v.encounter" :story="story" :focus="v.artFocus" :offset="clockOffset" :light="v.light" @send="relay" />
      <SoloDialogue v-else-if="overlay === 'dialogue' && v.dialogue" :data="v.dialogue" :story="story" :hero="v.info.hero" @send="relay" />
      <SoloPuzzle v-else-if="overlay === 'puzzle' && v.puzzle" :data="v.puzzle" :story="story" :last-fail="puzzleFail" @send="relay" />
      <SoloFound v-else-if="overlay === 'found' && found[0]" :key="`${found.length}-${found[0].id}`" :item="found[0]" :story="story" :more="found.length - 1" @done="nextFound" />

      <div v-if="overlay === 'dead'" class="solo-end solo-end--dead" role="alertdialog">
        <SoloFog :density="1.2" other />
        <div class="solo-end__body">
          <p class="solo-label">{{ v.info.death.note }}</p>
          <h2 class="solo-end__title">{{ v.info.death.title }}</h2>
          <div class="solo-title__actions">
            <button v-if="lastSave" type="button" class="solo-btn" @click="send({ type: 'load', slot: lastSave.slot })">С последнего сохранения: {{ lastSave.place }}</button>
            <button v-for="s in v.saves.filter(x => x.slot !== lastSave?.slot)" :key="s.slot" type="button" class="solo-btn solo-btn--ghost" @click="send({ type: 'load', slot: s.slot })">Загрузить: {{ s.place }}</button>
            <button type="button" class="solo-btn" :class="{ 'solo-btn--ghost': lastSave }" @click="send({ type: 'new' }); endingPlayed = null">Начать сначала</button>
          </div>
        </div>
      </div>

      <div v-if="overlay === 'ending' && v.ending" class="solo-end" role="dialog">
        <img v-if="cover" class="solo-title__art" :src="cover" alt="" @error="($event.target as HTMLImageElement).hidden = true">
        <i class="solo-tint" aria-hidden="true" />
        <SoloFog :density="0.9" />
        <div class="solo-end__body">
          <p class="solo-label">Концовка</p>
          <h2 class="solo-end__title">{{ v.ending.title }}</h2>
          <dl class="solo-end__stats">
            <div><dt>в игре</dt><dd class="tabnum">{{ v.ending.stats.minutes }} мин</dd></div>
            <div><dt>сохранений</dt><dd class="tabnum">{{ v.ending.stats.saves }}</dd></div>
            <div><dt>смертей</dt><dd class="tabnum">{{ v.ending.stats.deaths }}</dd></div>
            <div><dt>упокоено</dt><dd class="tabnum">{{ v.ending.stats.kills }}</dd></div>
          </dl>
          <div class="solo-title__actions">
            <button type="button" class="solo-btn" @click="send({ type: 'new' }); endingPlayed = null">Сыграть снова</button>
            <a href="/" class="solo-btn solo-btn--ghost" @click.prevent="toMenu">В меню «Красной нити»</a>
          </div>
        </div>
      </div>

      <p v-if="!connected" class="solo-offline">Нет связи — переподключаюсь…</p>
    </template>
  </div>
</template>
