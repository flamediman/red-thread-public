<script setup lang="ts">
/* Развязка встречи или погони — пара секунд, чтобы было видно, чем кончилось, а не просто «картинка пропала»:
   упокоено — существо обесцвечивается и оседает в темноту; ушли — кадр рывком уходит в сторону и гаснет; спрятались —
   темнота смыкается, существо проходит мимо; оторвались от погони — последний кадр медленно гаснет под тяжёлое дыхание.
   Щелчок или любая клавиша — сразу дальше. */
import type { SoloView } from '#shared/types'

const props = defineProps<{ after: NonNullable<SoloView['after']>; story: string; focus?: Record<string, string> }>()
const emit = defineEmits<{ done: [] }>()
const audio = useAudio()

const LABEL: Record<string, string> = { killed: 'Упокоено', fled: 'Вы ушли', hid: 'Оно прошло мимо', escaped: 'Вы оторвались' }
const LENGTH: Record<string, number> = { killed: 2800, fled: 1700, hid: 3200, escaped: 3000 }
const SOUND: Record<string, [string, number]> = { killed: ['creature-die', 0.85], hid: ['hide-breath', 0.9], escaped: ['chase-escape', 0.85] }

let timer = 0
const done = () => { clearTimeout(timer); emit('done') }
const onKey = (e: KeyboardEvent) => { if (!e.repeat) done() }
onMounted(() => {
  const s = SOUND[props.after.kind]
  if (s) void audio.sfx(s[0], s[1])
  timer = window.setTimeout(done, LENGTH[props.after.kind] ?? 2500)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => { clearTimeout(timer); window.removeEventListener('keydown', onKey) })
</script>

<template>
  <div class="solo-after" :class="`solo-after--${after.kind}`" role="status" @click="done">
    <img class="solo-after__art" :src="`/art/${story}/${after.art}.jpg`" :style="{ objectPosition: focus?.[after.art] }" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
    <i class="solo-after__veil" aria-hidden="true" />
    <div class="solo-after__body">
      <p class="solo-label">{{ LABEL[after.kind] }}</p>
      <p v-if="after.text" class="solo-after__text">{{ after.text }}</p>
    </div>
  </div>
</template>
