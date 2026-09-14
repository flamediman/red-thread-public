<script setup lang="ts">
/* Режим «на время» на большом экране: здание в разрезе, по нему идут фигурки сыщиков,
   справа — доска дела с вопросами, внизу — лента находок. Решённый вопрос, событие утра
   или звонок инспектора ненадолго выходят на первый план. */
import type { Beat, FieldMoment, PublicState } from '#shared/types'
import { INKS } from '#shared/inks'
import { ART } from '~/utils/art'

const props = defineProps<{ state: PublicState }>()
const audio = useAudio()
const { now } = useFieldClock(computed(() => props.state), 120)
const field = computed(() => props.state.field)

/* ── геометрия: этажи — полосы сверху вниз, комнаты — прямоугольники в полосе ── */
const band = computed(() => 100 / Math.max(1, props.state.floors.length))
const floorIndex = (floor: number) => Math.max(0, props.state.floors.findIndex(f => f.id === floor))
const rect = (id: string) => {
  const l = props.state.locations.find(x => x.id === id)
  if (!l) return { left: 0, top: 0, width: 0, height: 0 }
  const top = floorIndex(l.floor) * band.value
  return { left: l.x, top: top + (l.y * band.value) / 100, width: l.w, height: (l.h * band.value) / 100 }
}
/** где стоят фигурки: правее середины и ниже названия — название и люди в комнате остаются читаемыми */
const center = (id: string) => { const r = rect(id); return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.66 } }
const surname = (name: string) => name.split(' ').at(-1) ?? name

const rooms = computed(() => props.state.locations.map(l => ({
  ...l, r: rect(l.id), art: ART.location(l.id),
  faces: props.state.witnesses.filter(w => w.locationId === l.id),
  busy: field.value?.players.some(p => p.busy && props.state.players.find(x => x.id === p.id)?.locationId === l.id) ?? false
})))
const floorLabels = computed(() => props.state.floors.map((f, i) => ({ ...f, top: i * band.value })))

/* ── фигурки: цель — следующее место на пути, переход длится остаток шага ── */
const tokens = computed(() => {
  const players = props.state.players.filter(p => p.connected)
  const byNode = new Map<string, number>()
  return players.map(p => {
    const fp = field.value?.players.find(x => x.id === p.id)
    const w = fp?.walk
    let node = p.locationId, ms = 0
    if (w) {
      let t = w.startedAt
      node = w.path[w.path.length - 1]!
      for (let i = 0; i < w.path.length; i++) {
        const end = t + (w.legs[i] ?? 0)
        if (now.value < end) { node = w.path[i]!; ms = end - now.value; break }
        t = end
      }
    }
    const slot = byNode.get(node) ?? 0
    byNode.set(node, slot + 1)
    const c = center(node)
    return {
      ...p, color: INKS[p.ink] ?? INKS[0], x: c.x - 1.6 + slot * 2.6, y: c.y, ms: Math.max(0, Math.round(ms)),
      walking: !!w, busy: fp?.busy?.label ?? null
    }
  })
})

/* ── доска дела ── */
const groups = computed(() => {
  const out: { name: string; items: NonNullable<typeof field.value>['questions'] }[] = []
  for (const q of field.value?.questions ?? []) {
    let g = out.find(x => x.name === q.group)
    if (!g) { g = { name: q.group, items: [] }; out.push(g) }
    g.items.push(q)
  }
  return out
})
const solved = computed(() => field.value?.questions.filter(q => q.solved).length ?? 0)
const total = computed(() => field.value?.questions.length ?? 0)
const cardTitle = (id: string | null) => props.state.board.cards.find(c => c.id === id)?.title ?? ''
const cooling = (until: number | null) => !!until && until > now.value

/* ── лента ── */
const feed = computed(() => [...(field.value?.feed ?? [])].slice(-6).reverse())
const inkOf = (playerId?: string) => { const p = props.state.players.find(x => x.id === playerId); return p ? INKS[p.ink] ?? INKS[0] : 'var(--paper-faint)' }

/* ── крупные моменты: по очереди, с голосом, если он есть ── */
const moment = ref<FieldMoment | null>(null)
const queue: FieldMoment[] = []
let seen = 0
let playing = false
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const speakerName = (b: Beat) => b.speaker === 'inspector' ? props.state.caseInfo.helper.name : b.speaker === 'narrator' ? '' : props.state.witnesses.find(w => w.id === b.speaker)?.name ?? ''
async function play() {
  if (playing) return
  playing = true
  while (queue.length) {
    const m = queue.shift()!
    moment.value = m
    for (const s of m.beat.sfx ?? []) void audio.sfx(s, 0.8)
    const v = await audio.voice(m.beat.id)
    const read = Math.max(5000, m.beat.text.length * 55)
    await Promise.all([sleep(v.played ? v.duration * 1000 + 600 : read), v.done])
    while (props.state.paused) await sleep(250)
    moment.value = null
    await sleep(400)
  }
  playing = false
}
watch(() => field.value?.moments.at(-1)?.seq ?? 0, () => {
  const list = field.value?.moments ?? []
  // при первом показе экрана старые моменты не проигрываем
  if (!seen) { seen = list.at(-1)?.seq ?? 1; return }
  for (const m of list) if (m.seq > seen) { queue.push(m); seen = m.seq }
  void play()
}, { immediate: true })
onBeforeUnmount(() => { queue.length = 0; audio.stopVoice() })

/* звук ленты: неверные карточки на доске — глухой стук (решения звучат вместе с моментом) */
let feedSeen = field.value?.feed.at(-1)?.seq ?? 0
watch(() => field.value?.feed.at(-1)?.seq ?? 0, seq => {
  for (const e of field.value?.feed ?? []) {
    if (e.seq <= feedSeen) continue
    if (e.kind === 'fail') void audio.sfx('board-wrong', 0.8)
    else if (e.kind === 'door') void audio.sfx('door-knob', 0.6)
  }
  feedSeen = seq
})
</script>

<template>
  <div class="field">
    <section class="field__map">
      <div class="field__canvas">
        <span v-for="f in floorLabels" :key="f.id" class="field__floor" :style="{ top: `${f.top}%`, height: `${band}%` }"><i>{{ f.label }}</i></span>
        <div
          v-for="r in rooms" :key="r.id" class="field__room"
          :class="{ 'field__room--locked': !r.open, 'field__room--busy': r.busy }"
          :style="{ left: `${r.r.left}%`, top: `${r.r.top}%`, width: `${r.r.width}%`, height: `${r.r.height}%`, '--art': `url(${r.art})` }"
        >
          <span class="field__room-name">{{ r.name }}</span>
          <span class="field__room-meta">{{ !r.open ? 'заперто' : r.unsearched ? `не осмотрено: ${r.unsearched}` : 'осмотрено' }}</span>
          <span class="field__faces">
            <span v-for="w in r.faces" :key="w.id" class="field__wit"><img class="face" :src="ART.witness(w.id)" alt="">{{ surname(w.name) }}</span>
          </span>
        </div>
        <div
          v-for="t in tokens" :key="t.id" class="field__token"
          :class="{ 'field__token--busy': !!t.busy, 'field__token--walking': t.walking }"
          :style="{ left: `${t.x}%`, top: `${t.y}%`, '--tok': t.color, transitionDuration: `${t.ms}ms` }"
        >
          <PlayerAvatar :id="t.id" :name="t.name" :ink="t.ink" :photo="t.photo" :detective-id="t.detectiveId" size="xs" />
          <span class="field__token-name">{{ t.name }}</span>
        </div>
      </div>
    </section>

    <aside class="field__board">
      <div class="field__board-head">
        <p class="label">Доска дела</p>
        <span class="field__progress tabnum">{{ solved }} из {{ total }}</span>
        <i class="field__progress-bar"><i :style="{ transform: `scaleX(${total ? solved / total : 0})` }" /></i>
      </div>
      <div class="field__groups">
        <section v-for="g in groups" :key="g.name" class="field__group">
          <p class="field__group-name">{{ g.name }}</p>
          <div v-for="q in g.items" :key="q.id" class="field__q" :class="{ 'field__q--solved': q.solved, 'field__q--cool': cooling(q.cooldownUntil) }">
            <span class="field__q-title">{{ q.title }}</span>
            <span v-if="q.solved" class="field__q-answer">{{ cardTitle(q.yieldsFactId) }}</span>
            <span v-else class="field__q-slots"><i v-for="n in q.slots" :key="n" /><small>{{ cooling(q.cooldownUntil) ? 'не сходится' : q.hint }}</small></span>
          </div>
        </section>
      </div>
      <div class="field__feed">
        <p v-for="e in feed" :key="e.seq" class="field__feed-line" :class="`field__feed-line--${e.kind}`">
          <i :style="{ background: inkOf(e.playerId) }" /><span class="tabnum">{{ e.at }}</span> {{ e.text }}
        </p>
      </div>
    </aside>

    <Transition name="fade">
      <div v-if="moment" class="field__moment">
        <div class="field__moment-card">
          <span class="label">{{ moment.title ?? speakerName(moment.beat) ?? '' }}</span>
          <p class="field__moment-text">{{ moment.beat.text }}</p>
          <img v-if="moment.beat.itemId" class="field__moment-item" :src="ART.item(moment.beat.itemId)" alt="">
        </div>
      </div>
    </Transition>
  </div>
</template>
