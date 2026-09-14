/* Часы режима «на время»: время сервера на клиенте. Пути и действия считаются по часам сервера,
   а часы телефона могут расходиться на секунды — поправка берётся из каждого нового состояния. */
import type { PublicState } from '#shared/types'

export function useFieldClock(state: Ref<PublicState | null> | ComputedRef<PublicState | null>, tickMs = 200) {
  const offset = ref(0)
  const now = ref(Date.now())
  watch(() => state.value?.field?.serverNow, serverNow => {
    // сообщение шло до нас какое-то время — поправка чуть занижена, это не страшно
    if (serverNow) offset.value = serverNow - Date.now()
  }, { immediate: true })
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => { timer = setInterval(() => { now.value = Date.now() + offset.value }, tickMs) })
  onBeforeUnmount(() => { if (timer) clearInterval(timer) })

  /** сколько осталось до конца поиска, мс (на паузе — стоит) */
  const leftMs = computed(() => {
    const s = state.value
    if (!s || s.screen !== 'field' || !s.deadline) return null
    return Math.max(0, s.deadline - now.value)
  })
  return { now, leftMs }
}

/** «12:05» из миллисекунд */
export function mmss(ms: number | null | undefined) {
  if (ms == null) return ''
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
