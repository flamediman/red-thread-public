/* Если картинка не загрузилась (арт ещё генерируется или файла нет), прячем её вместо иконки «битого» изображения. */
export default defineNuxtPlugin(() => {
  document.addEventListener('error', e => {
    const t = e.target
    if (t instanceof HTMLImageElement) t.classList.add('img-missing')
  }, true)
  document.addEventListener('load', e => {
    const t = e.target
    if (t instanceof HTMLImageElement) t.classList.remove('img-missing')
  }, true)
})
