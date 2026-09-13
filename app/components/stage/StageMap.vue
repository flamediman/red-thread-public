<script setup lang="ts">
import type { PublicState } from '#shared/types'
import { INKS } from '#shared/inks'
import { ART } from '~/utils/art'

const props = defineProps<{ state: PublicState; secondsLeft: number | null }>()

const floors = computed(() => props.state.floors.map(fl => ({
  floor: fl.id,
  label: fl.label,
  rooms: props.state.locations.filter(l => l.floor === fl.id).map(l => ({
    ...l,
    art: ART.location(l.id),
    witnesses: props.state.witnesses.filter(w => w.locationId === l.id),
    detectives: props.state.players.filter(p => p.locationId === l.id && p.connected)
  }))
})))

const plans = computed(() => {
  const byId = new Map(props.state.plans.map(p => [p.playerId, p]))
  return props.state.players.filter(p => p.connected).map(p => ({
    ...p, color: INKS[p.ink] ?? INKS[0], plan: byId.get(p.id) ?? null
  }))
})
const planned = computed(() => plans.value.filter(p => p.plan).length)
</script>

<template>
  <div class="map">
    <div class="map__floors">
      <div v-for="f in floors" :key="f.floor" class="map__floor">
        <span class="map__floor-label">{{ f.label }}</span>
        <div class="map__canvas">
          <div
            v-for="r in f.rooms"
            :key="r.id"
            class="map__room"
            :class="{ 'map__room--busy': r.detectives.length > 0 }"
            :style="{ left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%', '--art': `url(${r.art})` }"
          >
            <div class="map__room-name">{{ r.name }}</div>
            <div class="map__room-meta">{{ r.unsearched ? `${r.unsearched} не осмотрено` : 'осмотрено' }}</div>
            <div class="map__people">
              <span v-for="w in r.witnesses" :key="w.id" class="wit-chip"><img class="face" :src="ART.witness(w.id)" :alt="w.name">{{ w.name.split(' ')[0] }}</span>
              <PlayerAvatar v-for="d in r.detectives" :key="d.id" :id="d.id" :name="d.name" :ink="d.ink" :photo="d.photo" :detective-id="d.detectiveId" size="xs" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <aside class="map__side">
      <div class="plans">
        <div v-if="state.settings.timers === 'on' && secondsLeft != null" class="plans__timer tabnum" :class="{ 'plans__timer--low': secondsLeft <= 10 }">
          {{ secondsLeft }}<small>секунд на решение</small>
        </div>
        <p class="label plans__title">Ходы раунда</p>
        <div v-for="p in plans" :key="p.id" class="plans__item" :class="{ 'plans__item--pending': !p.plan }">
          <PlayerAvatar :id="p.id" :name="p.name" :ink="p.ink" :photo="p.photo" :detective-id="p.detectiveId" size="xs" />
          <span><b>{{ p.name }}</b> <template v-if="p.plan">— {{ p.plan.label }}<template v-if="p.plan.bonus"> <i class="plans__bonus">+ {{ p.plan.bonus }}</i></template></template><template v-else>думает…</template></span>
        </div>
        <div class="plans__count">
          <p class="label">Выбрали {{ planned }} из {{ plans.length }}</p>
          <div class="plans__bar"><i :style="{ width: (plans.length ? planned / plans.length * 100 : 0) + '%' }" /></div>
        </div>
      </div>
    </aside>
  </div>
</template>
