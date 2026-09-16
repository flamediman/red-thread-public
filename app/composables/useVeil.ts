/* Пока открыта шторка с прокруткой внутри, фон экрана (кен-бёрнс фотографии, дождь, зерно) стоит: в Chrome живой фон
   под фиксированной шторкой мерцал при каждом шаге прокрутки. Считаем открытые шторки — класс снимается с последней. */
let open = 0
export function useVeil(isOpen: Ref<boolean>) {
  const apply = (on: boolean) => {
    if (!import.meta.client) return
    open = Math.max(0, open + (on ? 1 : -1))
    document.documentElement.classList.toggle('has-veil', open > 0)
  }
  watch(isOpen, (v, old) => { if (!!v !== !!old) apply(!!v) }, { immediate: true })
  onBeforeUnmount(() => { if (isOpen.value) apply(false) })
}
