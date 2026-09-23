import type { Ref } from 'vue'
/** «ABCDEF» → «ABC DEF»: так код комнаты легче прочитать с экрана и продиктовать */
export const formatRoom = (code: string | null | undefined) => (code ? `${code.slice(0, 3)} ${code.slice(3)}` : '')

/** Маски полей входа. Код комнаты — шесть знаков, в поле показывается как «ABC DEF»; ПИН — четыре цифры.
    Обработчик input чистит значение, кладёт его в ref и возвращает в поле уже по маске: v-model с вычисляемым
    сеттером так не умеет — если лишний знак отбросить, поле не перерисуется и знак останется в нём */
export const cleanCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
export const cleanPin = (v: string) => v.replace(/\D/g, '').slice(0, 4)
export function masked(target: Ref<string>, clean: (v: string) => string, show: (v: string) => string = v => v) {
  return (e: Event) => {
    const el = e.target as unknown as { value: string }
    target.value = clean(el.value)
    const shown = show(target.value)
    if (el.value !== shown) el.value = shown
  }
}
export const onCodeInput = (target: Ref<string>) => masked(target, cleanCode, formatRoom)
export const onPinInput = (target: Ref<string>) => masked(target, cleanPin)
