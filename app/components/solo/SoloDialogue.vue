<script setup lang="ts">
/* Разговор: портрет, реплики по одной, потом варианты ответа (цифры — выбор). */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ data: NonNullable<SoloView['dialogue']>; story: string; hero: string }>()
const emit = defineEmits<{ send: [SoloClientMessage] }>()
const audio = useAudio()

const shown = ref(1)
// состояние с сервера приходит целиком и часто: сбрасываем показ реплик, только когда сменились сами реплики
watch(() => props.data.lines.map(l => l.text).join('\n'), () => { shown.value = 1 })
const allShown = computed(() => shown.value >= props.data.lines.length)
const who = (s: string) => s === 'hero' ? props.hero : s === 'narrator' ? '' : props.data.name

function more() { if (!allShown.value) shown.value++ }
function choose(i: number) { audio.stopVoice(); emit('send', { type: 'choose', index: i }) }
function onKey(e: KeyboardEvent) {
  if (!allShown.value && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); more(); return }
  if (!allShown.value) return
  const n = Number(e.key)
  if (props.data.choices.length && n >= 1 && n <= props.data.choices.length) { e.preventDefault(); choose(props.data.choices[n - 1]!.index) }
  if (!props.data.choices.length && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); choose(0) }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="solo-veil">
    <div class="solo-talk" role="dialog" aria-modal="true" @click="more">
      <img class="solo-talk__face" :src="`/art/${story}/n_${data.npc}.jpg`" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'">
      <div class="solo-talk__body">
        <span class="solo-talk__name">{{ data.name }}</span>
        <TransitionGroup name="fade" tag="div" class="solo-talk__lines">
          <p v-for="(l, i) in data.lines.slice(0, shown)" :key="`${data.id}-${i}-${l.text.slice(0, 12)}`" class="solo-talk__line" :class="{ 'solo-talk__line--hero': l.speaker === 'hero', 'solo-talk__line--narrator': l.speaker === 'narrator' }">
            <b v-if="who(l.speaker) && l.speaker === 'hero'">{{ who(l.speaker) }}: </b>{{ l.text }}
          </p>
        </TransitionGroup>
        <div v-if="allShown" class="solo-talk__choices">
          <button v-for="(c, i) in data.choices" :key="c.index" type="button" class="solo-talk__choice" @click.stop="choose(c.index)"><kbd>{{ i + 1 }}</kbd>{{ c.text }}</button>
          <button v-if="!data.choices.length" type="button" class="solo-talk__choice" @click.stop="choose(0)"><kbd>↵</kbd>Отойти</button>
        </div>
        <span v-else class="solo-talk__more">щелчок — дальше</span>
      </div>
    </div>
  </div>
</template>
