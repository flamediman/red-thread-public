<script setup lang="ts">
/* Фон заставки «Красной нити»: сначала в доску втыкаются булавки, потом нить
   протягивается от булавки к булавке — каждый отрезок, когда предыдущий дошёл до своей булавки.
   Нить приходит из-за левого края и уходит за правый: булавки стоят с отступом от краёв,
   чтобы ни одна не упиралась в рамку экрана. Идёт по нижней трети и не пересекает текст. */
const pins = [
  { x: 9, y: 84 }, { x: 23, y: 74 }, { x: 38, y: 90 }, { x: 54, y: 81 }, { x: 69, y: 92 }, { x: 83, y: 76 }, { x: 93, y: 87 }
]
/** невидимые точки за краями, откуда нить приходит и куда уходит */
const route = [{ x: -6, y: 80 }, ...pins, { x: 106, y: 82 }]
const PIN_STEP = 0.12      // пауза между булавками, с
const PIN_START = 0.2
const SEG_START = PIN_START + pins.length * PIN_STEP + 0.25
const SEG_DUR = 0.5

const segments = route.slice(1).map((p, i) => {
  const a = route[i]!
  const x0 = a.x * 16, y0 = a.y * 9, x1 = p.x * 16, y1 = p.y * 9
  const len = Math.hypot(x1 - x0, y1 - y0)
  // натянутая нить: провис небольшой и зависит от длины пролёта
  const sag = 6 + len * 0.025
  return { d: `M ${x0} ${y0} Q ${(x0 + x1) / 2} ${(y0 + y1) / 2 + sag} ${x1} ${y1}`, len: len + 20, delay: SEG_START + i * SEG_DUR }
})
</script>

<template>
  <div class="brand-bg" aria-hidden="true">
    <svg class="brand-bg__thread" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
      <path
        v-for="(s, i) in segments"
        :key="`s${i}`"
        :d="s.d"
        :style="{ strokeDasharray: s.len, strokeDashoffset: s.len, animationDelay: `${s.delay}s`, animationDuration: `${SEG_DUR}s` }"
      />
      <g v-for="(p, i) in pins" :key="`p${i}`" class="brand-bg__pin" :style="{ animationDelay: `${PIN_START + i * PIN_STEP}s` }">
        <circle :cx="p.x * 16" :cy="p.y * 9 + 3" r="7" class="brand-bg__pin-shadow" />
        <circle :cx="p.x * 16" :cy="p.y * 9" r="6" />
      </g>
    </svg>
    <div class="brand-bg__grain" />
  </div>
</template>
