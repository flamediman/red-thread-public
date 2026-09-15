<script setup lang="ts">
import type { PublicState } from '#shared/types'
import { ART, cardPhoto, tilt } from '~/utils/art'

const props = withDefaults(defineProps<{ state: PublicState; mode?: 'strip' | 'full'; beatAt?: number | null }>(), { mode: 'full', beatAt: null })

const f = useBoardFilter(computed(() => props.state), computed(() => props.beatAt))
const nameOf = (id?: string) => id ? props.state.witnesses.find(w => w.id === id)?.name.split(' ')[0] ?? props.state.locations.find(l => l.id === id)?.name ?? '' : ''

/* в полосе внизу экрана — свежие карточки первыми; на доске — по порядку, отмеченные командой впереди */
const ordered = computed(() => {
  const list = props.mode === 'strip' ? [...f.cards.value].reverse() : f.visible.value
  return props.mode === 'strip' ? list : [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.round - b.round)
})

/* снимок у карточки: на доске у вещдока — фото сверху, у слов свидетеля и находок в комнате — маленький кадр у заголовка */
const photos = computed(() => new Map(ordered.value.map(c => [c.id, cardPhoto(c)])))
const bigPhoto = (id: string) => props.mode === 'full' && photos.value.get(id)?.kind === 'item'
const hideImg = (e: Event) => { (e.target as HTMLImageElement).hidden = true }

/* карточка, которой не было при прошлой отрисовке, въезжает; при смене фильтра ничего не анимируется — так быстрее */
const seen = new Set<string>()
const entering = ref(new Set<string>())
let settle: ReturnType<typeof setTimeout> | null = null
watch(() => f.cards.value.map(c => c.id), (ids) => {
  const first = seen.size === 0
  // на полной доске при открытии вспыхивают карточки последнего раунда, дальше — только новые
  const fresh = first
    ? (props.mode === 'full' ? f.cards.value.filter(c => c.round === f.lastRound.value).map(c => c.id) : [])
    : ids.filter(id => !seen.has(id))
  for (const id of ids) seen.add(id)
  if (!fresh.length) return
  entering.value = new Set(fresh)
  if (settle) clearTimeout(settle)
  settle = setTimeout(() => { entering.value = new Set() }, 2600)
}, { immediate: true })
onBeforeUnmount(() => { if (settle) clearTimeout(settle) })

/* красные нити между связанными карточками — рисуются по реальным координатам после раскладки */
const grid = ref<HTMLElement | null>(null)
const strings = ref<{ id: string; d: string; x1: number; y1: number; x2: number; y2: number }[]>([])
const size = ref({ w: 0, h: 0 })

function layout() {
  const g = grid.value
  if (!g || props.mode !== 'full') { strings.value = []; return }
  size.value = { w: g.scrollWidth, h: g.scrollHeight }
  const pos = new Map<string, { x: number; y: number }>()
  for (const el of g.querySelectorAll<HTMLElement>('[data-card]')) pos.set(el.dataset.card!, { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop })
  strings.value = f.visibleLinks.value.flatMap(l => {
    const a = pos.get(l.facts[0]!), b = pos.get(l.facts[1]!)
    if (!a || !b) return []
    const sag = 18 + Math.abs(a.x - b.x) * 0.08
    const d = `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${Math.max(a.y, b.y) + sag} ${b.x} ${b.y}`
    return [{ id: l.id, d, x1: a.x, y1: a.y, x2: b.x, y2: b.y }]
  })
}
let ro: ResizeObserver | null = null
onMounted(() => { ro = new ResizeObserver(() => layout()); if (grid.value) ro.observe(grid.value); nextTick(layout) })
onBeforeUnmount(() => ro?.disconnect())
watch(() => [ordered.value.map(c => c.id).join(), f.visibleLinks.value.length, props.mode], () => nextTick(layout))
</script>

<template>
  <div class="board" :class="{ 'board--strip': mode === 'strip' }">
    <div class="board__head">
      <p class="board__title label">
        Доска <span class="board__count tabnum">{{ f.cards.value.length }}</span> улик
        <template v-if="f.links.value.length">· <span class="board__count tabnum">{{ f.links.value.length }}</span> {{ f.links.value.length === 1 ? 'противоречие' : 'противоречий' }}</template>
      </p>

      <!-- фильтры: вид, тип, человек или место -->
      <div v-if="mode === 'full' && f.cards.value.length" class="filters">
        <button v-for="v in f.views.value" :key="v.id" type="button" class="chip" :class="{ 'chip--on': f.view.value === v.id }" :disabled="!v.count && v.id !== 'all'" @click="f.view.value = v.id">
          {{ v.label }} <b class="tabnum">{{ v.count }}</b>
        </button>
        <span class="filters__sep" />
        <button v-for="k in f.kinds.value" :key="k.id" type="button" class="chip" :class="[`chip--${k.id}`, { 'chip--on': f.kind.value === k.id }]" @click="f.kind.value = f.kind.value === k.id ? null : k.id">
          <i class="chip__dot" />{{ k.label }} <b class="tabnum">{{ k.count }}</b>
        </button>
        <span v-if="f.people.value.length" class="filters__sep" />
        <button v-for="p in f.people.value" :key="p.id" type="button" class="chip chip--face" :class="{ 'chip--on': f.source.value === p.id }" @click="f.source.value = f.source.value === p.id ? null : p.id">
          <img class="face" :src="ART.witness(p.witnessId)" alt="">{{ p.label }} <b class="tabnum">{{ p.count }}</b>
        </button>
        <button v-if="f.filtered.value" type="button" class="chip chip--reset" @click="f.reset()">сбросить</button>
      </div>
    </div>

    <div v-if="mode === 'full' && f.visibleLinks.value.length" class="board__links">
      <div v-for="l in f.visibleLinks.value" :key="l.id" class="board__link">{{ l.text }}</div>
    </div>
    <div class="board__scroll">
      <div ref="grid" class="board__cards" :class="{ 'board__cards--pending': f.pending.value }">
        <p v-if="!f.cards.value.length" class="lobby__empty">Пока пусто. Улики лягут сюда после первого раунда.</p>
        <p v-else-if="!ordered.length" class="lobby__empty">Под этот фильтр ничего не подходит.</p>
        <template v-if="ordered.length">
          <div
            v-for="c in ordered"
            :key="c.id"
            :data-card="c.id"
            class="card"
            :class="[`card--${c.kind}`, { 'card--linked': f.linked.value.has(c.id), 'card--fresh': mode === 'full' && c.round === f.lastRound.value, 'card--pinned': c.pinned, 'card--enter': entering.has(c.id) }]"
            :style="{ '--tilt': tilt(c.id, mode === 'full' ? 1.6 : 0.8) }"
          >
            <img v-if="bigPhoto(c.id)" class="card__photo" :src="photos.get(c.id)!.src" alt="" loading="lazy" @error="hideImg">
            <i class="card__kind" />
            <span v-if="c.pinned" class="card__star" title="команда отметила как важное">★</span>
            <div class="card__head">
              <img v-if="photos.get(c.id) && !bigPhoto(c.id)" class="card__thumb" :class="`card__thumb--${photos.get(c.id)!.kind}`" :src="photos.get(c.id)!.src" alt="" loading="lazy" @error="hideImg">
              <div class="card__title">{{ c.title }}</div>
            </div>
            <div v-if="mode === 'full'" class="card__detail">{{ c.detail }}</div>
            <div class="card__meta">{{ nameOf(c.witnessId) || nameOf(c.locationId) || c.by }} · {{ c.time ?? `раунд ${c.round + 1}` }}</div>
            <span v-if="c.verdict" class="card__verdict" :class="c.verdict.lie ? 'card__verdict--lie' : 'card__verdict--truth'">{{ c.verdict.lie ? 'ложь' : 'правда' }}</span>
          </div>
        </template>
        <svg v-if="mode === 'full' && strings.length" class="board__strings" :width="size.w" :height="size.h" aria-hidden="true">
          <template v-for="s in strings" :key="s.id">
            <path :d="s.d" />
            <circle :cx="s.x1" :cy="s.y1" r="4" />
            <circle :cx="s.x2" :cy="s.y2" r="4" />
          </template>
        </svg>
      </div>
    </div>
  </div>
</template>
