// Общее для карт глубины и сцены-диорамы: поля во float, фильтры, плоскости по предметам, задник.
// Использует tools/depth-maps.mjs

/** Билинейно растянуть поле w×h до W×H */
export function resize(src, w, h, W, H) {
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * h / H - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * w / W - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0
      const a = src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx
      const b = src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx
      out[y * W + x] = a * (1 - ty) + b * ty
    }
  }
  return out
}
/** Среднее по квадрату (2r+1)² через интегральную сумму */
export function box(src, W, H, r) {
  const S = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += src[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row } }
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1)
      out[y * W + x] = (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((y1 - y0) * (x1 - x0))
    }
  }
  return out
}
/** Тонкое и сетчатое — проволока, прутья ворот, перила: сеть даёт им глубину «наполовину», и при сдвиге камеры они рвутся
    и рябят. Такое место узнаём по числу перепадов: у края предмета на отрезке один перепад, у решётки — много.
    Там глубина сглаживается в ровную плоскость: решётка движется целиком, проволока — вместе с фоном */
export function calmThin(src, W, H) {
  const R = 10
  const g = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    g[i] = Math.abs(src[i + 1] - src[i - 1]) + Math.abs(src[i + W] - src[i - W])
  }
  const tv = box(g, W, H, R)
  const hi = dilate(src, W, H, R), lo = dilate(src.map(v => -v), W, H, R)
  const mean = box(src, W, H, R)
  const out = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const range = hi[i] + lo[i]
    // перепадов на строку/столбец окна: сумма модулей градиента по окну, делённая на размах (≈1 у края, 2+ у решётки)
    const cross = range > 0.02 ? (tv[i] * (2 * R + 1)) / (2 * range) : 0
    const w = Math.min(1, Math.max(0, (cross - 1.5) / 1.2)) * Math.min(1, Math.max(0, (range - 0.03) / 0.05))
    out[i] = src[i] * (1 - w) + mean[i] * w
  }
  return out
}
/** Уточнение глубины по цвету картинки (совместный двусторонний фильтр): каждая точка берёт глубину соседей похожего
    цвета. Сеть считает глубину в ~518 px и размывает края — растянутый край глубины вылезает за контур предмета,
    и всё, что по нему считается (туман, свет, параллакс), обводит предмет каймой. После уточнения край глубины лежит
    на краю предмета: белая статуя в сером тумане отделяется чисто, тонкие детали не рвутся (цвет у них свой) */
export function snapToImage(depth, rgb, W, H, R = 10, STEP = 2, SIG = 6) {
  const SS = 2 * SIG * SIG, SC = 2 * 0.07 * 0.07
  const out = new Float32Array(W * H)
  const ws = []
  for (let dy = -R; dy <= R; dy += STEP) for (let dx = -R; dx <= R; dx += STEP) ws.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / SS)])
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, r0 = rgb[i * 3], g0 = rgb[i * 3 + 1], b0 = rgb[i * 3 + 2]
    let sum = 0, wsum = 0
    for (const [dx, dy, w0] of ws) {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
      const j = yy * W + xx
      const dr = rgb[j * 3] - r0, dg = rgb[j * 3 + 1] - g0, db = rgb[j * 3 + 2] - b0
      const w = w0 * Math.exp(-(dr * dr + dg * dg + db * db) / SC)
      sum += depth[j] * w; wsum += w
    }
    out[i] = sum / wsum
  }
  return out
}
/** Прямое не гнётся: изгиб прута, столба, рамы, ствола или провода при сдвиге камеры — это глубина, меняющаяся вдоль
    его длины. По картинке в каждой точке находится направление линии (структурный тензор), и глубина усредняется
    только вдоль неё (±L точек, с весом по сходству цвета — чтобы не сойти с прута на туман). Поперёк линии скачок
    глубины (край предмета) остаётся. Где линий нет (туман, небо), глубина не меняется */
export function alongLines(depth, rgb, W, H, L = 60) {
  const lum = new Float32Array(W * H)
  for (let i = 0; i < lum.length; i++) lum[i] = rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114
  const jxx = new Float32Array(W * H), jyy = new Float32Array(W * H), jxy = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, gx = (lum[i + 1] - lum[i - 1]) / 2, gy = (lum[i + W] - lum[i - W]) / 2
    jxx[i] = gx * gx; jyy[i] = gy * gy; jxy[i] = gx * gy
  }
  const a = blur(jxx, W, H, 2), b = blur(jyy, W, H, 2), c = blur(jxy, W, H, 2)
  const at = (arr, x, y) => {
    const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), y0 = Math.max(0, Math.min(H - 1, Math.floor(y)))
    const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), tx = x - Math.floor(x), ty = y - Math.floor(y)
    return (arr[y0 * W + x0] * (1 - tx) + arr[y0 * W + x1] * tx) * (1 - ty) + (arr[y1 * W + x0] * (1 - tx) + arr[y1 * W + x1] * tx) * ty
  }
  let cur = depth
  for (let pass = 0; pass < 3; pass++) {
    const out = Float32Array.from(cur)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, tr = a[i] + b[i]
      if (tr < 1e-5) continue
      const dd = Math.sqrt((a[i] - b[i]) ** 2 + 4 * c[i] * c[i]), coh = dd / tr
      if (coh < 0.35) continue
      // направление линии — поперёк градиента (собственный вектор меньшего собственного числа)
      const l2 = (tr - dd) / 2
      let vx = c[i], vy = l2 - a[i]
      if (Math.abs(vx) + Math.abs(vy) < 1e-9) { vx = a[i] >= b[i] ? 0 : 1; vy = a[i] >= b[i] ? 1 : 0 }
      const n = Math.hypot(vx, vy); vx /= n; vy /= n
      const l0 = lum[i]
      let sum = cur[i], ws = 1
      for (const dir of [1, -1]) for (let k = 1; k <= L; k++) {
        const px = x + dir * vx * k, py = y + dir * vy * k
        if (px < 0 || py < 0 || px > W - 1 || py > H - 1) break
        const dl = at(lum, px, py) - l0
        const w = Math.exp(-(dl * dl) / (2 * 0.08 * 0.08)) * Math.exp(-(k * k) / (2 * (L / 2) * (L / 2)))
        if (w < 0.05) break
        sum += at(cur, px, py) * w; ws += w
      }
      const k = Math.min(1, (coh - 0.35) / 0.3)
      out[i] = cur[i] * (1 - k) + (sum / ws) * k
    }
    cur = out
  }
  return cur
}
/** Связные куски маски (> 0,5) площадью не меньше min — списками точек */
export function connectedParts(mask, W, H, min) {
  const out = [], seen = new Uint8Array(W * H), q = new Int32Array(W * H)
  for (let s0 = 0; s0 < W * H; s0++) {
    if (seen[s0] || mask[s0] <= 0.5) continue
    let h = 0, t = 0
    q[t++] = s0; seen[s0] = 1
    while (h < t) {
      const i = q[h++], x = i % W
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= W * H || seen[j] || mask[j] <= 0.5) continue
        seen[j] = 1; q[t++] = j
      }
    }
    if (t >= min) out.push(Array.from(q.subarray(0, t)))
  }
  return out
}
/** Плоскость d = a·x + b·y + c наименьшими квадратами по точкам idx, два прохода: второй — без выбросов */
export function fitPlane(idx, field, W, H) {
  let a = 0, b = 0, c = 0, rms = 1, keep = null
  for (let pass = 0; pass < 2; pass++) {
    let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxd = 0, syd = 0, sd = 0
    for (let j = 0; j < idx.length; j += 3) {
      const i = idx[j]
      if (keep && !keep(i)) continue
      const x = (i % W) / W, y = Math.floor(i / W) / H, d = field[i]
      sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; n++; sxd += x * d; syd += y * d; sd += d
    }
    if (n < 30) break
    const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [sxd, syd, sd]
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    const D = det(M)
    if (Math.abs(D) < 1e-12) break
    const col = (ci) => M.map((r, ri) => r.map((val, cj) => (cj === ci ? v[ri] : val)))
    a = det(col(0)) / D; b = det(col(1)) / D; c = det(col(2)) / D
    let se = 0, m2 = 0
    for (let j = 0; j < idx.length; j += 3) { const i = idx[j]; const e = field[i] - (a * (i % W) / W + b * Math.floor(i / W) / H + c); se += e * e; m2++ }
    rms = Math.sqrt(se / Math.max(1, m2))
    const lim = 2 * rms + 0.01
    keep = (i) => Math.abs(field[i] - (a * (i % W) / W + b * Math.floor(i / W) / H + c)) < lim
  }
  return { a, b, c, rms }
}
/** Живое и мягкое — не плоскость: крона, трава, небо, ткань; для них остаётся сглаженная глубина */
export const NONPLANAR = new Set(['tree', 'grass', 'plant', 'palm', 'flower', 'field', 'sky', 'mountain', 'hill', 'rock', 'person', 'animal',
  'curtain', 'blanket', 'bag', 'apparel', 'pillow', 'cushion', 'towel', 'plaything', 'food'])
/** Сквозное (решётка, забор, перила, ворота): плоскостью целиком, вместе с просветами — прутья не гнутся и не рвутся
    (разделить прут и просвет поточечно сеть точно не может: прутья распадались на куски). Край области — плавно, см. seeThrough */
export const SEETHROUGH = new Set(['fence', 'railing', 'bannister', 'screen door', 'grandstand', 'rack', 'door', 'gate'])
/** Глубина плоскостями по предметам: сегментация делит кадр на предметы (статуя, знак, ворота, стена, пол, дорога),
    каждому подгоняется плоскость (наклон пола и стен сохраняется). Предмет при сдвиге камеры двигается как жёсткая
    карточка — не гнётся и не волнится; объём между предметами остаётся. Если плоскость ложится плохо (изогнутое),
    остаётся исходная глубина */
export function planes(field, segParts, W, H) {
  const mw = segParts[0].mask.width, mh = segParts[0].mask.height
  const lab = new Int16Array(mw * mh).fill(-1)
  segParts.forEach((p, k) => { const d = p.mask.data; for (let i = 0; i < d.length; i++) if (d[i] > 127) lab[i] = k })
  const L = new Int16Array(W * H)
  for (let y = 0; y < H; y++) { const my = Math.min(mh - 1, Math.floor(y * mh / H)); for (let x = 0; x < W; x++) L[y * W + x] = lab[my * mw + Math.min(mw - 1, Math.floor(x * mw / W))] }
  const out = Float32Array.from(field)
  const see = []
  // точки, уже отданные какой-то плоскости: расширение решётки на них не заходит
  const taken = new Uint8Array(W * H)
  const seen = new Uint8Array(W * H)
  const queue = new Int32Array(W * H)
  const minArea = W * H * 0.002
  let fitted = 0
  // связные области предметов; сначала сплошные, потом решётки — расширенная решётка не должна залезть на дом
  const comps = []
  for (let s0 = 0; s0 < W * H; s0++) {
    if (seen[s0]) continue
    const k = L[s0]
    let qh = 0, qt = 0
    queue[qt++] = s0; seen[s0] = 1
    while (qh < qt) {
      const i = queue[qh++], x = i % W, y = (i - x) / W
      if (x > 0 && !seen[i - 1] && L[i - 1] === k) { seen[i - 1] = 1; queue[qt++] = i - 1 }
      if (x < W - 1 && !seen[i + 1] && L[i + 1] === k) { seen[i + 1] = 1; queue[qt++] = i + 1 }
      if (y > 0 && !seen[i - W] && L[i - W] === k) { seen[i - W] = 1; queue[qt++] = i - W }
      if (y < H - 1 && !seen[i + W] && L[i + W] === k) { seen[i + W] = 1; queue[qt++] = i + W }
    }
    if (k < 0 || qt < minArea || NONPLANAR.has(segParts[k].label)) continue
    comps.push({ k, idx: queue.slice(0, qt), see: SEETHROUGH.has(segParts[k].label) })
  }
  comps.sort((p, q) => Number(p.see) - Number(q.see))
  for (const comp of comps) {
    const isSee = comp.see
    let idx = comp.idx
    let { a, b, c, rms } = fitPlane(idx, field, W, H)
    if (rms > (isSee ? 0.3 : 0.07)) continue
    // решётку сеть размечает с недобором: верх створки, столб или колючку относит к соседнему классу, и на границе
    // прутья гнутся. Сквозная область расширяется на 24 точки — но только в то, что по глубине сети не дальше самой
    // решётки (прутья, столбы); далёкий туман и лес вокруг остаются своими: полоса тумана с глубиной решётки дала бы
    // вокруг неё светлый ореол (туман шейдера считается по глубине). В дом и будку расширение не заходит никогда
    if (isSee) {
      const grow = new Float32Array(W * H)
      for (const i of idx) grow[i] = 1
      const wide = dilate(grow, W, H, 24)
      const extra = []
      for (let i = 0; i < W * H; i++) {
        if (!(wide[i] > 0.5) || grow[i] || taken[i]) continue
        const l = L[i]
        if (!(l < 0 || NONPLANAR.has(segParts[l].label) || SEETHROUGH.has(segParts[l].label))) continue
        if (field[i] > a * (i % W) / W + b * Math.floor(i / W) / H + c - 0.06) extra.push(i)
      }
      idx = Int32Array.from([...idx, ...extra])
    }
    // что плоскость объясняет плохо (сеть видит его сильно ближе или дальше), может быть другим предметом, попавшим
    // в маску: стенка будки, которую сеть назвала «дверью» вместе с воротами, или открытая калитка под своим углом.
    // Такой кусок целиком (вместе с просветами между прутьями) получает свою плоскость, а плоскость решётки
    // считается заново без него; не легла — кусок остаётся со своей глубиной. Отдельным куском считается только
    // крупное (от 0,5 % кадра, после «открытия» маски): тонкие прутья, столбы ворот и одиночные выбросы на лице знака
    // остаются с общей плоскостью
    const planeAt = (i) => Math.max(0, Math.min(1, a * (i % W) / W + b * Math.floor(i / W) / H + c))
    const odd = new Float32Array(W * H)
    let any = false
    for (const i of idx) if (isSee ? field[i] > planeAt(i) + 0.12 : Math.abs(field[i] - planeAt(i)) > 0.12) { odd[i] = 1; any = true }
    const R = isSee ? 8 : 6
    const chunks = any ? connectedParts(dilate(dilate(odd.map(v => 1 - v), W, H, R).map(v => 1 - v), W, H, R), W, H, W * H * 0.005) : []
    const apart = new Uint8Array(W * H)
    const inIdx = new Uint8Array(W * H)
    for (const i of idx) inIdx[i] = 1
    for (const ch of chunks) {
      const mine = Int32Array.from(ch.filter(i => inIdx[i]))
      for (const i of mine) apart[i] = 1
      const f = fitPlane(mine, field, W, H)
      if (f.rms < (isSee ? 0.3 : 0.1)) for (const i of mine) { out[i] = Math.max(0, Math.min(1, f.a * (i % W) / W + f.b * Math.floor(i / W) / H + f.c)); taken[i] = 1 }
    }
    const own = chunks.length ? idx.filter(i => !apart[i]) : idx
    if (own.length < idx.length) ({ a, b, c } = fitPlane(own, field, W, H))
    const reg = []
    for (const i of own) { out[i] = planeAt(i); taken[i] = 1; if (isSee) reg.push(i) }
    if (globalThis.planeDebug) { for (const i of idx) globalThis.planeDebug[i] = isSee ? 120 : 60; for (const i of own) globalThis.planeDebug[i] = isSee ? 255 : 180 }
    if (isSee) see.push({ reg, a, b, c })
    fitted++
  }
  return { out, fitted, see }
}
/** Край сквозной области рваный (маска сегментации ложится с запасом в туман над воротами), и ступенька глубины по нему
    при сдвиге камеры тянула фон рваной полосой. Поэтому наружу от области глубина плавно спускается от плоскости ворот
    к окружающему на R точек — только там, где вокруг дальше (туман, лес); ближнее (земля перед воротами) не трогаем.
    Внутри области — ровная плоскость: ворота двигаются жёстко */
export function seeThrough(regions, depth, W, H, R = 24) {
  const own = new Int32Array(W * H).fill(-1), dist = new Float32Array(W * H).fill(Infinity)
  let qh = 0, qt = 0
  const queue = new Int32Array(W * H)
  regions.forEach((r, k) => { for (const i of r.reg) { own[i] = k; dist[i] = 0; queue[qt++] = i } })
  // обход вширь от областей наружу: у каждой точки — ближайшая область и расстояние (по шагам)
  while (qh < qt) {
    const i = queue[qh++], x = i % W, d = dist[i] + 1
    if (d > R) continue
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= W * H || dist[j] <= d) continue
      dist[j] = d; own[j] = own[i]; queue[qt++] = j
    }
  }
  for (let i = 0; i < W * H; i++) {
    if (own[i] < 0 || dist[i] === 0 || dist[i] > R) continue
    const { a, b, c } = regions[own[i]]
    const plane = Math.max(0, Math.min(1, a * (i % W) / W + b * Math.floor(i / W) / H + c))
    const t = dist[i] / R, s = t * t * (3 - 2 * t)
    depth[i] = Math.max(depth[i], plane * (1 - s) + depth[i] * s)
  }
  for (const r of regions) for (const i of r.reg) { const { a, b, c } = r; depth[i] = Math.max(0, Math.min(1, a * (i % W) / W + b * Math.floor(i / W) / H + c)) }
  return regions.length
}
/** Ложный скачок — перепад глубины там, где на картинке края нет (посреди стенки, доски, рамы): предмет при сдвиге камеры
    рвался бы по нему на две части (так было с будкой на КПП, которую сеть наполовину отнесла к воротам). Там глубина
    плавно возвращается к глубине сети, уточнённой по цвету и сглаженной; настоящий край предмета (есть край на картинке)
    не трогается. Возвращает число ложных точек на фактуре (в тумане они безвредны) — по нему видно, где было что чинить */
export function mendFalseJumps(depth, fallback, rgb, W, H) {
  const L = new Float32Array(W * H)
  for (let i = 0; i < L.length; i++) L[i] = rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114
  const edge = new Float32Array(W * H), bad = new Float32Array(W * H)
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x
    edge[i] = Math.max(Math.abs(L[i + 2] - L[i - 2]), Math.abs(L[i + 2 * W] - L[i - 2 * W]))
  }
  const near = dilate(edge, W, H, 2)
  // фактура вокруг (доски, штукатурка, кора): ложный скачок на ней рвёт предмет; в тумане и на небе — безвреден
  const tex = box(edge, W, H, 4)
  let n = 0, harm = 0
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x
    const jump = Math.max(Math.abs(depth[i + 2] - depth[i - 2]), Math.abs(depth[i + 2 * W] - depth[i - 2 * W]))
    if (jump > 0.06 && near[i] < 0.03) { bad[i] = 1; n++; if (tex[i] > 0.012) harm++ }
  }
  if (!n) return 0
  if (process.env.JUMP_DEBUG) globalThis.jumpBad = bad
  const w = blur(dilate(bad, W, H, 5), W, H, 3)
  for (let i = 0; i < depth.length; i++) { const k = Math.min(1, w[i] * 1.5); if (k > 0) depth[i] = depth[i] * (1 - k) + fallback[i] * k }
  return harm
}
/** Максимум по квадрату (2r+1)²: по строкам, потом по столбцам */
export function dilate(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = -Infinity
    for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = Math.max(m, src[y * W + k])
    tmp[y * W + x] = m
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = -Infinity
    for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) m = Math.max(m, tmp[k * W + x])
    out[y * W + x] = m
  }
  return out
}
/** Гауссово размытие, раздельное */
export function blur(src, W, H, sigma) {
  const r = Math.ceil(sigma * 3), ker = []
  let sum = 0
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); ker.push(v); sum += v }
  for (let i = 0; i < ker.length; i++) ker[i] /= sum
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0
    for (let i = -r; i <= r; i++) v += src[y * W + Math.min(W - 1, Math.max(0, x + i))] * ker[i + r]
    tmp[y * W + x] = v
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0
    for (let i = -r; i <= r; i++) v += tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x] * ker[i + r]
    out[y * W + x] = v
  }
  return out
}
