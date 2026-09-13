/* Фильтры доски: одна логика для экрана и телефона.
   Три независимых среза, работают вместе: вид (все / новые / отмеченные / противоречия),
   тип карточки и источник (человек или место). */
import type { FactKind, PublicState } from '#shared/types'

export type BoardView = 'all' | 'new' | 'pinned' | 'linked'

export const KIND_LABEL: Record<FactKind, string> = {
  physical: 'Следы и предметы',
  testimony: 'Показания',
  timeline: 'Время',
  background: 'Прошлое'
}

/** Карточки и нити, которые разбор ещё не показал: они ложатся на доску вместе со своей репликой на экране.
    at — реплика на экране (экран знает её сам, телефоны — из состояния). */
export function unrevealed(s: PublicState | null, at?: number) {
  const facts = new Set<string>(), links = new Set<string>()
  if (!s || (s.screen !== 'resolve' && s.screen !== 'verdict')) return { facts, links }
  const current = at ?? s.beatIndex
  s.beats.forEach((b, i) => {
    if (i <= current) return
    for (const f of b.facts ?? []) facts.add(f)
    for (const l of b.links ?? []) links.add(l)
  })
  return { facts, links }
}

export function useBoardFilter(state: Ref<PublicState | null> | ComputedRef<PublicState | null>, beatAt?: Ref<number | null>) {
  /* выбор фильтра — сразу (кнопка загорается без задержки), список перестраивается кадром позже */
  const view = ref<BoardView>('all')
  const kind = ref<FactKind | null>(null)
  /** 'w:<id>' — человек, 'l:<id>' — место */
  const source = ref<string | null>(null)
  const applied = shallowRef({ view: view.value, kind: kind.value, source: source.value })
  let frame = 0
  watch([view, kind, source], () => {
    if (import.meta.server) return
    cancelAnimationFrame(frame)
    // два кадра: сначала отрисуется нажатая кнопка и приглушённый список, потом тяжёлая перестройка
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { applied.value = { view: view.value, kind: kind.value, source: source.value } }) })
  })
  const pending = computed(() => applied.value.view !== view.value || applied.value.kind !== kind.value || applied.value.source !== source.value)

  const hidden = computed(() => unrevealed(state.value, beatAt?.value ?? undefined))
  const cards = computed(() => (state.value?.board.cards ?? []).filter(c => !hidden.value.facts.has(c.id)))
  const links = computed(() => (state.value?.board.links ?? []).filter(l => !hidden.value.links.has(l.id) && !hidden.value.facts.has(l.facts[0]) && !hidden.value.facts.has(l.facts[1])))
  const linked = computed(() => new Set(links.value.flatMap(l => l.facts)))
  const lastRound = computed(() => cards.value.reduce((m, c) => Math.max(m, c.round), -1))

  const byView = (v: BoardView) => cards.value.filter(c =>
    v === 'all' ? true : v === 'new' ? c.round === lastRound.value : v === 'pinned' ? c.pinned : linked.value.has(c.id))

  const visible = computed(() => {
    const { view: v, kind: k, source: src } = applied.value
    return byView(v).filter(c => (!k || c.kind === k) && (!src || (src.startsWith('w:') ? c.witnessId === src.slice(2) : c.locationId === src.slice(2))))
  })

  const views = computed(() => ([
    { id: 'all', label: 'Все' }, { id: 'new', label: 'Новые' }, { id: 'pinned', label: '★ Важные' }, { id: 'linked', label: 'Противоречия' }
  ] as { id: BoardView; label: string }[]).map(v => ({ ...v, count: byView(v.id).length })))

  const kinds = computed(() => (Object.keys(KIND_LABEL) as FactKind[])
    .map(k => ({ id: k, label: KIND_LABEL[k], count: cards.value.filter(c => c.kind === k).length }))
    .filter(k => k.count > 0))

  const people = computed(() => (state.value?.witnesses ?? [])
    .map(w => ({ id: `w:${w.id}`, witnessId: w.id, label: w.name.split(' ')[0]!, count: cards.value.filter(c => c.witnessId === w.id).length }))
    .filter(p => p.count > 0))

  const places = computed(() => (state.value?.locations ?? [])
    .map(l => ({ id: `l:${l.id}`, label: l.name, count: cards.value.filter(c => c.locationId === l.id).length }))
    .filter(p => p.count > 0))

  /** противоречия, у которых обе карточки видны при текущем фильтре */
  const visibleLinks = computed(() => {
    const ids = new Set(visible.value.map(c => c.id))
    return links.value.filter(l => ids.has(l.facts[0]) && ids.has(l.facts[1]))
  })

  const filtered = computed(() => view.value !== 'all' || !!kind.value || !!source.value)
  function reset() { view.value = 'all'; kind.value = null; source.value = null }

  return { view, kind, source, pending, cards, links, visible, visibleLinks, views, kinds, people, places, linked, lastRound, filtered, reset }
}
