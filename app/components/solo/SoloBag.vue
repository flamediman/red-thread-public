<script setup lang="ts">
/* Вещи — отдельным окном по центру, как в играх: слева сетка ячеек (пустые слоты тоже видны), справа — большая ячейка
   выбранной вещи с описанием и действиями. «Соединить с…» — окно остаётся, подсвечены вещи, с которыми можно;
   «Применить к…» — окно закрывается, выбор — на месте. I или Esc закрывает, стрелки двигают выбор */
import type { SoloView } from '#shared/types'

type Item = SoloView['inventory'][number]
const props = defineProps<{
  items: Item[]; story: string; picked: string | null; combining: string | null; canApply: boolean
  groups: { label: string; kinds: string[] }[]; verb: (kind: string) => string
}>()
const emit = defineEmits<{ pick: [string]; use: []; examine: [string]; apply: []; combine: []; cancel: []; close: [] }>()

/* порядок — по разделам карманов: оружие, лечение и свет, ключи, вещи, бумаги */
const ordered = computed(() => {
  const known = props.groups.flatMap(g => props.items.filter(i => g.kinds.includes(i.kind)))
  return known.concat(props.items.filter(i => !known.includes(i)))
})
const COLS = 4
const empty = computed(() => Math.max(COLS * 3, Math.ceil(ordered.value.length / COLS) * COLS) - ordered.value.length)
const current = computed(() => props.items.find(i => i.id === props.picked) ?? null)
const combiningName = computed(() => props.items.find(i => i.id === props.combining)?.name ?? '')

function move(dx: number) {
  const list = ordered.value
  if (!list.length) return
  const i = list.findIndex(x => x.id === props.picked)
  const next = i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + dx))
  emit('pick', list[next]!.id)
}
function onKey(e: KeyboardEvent) {
  if (e.code === 'Escape' || e.code === 'KeyI') { e.preventDefault(); if (props.combining && e.code === 'Escape') emit('cancel'); else emit('close') }
  else if (e.code === 'ArrowRight') { e.preventDefault(); move(1) }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); move(-1) }
  else if (e.code === 'ArrowDown') { e.preventDefault(); move(COLS) }
  else if (e.code === 'ArrowUp') { e.preventDefault(); move(-COLS) }
}
onMounted(() => { window.addEventListener('keydown', onKey, true); if (!props.picked && ordered.value[0]) emit('pick', ordered.value[0].id) })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
const hide = (e: Event) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }
</script>

<template>
  <div class="solo-veil" @click.self="emit('close')">
    <div class="solo-inv" role="dialog" aria-modal="true" aria-label="Вещи">
      <header class="solo-inv__head">
        <h2>{{ combining ? `Соединить «${combiningName}» с…` : 'Вещи' }}</h2>
        <span class="solo-keys">I — закрыть</span>
        <button type="button" class="solo-map__close" aria-label="Закрыть" @click="emit('close')">×</button>
      </header>
      <div class="solo-inv__body">
        <div class="solo-inv__grid" :style="{ '--cols': COLS }">
          <button
            v-for="it in ordered" :key="it.id" type="button" class="solo-inv__cell"
            :class="{ on: picked === it.id, target: combining && combining !== it.id, dim: combining && combining === it.id, equipped: it.equipped }"
            :title="it.name" :aria-label="it.name" @click="emit('pick', it.id)"
          >
            <img :src="`/art/${story}/${it.art}.jpg`" alt="" @error="hide">
            <SoloIcon :name="it.icon" class="solo-inv__ico" />
            <b v-if="it.count > 1" class="tabnum">×{{ it.count }}</b>
            <em v-if="it.equipped">в руке</em>
          </button>
          <i v-for="n in empty" :key="`e${n}`" class="solo-inv__cell solo-inv__cell--empty" aria-hidden="true" />
        </div>
        <aside class="solo-inv__pane">
          <template v-if="current">
            <div class="solo-inv__big">
              <img :key="current.art" :src="`/art/${story}/${current.art}.jpg`" alt="" @error="hide">
            </div>
            <h3>{{ current.name }}<b v-if="current.count > 1" class="tabnum"> ×{{ current.count }}</b></h3>
            <p>{{ current.description }}</p>
            <div v-if="combining" class="solo-inv__actions">
              <button type="button" class="solo-btn solo-btn--small solo-btn--ghost" @click="emit('cancel')">Не соединять</button>
            </div>
            <div v-else class="solo-inv__actions">
              <button v-if="current.usable && !current.equipped" type="button" class="solo-btn solo-btn--small" @click="emit('use')">{{ verb(current.kind) }}</button>
              <button v-if="current.examinable" type="button" class="solo-btn solo-btn--small solo-btn--ghost" @click="emit('examine', current.id)">Осмотреть внимательнее</button>
              <button v-if="canApply" type="button" class="solo-btn solo-btn--small solo-btn--ghost" @click="emit('apply')">Применить к…</button>
              <button v-if="items.length > 1" type="button" class="solo-btn solo-btn--small solo-btn--ghost" @click="emit('combine')">Соединить с…</button>
            </div>
          </template>
          <p v-else class="solo-inv__hint">{{ items.length ? 'Выберите вещь' : 'Карманы пусты' }}</p>
        </aside>
      </div>
    </div>
  </div>
</template>
