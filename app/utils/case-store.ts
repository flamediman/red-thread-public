/* Активное дело на клиенте: от него зависят пути к фотографиям и озвучке.
   Выставляется из состояния сервера (useGame) — экран и телефон всегда смотрят в ту же папку, что и сервер. */
export const currentCase = ref('')
export function setCurrentCase(id: string) { if (id && currentCase.value !== id) currentCase.value = id }

/** Сеттинг активного дела: портреты сыщиков общие для всех дел сеттинга */
export const currentSetting = ref('noir')
export function setCurrentSetting(id: string | undefined) { if (id && currentSetting.value !== id) currentSetting.value = id }
