/* Очередь загрузок для слабого интернета. Канал один на всё, и загрузки делят его поровну: при входе в игру картинка
   места (90 КБ лёгкая копия) на 1,5 Мбит/с шла 11 секунд — вместе с ней качались заготовка соседнего места (942 КБ,
   начатая ещё на заставке), музыка и петли атмосферы. Теперь по порядку:
   1. картинка текущего места (artLoad) — фоновые загрузки при её начале обрываются (браузер потом докачивает их с того
      же места), музыка и новые петли ждут её (afterArt), но не дольше нескольких секунд;
   2. звук текущего места (soundLoad) и лёгкие заготовки соседних мест (backgroundFetch 'art': копия, глубина, трава);
   3. тяжёлые заготовки (backgroundFetch 'sound': полные картинки соседей, боевая музыка) — после звука места.
   Заготовки каждого вида идут по одной. */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const inFlight = new Set<Promise<unknown>>()
let idle: Promise<void> = Promise.resolve()
let release: (() => void) | null = null
const background = new Set<AbortController>()
const sounds = new Set<Promise<unknown>>()

/** загрузка картинки текущего места: фоновые загрузки обрываются, тяжёлое ждёт, пока она идёт */
export function artLoad<T>(p: Promise<T>): Promise<T> {
  for (const c of background) c.abort()
  background.clear()
  if (!inFlight.size) idle = new Promise<void>((r) => { release = r })
  inFlight.add(p)
  const done = () => { inFlight.delete(p); if (!inFlight.size) release?.() }
  p.then(done, done)
  return p
}

/** дождаться, пока картинка текущего места загрузится (не дольше maxMs). Сначала — короткая пауза: музыку, звук и
    заготовки страница заказывает в том же обновлении, в каком объёмный кадр начинает грузить новое место */
export async function afterArt(maxMs = 6000): Promise<void> {
  const until = Date.now() + maxMs
  await sleep(60)
  // полная картинка встаёт в очередь сразу за лёгкой копией — после каждой загрузки даём ей встать и ждём и её
  while (inFlight.size && Date.now() < until) {
    await Promise.race([idle, sleep(until - Date.now())])
    await sleep(0)
  }
}

/** загрузка звука текущего места (тема, петля атмосферы): тяжёлые заготовки ждут её */
export function soundLoad<T>(p: Promise<T>): Promise<T> {
  sounds.add(p)
  const done = () => { sounds.delete(p) }
  p.then(done, done)
  return p
}

const chains: Record<'art' | 'sound', Promise<unknown>> = { art: Promise.resolve(), sound: Promise.resolve() }

/** заготовка на потом (в кэш браузера), по одной своего вида, целиком; оборвана картинкой места — false.
    'art' — после картинки места, 'sound' — ещё и после звука места */
export function backgroundFetch(url: string, after: 'art' | 'sound' = 'art'): Promise<boolean> {
  const run = chains[after].then(() => fetchLater(url, after))
  chains[after] = run.catch(() => {})
  return run
}

async function fetchLater(url: string, after: 'art' | 'sound'): Promise<boolean> {
  const until = Date.now() + 90_000
  for (;;) {
    await afterArt(60_000)
    if (after === 'art') break
    // звук места заказывается, как только картинка загрузилась, — даём ему встать в очередь первым
    await sleep(300)
    if (!sounds.size || Date.now() > until) break
    await Promise.race([Promise.allSettled([...sounds]), sleep(20_000)])
  }
  const ctrl = new AbortController()
  background.add(ctrl)
  try {
    const r = await fetch(url, { priority: 'low', signal: ctrl.signal } as RequestInit)
    // тело — до конца: fetch отдаёт ответ по заголовкам, и без чтения следующая заготовка начиналась, пока эта ещё шла
    await r.arrayBuffer()
    return r.ok
  }
  catch { return false }
  finally { background.delete(ctrl) }
}
