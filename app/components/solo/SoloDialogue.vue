<script setup lang="ts">
/* Разговор: портрет, реплики по одной, потом варианты ответа (цифры — выбор).
   С озвучкой реплики раскрываются сами в темпе голоса; щелчок при звучащем голосе обрывает его, следующий — следующая реплика. */
import type { SoloClientMessage, SoloView } from '#shared/types'

const props = defineProps<{ data: NonNullable<SoloView['dialogue']>; story: string; hero: string }>()
const emit = defineEmits<{ send: [SoloClientMessage] }>()
const audio = useAudio()

const shown = ref(1)
const allShown = computed(() => shown.value >= props.data.lines.length)
const who = (s: string) => s === 'hero' ? props.hero : s === 'narrator' ? '' : props.data.name
/* состояние с сервера приходит целиком и часто: реплики считаются новыми, только когда сменились сами реплики */
const linesKey = computed(() => props.data.lines.map(l => l.id ?? l.text).join('\n'))

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
let run = 0
async function speak() {
  const my = ++run
  const l = props.data.lines[shown.value - 1]
  audio.stopVoice()
  if (!l?.id) return
  const v = await audio.voice(l.id)
  if (my !== run) { if (v.played) audio.stopVoice(); return }
  if (!v.played) return
  await v.done
  if (my !== run) return
  await sleep(650)
  if (my !== run) return
  if (!allShown.value) shown.value++
}
watch(linesKey, () => { shown.value = 1 })
watch([linesKey, shown], () => void speak(), { immediate: true })
onBeforeUnmount(() => { run++; audio.stopVoice() })

function more() {
  if (audio.speaking.value) { run++; audio.stopVoice(); return }
  if (!allShown.value) shown.value++
}
function choose(i: number) { run++; audio.stopVoice(); emit('send', { type: 'choose', index: i }) }
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
        <span v-else class="solo-talk__more">{{ audio.speaking.value ? 'щелчок — пропустить' : 'щелчок — дальше' }}</span>
      </div>
    </div>
  </div>
</template>
