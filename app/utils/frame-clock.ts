/* Общий такт того, что движется рядом с объёмным кадром. Кадр перерисовывается 30 раз в секунду, и браузер каждый раз
   пересобирает экран; анимация пульса в строке состояния шла своим тактом, 60 раз в секунду, — и экран собирался вдвое
   чаще (замер: ~10 % ядра на одну кардиограмму). Теперь пульс двигается в те же кадры, что и картинка (frameTick из
   SoloDepth); нет объёмного кадра — свой такт, те же 30 раз в секунду */
type Tick = (ms: number) => void
const subs = new Set<Tick>()
let lastTick = -1e9

/** объёмный кадр только что нарисован */
export function frameTick(ms: number) {
  lastTick = performance.now()
  for (const f of subs) f(ms)
}

/** подписка на такт; вернёт отписку */
export function onFrame(fn: Tick): () => void {
  subs.add(fn)
  let raf = 0, last = 0
  const own = (ms: number) => {
    raf = requestAnimationFrame(own)
    if (performance.now() - lastTick < 200 || ms - last < 1000 / 30 - 4) return
    last = ms
    fn(ms)
  }
  raf = requestAnimationFrame(own)
  return () => { subs.delete(fn); cancelAnimationFrame(raf) }
}
