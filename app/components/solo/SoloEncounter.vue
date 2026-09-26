<script setup lang="ts">
/* Встреча: раунд идёт в настоящем времени (по часам сервера), по полосе бежит бегунок. Красные окна — удар попадает,
   синее — уход без урона: жать нужно, пока бегунок внутри. Время нажатия уходит на сервер, чтобы пинг не съедал окно.
   Цифры 1–5 — варианты. */
import type { SoloClientMessage, SoloQteKey, SoloView } from '#shared/types'

const props = defineProps<{ enc: NonNullable<SoloView['encounter']>; story: string; offset: number; light: boolean; health: number; focus?: Record<string, string>; depth?: string[]; radio?: boolean }>()
/* карточка существа объёмная, если есть карта глубины: камера медленно «дышит» и подбирается ближе */
const depthFail = ref(false)
const mArt = computed(() => `m_${props.enc.monster}`)
const deep = computed(() => !depthFail.value && !!props.depth?.includes(mArt.value))
const emit = defineEmits<{ send: [SoloClientMessage] }>()
const audio = useAudio()

const now = ref(Date.now())
let raf = 0
const loop = () => { now.value = Date.now() + props.offset; raf = requestAnimationFrame(loop) }
onMounted(() => { raf = requestAnimationFrame(loop) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

/* Вступление: мир обрывается в темноту, через четверть секунды — удар (звук, вспышка, тряска), существо проступает из
   темноты и подходит, имя — крупно. Раунд (бегунок, кнопки) начинается, когда часы сервера дойдут до startedAt:
   до этого панель закрыта. Впервые встреченное — вступление дольше */
const intro = computed(() => props.enc.round === 1 && now.value < props.enc.startedAt)
const phase = ref<'dark' | 'hit' | null>(null)
const timers: number[] = []
const later = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)) }
function playIntro() {
  phase.value = 'dark'
  audio.hush(1.5)
  later(props.enc.first ? 420 : 240, () => {
    phase.value = 'hit'
    // у удара три записи — useAudio чередует их сам
    void audio.sfx('enc-sting', 1)
    if (props.radio) void audio.sfx('static-burst', 0.8)
    flash.value = 'appear'; clearTimeout(flashTimer); flashTimer = window.setTimeout(() => { flash.value = null }, 700)
  })
}
watch(intro, (on, was) => { if (on && !was) playIntro(); if (!on) later(900, () => { if (!intro.value) phase.value = null }) })
onMounted(() => { if (intro.value) playIntro() })
onBeforeUnmount(() => { timers.forEach(t => clearTimeout(t)); if (voiceTimer) clearTimeout(voiceTimer) })

/* голос существа рядом: дыхание, горн, бульканье — каждые 2,5–5 с с новой стороны; кружит — ходит вокруг */
const voice = computed(() => creatureVoice(props.enc.monster))
let voiceTimer: number | null = null
let voiceK = 0
let voiceAz = (Math.random() * 2 - 1) * 0.8
function presence() {
  voiceTimer = window.setTimeout(() => {
    if (!intro.value && !props.enc.dodge && !props.enc.grapple) {
      const list = voice.value.near
      const name = list[voiceK++ % list.length]!
      const circling = props.enc.mode === 'circle'
      voiceAz += (Math.random() < 0.5 ? -1 : 1) * (circling ? 1.2 : 0.5)
      void audio.spatial(name, { az: voiceAz, dist: circling ? 4 : 2.2 + Math.random() * 1.5, volume: 0.55, move: circling ? 1.4 : 0 })
    }
    presence()
  }, 2500 + Math.random() * 2500)
}
onMounted(presence)

const total = computed(() => props.enc.windowMs || Math.max(1, props.enc.deadline - props.enc.startedAt))
/** где бегунок: доля раунда, 0…1 */
const pos = computed(() => Math.max(0, Math.min(1, (now.value - props.enc.startedAt) / total.value)))
const share = computed(() => 1 - pos.value)
const secondsLeft = computed(() => Math.max(0, Math.ceil((props.enc.deadline - now.value) / 1000)))
const band = (z: [number, number]) => ({ left: `${((z[0] - props.enc.startedAt) / total.value) * 100}%`, width: `${((z[1] - z[0]) / total.value) * 100}%` })
const inside = (z: [number, number] | null) => !!z && now.value >= z[0] && now.value <= z[1]
const inHit = computed(() => props.enc.zones.hit.some(inside))
const inFlee = computed(() => inside(props.enc.zones.flee))
const ready = (id: string) => (id === 'fight' || id === 'shoot') ? inHit.value : id === 'flee' ? inFlee.value : false
/* уворот: существо бьёт, на арене вспыхивает точка; полоса раунда в это время стоит, кнопки закрыты */
const dodging = computed(() => !!props.enc.dodge)
/* захват: жать быстро — любую клавишу или большую кнопку; каждое нажатие уходит на сервер */
const grappling = computed(() => !!props.enc.grapple)
const grapLeft = computed(() => props.enc.grapple ? Math.max(0, (props.enc.grapple.deadline - now.value) / 1000) : 0)
const grapShare = computed(() => props.enc.grapple ? Math.min(1, props.enc.grapple.presses / props.enc.grapple.need) : 0)
const mashPulse = ref(0)
let lastMash = 0
function mash() {
  if (!props.enc.grapple) return
  const t = performance.now()
  if (t - lastMash < 70) return
  lastMash = t
  mashPulse.value++
  void audio.sfx('qte-tick', 0.5)
  emit('send', { type: 'mash' })
}
const MODE_TAG: Record<string, string> = { guard: 'прикрывается', press: 'торопится', circle: 'кружит' }

/* что произошло — видно и слышно: урон герою (красная вспышка, тряска, «−12» у полоски здоровья), попадание по существу
   (белая вспышка кадра, «−16» у его полоски), промах и уворот — подписью */
const floats = ref<{ id: number; text: string; kind: 'hurt' | 'hit' | 'miss' | 'dodge' }[]>([])
let floatId = 0
const flash = ref<'hurt' | 'hit' | 'appear' | null>(null)
let flashTimer = 0
function pop(text: string, kind: 'hurt' | 'hit' | 'miss' | 'dodge') {
  const id = ++floatId
  floats.value = [...floats.value.slice(-3), { id, text, kind }]
  setTimeout(() => { floats.value = floats.value.filter(f => f.id !== id) }, 1400)
  if (kind === 'hurt' || kind === 'hit') { flash.value = kind; clearTimeout(flashTimer); flashTimer = window.setTimeout(() => { flash.value = null }, 520) }
}
watch(() => props.health, (n, o) => { if (o != null && n < o) pop(`−${o - n}`, 'hurt') })
watch(() => props.enc.hp, (n, o) => { if (o != null && n < o) pop(`−${o - n}`, 'hit') })
watch(() => props.enc.stunned, (n, o) => { if (n && !o) pop('оглушено', 'dodge') })
watch(() => props.enc.dazed, (n, o) => { if (n && !o) pop('звон в ушах', 'hurt') })
watch(() => props.enc.text, t => { if (/^Промах|Удар соскальзывает|уклоняется|проходит между|уходит в пустой/.test(t)) pop('мимо', 'miss'); else if (/приходится в пустоту|бьёт мимо|смыкаются на пустоте|хватают воздух|валится на койку|осыпается|только что стояли/.test(t)) pop('увернулись', 'dodge') })
const onDodge = (id: number, key: SoloQteKey, at: number) => emit('send', { type: 'qte', id, key, at })

/* вариант — по номеру: выстрелов может быть несколько (у каждого ствола свой), id у них одинаковый */
function pick(i: number) {
  const o = props.enc.options[i]
  if (!o?.enabled) return
  if (dodging.value || grappling.value || intro.value) return
  if (o.id === 'light') emit('send', { type: 'light', on: !props.light })
  else emit('send', { type: 'act', action: o.id, at: now.value, gun: o.gun })
}
function onKey(e: KeyboardEvent) {
  if (grappling.value) { if (!e.repeat) { e.preventDefault(); mash() } return }
  const n = Number(e.key)
  if (n >= 1 && n <= props.enc.options.length) { e.preventDefault(); pick(n - 1) }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-enc" :class="{ 'solo-enc--hurt': flash === 'hurt', [`solo-enc--${phase}`]: phase, 'solo-enc--first': enc.first }" role="alertdialog" aria-modal="true">
    <!-- кадр существа — в «сцене»: во вступлении она проступает из темноты и подходит, дальше дышит -->
    <div class="solo-enc__stage">
      <SoloDepth v-if="deep" class="solo-enc__art" :src="`/art/${story}/${mArt}.jpg`" :depth="`/art/${story}/z_${mArt}.jpg`" mode="none" :lx="50" :ly="50" :focus="focus?.[mArt]" :fog="0.15" motion="breath" @fail="depthFail = true" />
      <img v-else class="solo-enc__art" :src="`/art/${story}/m_${enc.monster}.jpg`" :style="{ objectPosition: focus?.[`m_${enc.monster}`] }" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
      <i class="solo-tint" aria-hidden="true" />
      <SoloFog :density="0.9" other />
    </div>
    <i class="solo-enc__flash" :class="flash && `solo-enc__flash--${flash}`" aria-hidden="true" />
    <!-- имя крупно, пока идёт вступление; уходит за 0,65 с до панели — два имени на экране разом не стоят -->
    <Transition name="enc-title"><p v-if="intro && phase === 'hit' && now < enc.startedAt - 650" class="solo-enc__title">{{ enc.name }}</p></Transition>
    <div v-if="enc.dodge" class="solo-boss__arena solo-enc__arena solo-enc__arena--dodge"><SoloQte :prompts="enc.dodge.prompts" :now="now" :lead="120" @answer="onDodge" /></div>
    <Transition name="fade"><span v-if="dodging" class="solo-enc__dodge">Уворот!</span></Transition>
    <Transition name="fade">
      <button v-if="enc.grapple" type="button" class="solo-enc__mash" :class="{ 'solo-enc__mash--pulse': mashPulse % 2 }" :style="{ '--fill': grapShare }" @pointerdown.prevent="mash">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="solo-enc__mash-ring" cx="50" cy="50" r="46" :style="{ strokeDashoffset: (1 - grapShare) * 289 }" /></svg>
        <b>Вырваться!</b><small>жмите быстро · {{ grapLeft.toFixed(1) }} с</small>
      </button>
    </Transition>
    <div class="solo-enc__panel" :class="{ 'solo-enc__panel--dodge': dodging, 'solo-enc__panel--wait': intro }">
      <div class="solo-enc__head">
        <span class="solo-enc__name">{{ enc.name }}</span>
        <span class="solo-enc__hp"><i :style="{ transform: `scaleX(${enc.maxHp ? enc.hp / enc.maxHp : 0})` }" /></span>
        <Transition name="fade"><span v-if="enc.stunned" class="solo-enc__tag solo-enc__tag--stun">оглушено</span><span v-else-if="enc.dazed" class="solo-enc__tag solo-enc__tag--daze">звон в ушах</span><span v-else-if="MODE_TAG[enc.mode]" class="solo-enc__tag solo-enc__tag--mode">{{ MODE_TAG[enc.mode] }}</span></Transition>
        <span class="solo-enc__you" :class="{ 'solo-enc__you--low': health <= 30 }" :title="`Ваше здоровье: ${health}`"><small>вы</small><i><b :style="{ transform: `scaleX(${health / 100})` }" /></i><span class="tabnum">{{ health }}</span></span>
      </div>
      <div class="solo-enc__floats" aria-live="polite">
        <TransitionGroup name="float"><span v-for="f in floats" :key="f.id" class="solo-enc__float" :class="`solo-enc__float--${f.kind}`">{{ f.text }}</span></TransitionGroup>
      </div>
      <Transition name="quick-text" mode="out-in">
        <p :key="enc.round + enc.text" class="solo-enc__text">{{ enc.text }}</p>
      </Transition>
      <div class="solo-enc__track" :class="{ 'solo-enc__track--low': share < 0.3 && !dodging && !grappling, 'solo-enc__track--held': dodging || grappling, 'solo-enc__track--dazed': enc.dazed }">
        <i v-for="(z, i) in enc.zones.hit" :key="`h${i}`" class="solo-enc__zone solo-enc__zone--hit" :class="{ on: inside(z) }" :style="band(z)" />
        <i v-if="enc.zones.flee" class="solo-enc__zone solo-enc__zone--flee" :class="{ on: inFlee }" :style="band(enc.zones.flee)" />
        <em class="solo-enc__cursor" :style="{ left: `${pos * 100}%` }" />

      </div>
      <p class="solo-enc__legend"><span><i class="solo-enc__key solo-enc__key--hit" />удар</span><span><i class="solo-enc__key solo-enc__key--flee" />уход без удара</span><span>жмите, пока бегунок в окне. После окон оно бьёт само, когда захочет: стрелка на экране — уворот, нажмите её или проведите пальцем в её сторону</span></p>
      <div class="solo-enc__options">
        <button
          v-for="(o, i) in enc.options" :key="`${o.id}-${o.gun ?? ''}`" type="button" class="solo-enc__opt"
          :class="[`solo-enc__opt--${o.id}`, { 'solo-enc__opt--ready': ready(o.id) && !dodging && !grappling && !intro }]" :disabled="!o.enabled || dodging || grappling || intro" @click="pick(i)"
        ><kbd>{{ i + 1 }}</kbd><span class="solo-enc__opt-text"><b>{{ o.label }}</b><small v-if="o.hint">{{ o.hint }}</small></span></button>
      </div>
    </div>
  </div>
</template>
