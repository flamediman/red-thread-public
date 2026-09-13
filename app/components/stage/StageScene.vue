<script setup lang="ts">
import type { Beat, CaseInfo, Player, PublicWitness } from '#shared/types'
import { INKS } from '#shared/inks'
import { ART } from '~/utils/art'

const props = defineProps<{
  beats: Beat[]
  witnesses: PublicWitness[]
  players?: Player[]
  paused: boolean
  caseInfo: CaseInfo
  queueLabel?: string
  intro?: boolean
  startAt?: number
  manual?: boolean
}>()
const emit = defineEmits<{ done: []; beat: [Beat | null, number] }>()

const audio = useAudio()

const index = ref(0)
/** сколько слов реплики уже проявлено: разметка не прыгает — все слова на месте с самого начала, они просто прозрачные */
const shown = ref(0)
const finished = ref(false)
/** титульная карточка перед прологом — как заставка ролика */
const titleCard = ref(false)
/** подложка появляется только когда титры полностью погасли */
const introDone = ref(true)
/** пошаговый режим: реплика дочитана и ждёт «Дальше» */
const awaiting = ref(false)
let resolveNext: (() => void) | null = null
let run = 0            // номер текущего прогона — старые таймеры отменяются
let skipCurrent = () => {}

const beat = computed(() => props.beats[index.value] ?? null)
watch(beat, b => emit('beat', b, index.value), { immediate: true })

/** слова реплики вместе с пробелами — переносы строк не меняются при проявлении */
const tokens = computed(() => {
  let n = 0
  return (beat.value?.text ?? '').split(/(\s+)/).filter(Boolean).map(w => {
    const space = /^\s+$/.test(w)
    return { w, space, n: space ? n : ++n }
  })
})
const wordCount = computed(() => tokens.value.reduce((m, t) => Math.max(m, t.n), 0))

const speaker = computed(() => {
  const b = beat.value
  if (!b || b.speaker === 'narrator') return null
  if (b.speaker === 'inspector') return { id: 'inspector', name: props.caseInfo.helper.name, role: props.caseInfo.helper.role, art: ART.witness('inspector') }
  const w = props.witnesses.find(x => x.id === b.speaker)
  return w ? { id: w.id, name: w.name, role: w.role, art: ART.witness(w.id) } : null
})

/** чей ход — для реплик рассказчика в разборе */
const actor = computed(() => {
  const b = beat.value
  if (!b?.playerId || !props.players) return null
  const p = props.players.find(x => x.id === b.playerId)
  return p ? { ...p, color: INKS[p.ink] ?? INKS[0] } : null
})

const MOOD: Record<string, string> = {
  calm: 'спокойно', nervous: 'нервничает', evasive: 'уходит от ответа', grief: 'с горечью', angry: 'зло', drunk: 'нетрезв', warm: 'приветливо'
}
const moodLabel = computed(() => {
  const b = beat.value
  if (!b || b.speaker === 'narrator' || b.speaker === 'inspector') return ''
  return MOOD[b.mood ?? ''] ?? ''
})

/* фото улики всплывает, когда проявилась половина реплики */
const evidence = computed(() => {
  const b = beat.value
  if (!b?.itemId) return null
  return { src: ART.item(b.itemId), name: b.itemName ?? '' }
})
const showEvidence = computed(() => !!evidence.value && shown.value >= Math.ceil(wordCount.value / 2))

/* ── плавная прокрутка подложки: текущая строка всегда видна ── */
const scroller = ref<HTMLElement | null>(null)
function follow() {
  const box = scroller.value
  if (!box) return
  const last = [...box.querySelectorAll<HTMLElement>('.dlg__w--on')].pop()
  if (!last) { box.scrollTo({ top: 0 }); return }
  const bottom = last.offsetTop + last.offsetHeight
  const view = box.scrollTop + box.clientHeight
  if (bottom > view - 4) box.scrollTo({ top: bottom - box.clientHeight + last.offsetHeight * 0.6, behavior: 'smooth' })
}
watch(shown, () => nextTick(follow))
watch(index, () => nextTick(() => scroller.value?.scrollTo({ top: 0 })))

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function playBeat(b: Beat, my: number) {
  shown.value = 0
  audio.stopVoice()   // предыдущая реплика не должна дозвучивать поверх новой
  for (const s of b.sfx ?? []) void audio.sfx(s, 0.9)

  // голос: если файл есть, слова проявляются в темпе речи
  const v = await audio.voice(b.id)
  if (my !== run) return
  const total = Math.max(1, wordCount.value)
  const perWord = v.played && v.duration > 0 ? Math.max(90, (v.duration * 1000 * 0.9) / total) : 170

  let cancelled = false
  skipCurrent = () => { cancelled = true }
  for (let i = 1; i <= total && !cancelled; i++) {
    if (my !== run) return
    while (props.paused && my === run) await sleep(200)
    shown.value = i
    await sleep(perWord)
  }
  shown.value = total
  if (my !== run) return

  if (!cancelled) {
    // ждём конца голоса; резервное ожидание не тикает на паузе (звук тогда тоже стоит)
    let spoken = !v.played
    void v.done.then(() => { spoken = true })
    let waited = 0
    const limit = v.played ? v.duration * 1000 + 500 : 0
    while (!spoken && waited < limit) {
      await sleep(100)
      if (my !== run) return
      if (!props.paused) waited += 100
    }
  }
  if (props.manual) {
    // пошаговый разбор: следующая реплика — только по «Дальше» (даже если эту дочитали досрочно)
    awaiting.value = true
    await new Promise<void>(r => { resolveNext = r })
    awaiting.value = false
  } else if (!cancelled) {
    await sleep(b.pauseAfter ?? 500)
  }
}

async function playFrom(start: number) {
  const my = ++run
  finished.value = false
  awaiting.value = false
  if (props.intro && start === 0) {
    introDone.value = false
    titleCard.value = true
    setTimeout(() => { if (my === run && props.caseInfo.lightning) void audio.sfx('thunder-clap', 0.5) }, 600)
    for (let t = 0; t < 45 && titleCard.value && my === run; t++) await sleep(100)
    titleCard.value = false
    if (my !== run) return
    await sleep(1500)   // титры гаснут 1,4 с
    introDone.value = true
  }
  for (let i = start; i < props.beats.length; i++) {
    if (my !== run) return
    index.value = i
    await playBeat(props.beats[i]!, my)
  }
  if (my !== run) return
  finished.value = true
  emit('done')
}

/** «Дальше»: заставка → пропустить; реплика печатается → проявить целиком; дочитана → следующая */
function skip() {
  if (titleCard.value) { titleCard.value = false; return }
  if (!introDone.value) return
  if (awaiting.value) { const r = resolveNext; resolveNext = null; r?.(); return }
  if (finished.value) { emit('done'); return }
  if (shown.value < wordCount.value) { skipCurrent(); return }
  const next = index.value + 1
  if (next >= props.beats.length) { run++; finished.value = true; emit('done'); return }
  playFrom(next)
}

/* перезапускаем только когда набор реплик действительно другой: состояние приходит с сервера при любом
   событии (кто-то переподключился), и массив beats каждый раз новый, хотя реплики те же */
const beatsKey = computed(() => props.beats.map(b => b.id).join('|'))
watch(beatsKey, () => {
  // после перезагрузки экрана продолжаем с реплики, которую сервер запомнил
  const start = Math.min(props.startAt ?? 0, Math.max(0, props.beats.length - 1))
  index.value = start
  playFrom(start)
}, { immediate: true })
onBeforeUnmount(() => { run++; introDone.value = true; resolveNext?.(); audio.stopVoice(); emit('beat', null, 0) })

defineExpose({ skip })
</script>

<template>
  <div class="scene" :class="{ 'scene--solo': !speaker }">
    <Transition name="title">
      <div v-if="titleCard" class="title-card">
        <div>
          <span class="stamp title-card__stamp">{{ caseInfo.stamp }}</span>
          <h1 class="display title-card__title">{{ caseInfo.title }}</h1>
          <p class="title-card__date">{{ caseInfo.date }}</p>
        </div>
      </div>
    </Transition>



    <div v-show="introDone && !titleCard && beat" class="dlg" :class="{ 'dlg--narrator': !speaker, 'dlg--speaker': !!speaker, 'dlg--phone': beat?.speaker === 'inspector' }">
      <Transition name="speaker" mode="out-in">
        <div v-if="speaker && !titleCard" :key="speaker.id" class="scene__portrait photo" :class="`scene__portrait--${speaker.id}`">
          <i class="photo__pin" />
          <img class="photo__img" :src="speaker.art" :alt="speaker.name">
        </div>
      </Transition>
      <Transition name="evidence">
        <div v-if="evidence && showEvidence" :key="evidence.src" class="photo scene__evidence">
          <span class="stamp scene__evidence-tag">в улики</span>
          <img class="photo__img" :src="evidence.src" :alt="evidence.name">
          <div class="photo__caption">{{ evidence.name }}</div>
        </div>
      </Transition>
      <div class="dlg__plate">
        <template v-if="speaker">
          <b class="dlg__name">{{ speaker.name }}</b>
          <span class="dlg__role">{{ speaker.role }}</span>
          <span v-if="moodLabel" class="dlg__mood">{{ moodLabel }}</span>
        </template>
        <template v-else>
          <span v-if="actor" class="dlg__actor"><span class="det-dot" :style="{ '--chip-ink': actor.color }" />ход: {{ actor.name }}</span>
          <span v-else class="dlg__role">рассказчик</span>
        </template>
        <span class="dlg__queue">
          {{ queueLabel ?? '' }}<template v-if="beats.length > 1"> · {{ index + 1 }} / {{ beats.length }}</template>
        </span>
      </div>

      <div ref="scroller" class="dlg__scroll">
        <p :key="beat?.id" class="dlg__text">
          <template v-for="(t, i) in tokens" :key="i">
            <template v-if="t.space">{{ t.w }}</template>
            <span v-else class="dlg__w" :class="{ 'dlg__w--on': t.n <= shown }">{{ t.w }}</span>
          </template>
        </p>
      </div>

      <Transition name="fade">
        <button v-if="awaiting" type="button" class="dlg__next" @click="skip">
          {{ index + 1 < beats.length ? 'Дальше' : 'Закончить' }} <kbd>пробел</kbd>
        </button>
      </Transition>
    </div>
  </div>
</template>
