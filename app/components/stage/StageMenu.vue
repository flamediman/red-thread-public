<script setup lang="ts">
import type { ClientMessage, PublicState, SettingInfo } from '#shared/types'
import { roomCode } from '~/composables/useGame'
import { formatRoom } from '~/utils/room'

/* phone — экран телефона: дела показываются, но лобби с него не открыть (ведущий экран — планшет или компьютер) */
const props = defineProps<{ state: PublicState; phone?: boolean }>()
const emit = defineEmits<{ send: [ClientMessage]; world: [SettingInfo] }>()

/* ── миры: карусель, у каждого — арт, бригада, дела ── */
const worlds = computed(() => props.state.catalog.map(g => ({
  ...g,
  art: `/art/settings/${g.setting.id}.jpg`,
  crew: g.detectives.slice(0, 8).map(id => `/art/${g.setting.id}/d_${id}.jpg`),
  cases: g.cases.map(c => {
    const games = props.state.history.filter(h => h.caseId === c.id)
    const last = games[0]
    const when = last ? new Date(last.finishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : ''
    // режим — первым словом у каждого дела: без него «по раундам» не отличить от «на время»
    return { ...c, modeLabel: c.mode === 'realtime' ? 'на время' : 'по раундам', meta: [`${c.players} игроков`, `${c.minutes} минут`, last ? `сыграно: ${c.outcomes.short[last.outcome]}, ${when}` : ''].filter(Boolean).join(' · ') }
  })
})))

const KEY = 'rn:menu-world'
/* мир, который смотрели в прошлый раз, — сразу, без перелистывания при открытии меню */
function savedIndex() {
  try { const saved = localStorage.getItem(KEY); const i = worlds.value.findIndex(w => w.setting.id === saved); return i >= 0 ? i : 0 } catch { return 0 }
}
const index = ref(savedIndex())
const dir = ref<1 | -1>(1)
const world = computed(() => worlds.value[Math.min(index.value, worlds.value.length - 1)])
/* тема, шрифты и музыка мира переключаются, когда старый мир уже ушёл с экрана,
   а новый только начинает появляться, — старый текст не перерисовывается чужим шрифтом */
const announce = () => { if (world.value) emit('world', world.value.setting) }
onMounted(announce)
watch(() => worlds.value.length, announce)

function go(step: 1 | -1) {
  const n = worlds.value.length
  if (n < 2) return
  dir.value = step
  index.value = (index.value + step + n) % n
  try { localStorage.setItem(KEY, world.value!.setting.id) } catch { /* приватный режим */ }
}
function pick(i: number) { if (i !== index.value) { dir.value = i > index.value ? 1 : -1; index.value = i; try { localStorage.setItem(KEY, world.value!.setting.id) } catch { /* приватный режим */ } } }

/* стрелки клавиатуры; свайпа нет — жест иногда листал два мира подряд, миры переключаются стрелками и точками */
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/* одиночная игра — отдельная страница: меню сначала гаснет, как перед лобби обычного дела, и только потом переход */
const leaving = ref(false)
function openSolo(e: MouseEvent, id: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  if (leaving.value) return
  leaving.value = true
  new Image().src = `/art/${id}/cover.jpg` // обложка заставки грузится, пока меню гаснет
  setTimeout(() => void navigateTo({ path: '/solo', query: { story: id } }), 500)
}
</script>

<template>
  <div class="menu" :class="{ 'menu--leaving': leaving }">
    <!-- арт мира на весь экран, миры сменяются перекрёстным затуханием -->
    <TransitionGroup name="world-art" tag="div" class="menu__art" aria-hidden="true">
      <img v-if="world" :key="world.setting.id" class="menu__art-img" :src="world.art" alt="">
    </TransitionGroup>
    <div class="menu__scrim" aria-hidden="true" />

    <header class="menu__brand">
      <span class="menu__logo">Красная нить</span>
      <span class="menu__tag">кооперативный детектив</span>
      <div class="menu__aside">
        <ProjectLinks />
        <span v-if="roomCode" class="menu__room">комната <b class="tabnum">{{ formatRoom(roomCode) }}</b></span>
      </div>
    </header>

    <section v-if="!worlds.length" class="menu__empty">
      <span class="world__eyebrow">Дела не подключены</span>
      <h1>Сценариев пока нет</h1>
      <p>Движок игры готов, но дела с разгадками лежат в отдельном репозитории. Положите папку с делами рядом,
        укажите её в <code>.env</code> строкой <code>CASES_DIR=../red-thread-secret</code> и пересоберите сервер.</p>
    </section>

    <Transition :name="dir > 0 ? 'world-next' : 'world-prev'" mode="out-in" @after-leave="announce">
      <section v-if="world" :key="world.setting.id" class="world" :data-world="world.setting.theme">
        <span class="world__eyebrow">Мир {{ index + 1 }} из {{ worlds.length }}</span>
        <h1 class="world__title">{{ world.setting.title }}</h1>
        <p class="world__sub">{{ world.setting.subtitle }}</p>
        <div v-if="world.crew.length" class="world__crew">
          <span><img v-for="src in world.crew" :key="src" :src="src" alt=""></span>
          {{ world.detectives.length }} сыщиков, у каждого своя способность
        </div>
        <div class="world__cases">
          <button
            v-for="c in world.cases"
            :key="c.id"
            type="button"
            class="case-row"
            :class="{ 'case-row--phone': phone }"
            :disabled="!c.ready || phone"
            @click="emit('send', { type: 'selectCase', caseId: c.id })"
          >
            <span class="case-row__stamp">{{ c.stamp }}</span>
            <span class="case-row__title">{{ c.title }}</span>
            <span class="case-row__go" aria-hidden="true">→</span>
            <span class="case-row__sub">{{ c.subtitle }}</span>
            <span class="case-row__meta"><b>{{ c.modeLabel }}</b> · {{ c.meta }}</span>
          </button>
          <p v-if="phone && world.cases.length" class="world__phone-note">Лобби открывается на планшете или компьютере. Телефон — для игроков: redthread-game.ru/play</p>
          <a v-for="s in world.solo" :key="s.id" :href="`/solo?story=${s.id}`" class="case-row" :class="{ 'case-row--off': !s.ready }" @click="openSolo($event, s.id)">
            <span class="case-row__stamp">{{ s.date }}</span>
            <span class="case-row__title">{{ s.title }}</span>
            <span class="case-row__go" aria-hidden="true">→</span>
            <span class="case-row__sub">{{ s.subtitle }}</span>
            <span class="case-row__meta"><b>одиночная игра</b> · компьютер или планшет · {{ s.minutes }} минут</span>
          </a>
        </div>
      </section>
    </Transition>

    <nav v-if="worlds.length > 1" class="menu__nav" aria-label="Миры">
      <button type="button" class="menu__arrow" aria-label="Предыдущий мир" @click="go(-1)">←</button>
      <button
        v-for="(w, i) in worlds"
        :key="w.setting.id"
        type="button"
        class="menu__dot"
        :class="{ 'menu__dot--on': i === index }"
        @click="pick(i)"
      >{{ w.setting.title }}</button>
      <button type="button" class="menu__arrow" aria-label="Следующий мир" @click="go(1)">→</button>
    </nav>
  </div>
</template>
