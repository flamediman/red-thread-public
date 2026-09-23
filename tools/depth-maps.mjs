// Карты глубины для объёмных кадров (2,5D): Depth Anything V2 Small (ONNX) локально, ~1 с на кадр, без ключей и кредитов.
//   Один раз: npm i --no-save @huggingface/transformers sharp   (модель ~100 МБ скачается в .cache при первом запуске)
//   node tools/depth-maps.mjs ../red-thread-secret/<история>/art [--force] [--only l_kpp,l_turn]   — для всех l_*/o_* (места), x_* (погони), m_* (существа) без готовой z_*
//   затем имена — в SoloStory.depth
// Вся обработка — в числах с плавающей точкой, в восемь бит карта попадает только в самом конце, с шумом-дизерингом:
//   иначе на плавном полу видны ступеньки глубины, а свет фонаря рисует по ним горизонтали.
// Ближнее расширено на несколько пикселей за свои края (максимум по соседям): иначе край предмета несёт пиксели фона
//   и при параллаксе двоится. sharp.dilate для этого не годится — он для чёрно-белых масок и рвёт полутона на контуры.
import { pipeline, env } from '@huggingface/transformers'
import sharp from 'sharp'
import { readdirSync, existsSync } from 'node:fs'
env.cacheDir = process.env.DEPTH_CACHE ?? '.cache/depth'
const dir = process.argv[2]
if (!dir) { console.error('укажите папку art истории'); process.exit(1) }
const onlyArg = process.argv.indexOf('--only')
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null
const DILATE = 1
const BLUR = 0.7

/** Билинейно растянуть поле w×h до W×H */
function resize(src, w, h, W, H) {
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
function box(src, W, H, r) {
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
function calmThin(src, W, H) {
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
function snapToImage(depth, rgb, W, H, R = 10, STEP = 2, SIG = 6) {
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
/** Живое и мягкое — не плоскость: крона, трава, небо, ткань; для них остаётся сглаженная глубина */
const NONPLANAR = new Set(['tree', 'grass', 'plant', 'palm', 'flower', 'field', 'sky', 'mountain', 'hill', 'rock', 'person', 'animal',
  'curtain', 'blanket', 'bag', 'apparel', 'pillow', 'cushion', 'towel', 'plaything', 'food'])
/** Сквозное (решётка, забор, перила): плоскостью целиком, вместе с просветами — без выравнивания по цвету,
    иначе просветы растаскиваются к далёкому фону и прутья волнятся */
const SEETHROUGH = new Set(['fence', 'railing', 'bannister', 'screen door', 'grandstand', 'rack', 'door', 'gate'])
/** Глубина плоскостями по предметам: сегментация делит кадр на предметы (статуя, знак, ворота, стена, пол, дорога),
    каждому подгоняется плоскость (наклон пола и стен сохраняется). Предмет при сдвиге камеры двигается как жёсткая
    карточка — не гнётся и не волнится; объём между предметами остаётся. Если плоскость ложится плохо (изогнутое),
    остаётся исходная глубина */
function planes(field, segParts, W, H) {
  const mw = segParts[0].mask.width, mh = segParts[0].mask.height
  const lab = new Int16Array(mw * mh).fill(-1)
  segParts.forEach((p, k) => { const d = p.mask.data; for (let i = 0; i < d.length; i++) if (d[i] > 127) lab[i] = k })
  const L = new Int16Array(W * H)
  for (let y = 0; y < H; y++) { const my = Math.min(mh - 1, Math.floor(y * mh / H)); for (let x = 0; x < W; x++) L[y * W + x] = lab[my * mw + Math.min(mw - 1, Math.floor(x * mw / W))] }
  const out = Float32Array.from(field)
  const lock = new Uint8Array(W * H)
  const seen = new Uint8Array(W * H)
  const queue = new Int32Array(W * H)
  const minArea = W * H * 0.002
  let fitted = 0
  for (let s0 = 0; s0 < W * H; s0++) {
    if (seen[s0]) continue
    const k = L[s0]
    // связная область одного предмета
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
    // плоскость d = a·x + b·y + c наименьшими квадратами, два прохода: второй — без выбросов (кайма у края области)
    let a = 0, b = 0, c = 0, rms = 1, keep = null
    for (let pass = 0; pass < 2; pass++) {
      let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxd = 0, syd = 0, sd = 0
      for (let j = 0; j < qt; j += 3) {
        const i = queue[j]
        if (keep && !keep(i)) continue
        const x = (i % W) / W, y = Math.floor(i / W) / H, d = field[i]
        sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; n++; sxd += x * d; syd += y * d; sd += d
      }
      if (n < 30) break
      // решение 3×3
      const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [sxd, syd, sd]
      const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
      const D = det(M)
      if (Math.abs(D) < 1e-12) break
      const col = (ci) => M.map((r, ri) => r.map((val, cj) => (cj === ci ? v[ri] : val)))
      a = det(col(0)) / D; b = det(col(1)) / D; c = det(col(2)) / D
      let se = 0, m2 = 0
      for (let j = 0; j < qt; j += 3) { const i = queue[j]; const e = field[i] - (a * (i % W) / W + b * Math.floor(i / W) / H + c); se += e * e; m2++ }
      rms = Math.sqrt(se / Math.max(1, m2))
      const lim = 2 * rms + 0.01
      keep = (i) => Math.abs(field[i] - (a * (i % W) / W + b * Math.floor(i / W) / H + c)) < lim
    }
    const see = SEETHROUGH.has(segParts[k].label)
    // сплошное — только если плоскость легла; сквозное (прутья близко, просветы далеко) — плоскостью в любом случае
    if (rms > (see ? 0.3 : 0.07)) continue
    for (let j = 0; j < qt; j++) { const i = queue[j]; out[i] = Math.max(0, Math.min(1, a * (i % W) / W + b * Math.floor(i / W) / H + c)); if (see) lock[i] = 1 }
    fitted++
  }
  return { out, fitted, lock }
}
/** Максимум по квадрату (2r+1)²: по строкам, потом по столбцам */
function dilate(src, W, H, r) {
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
function blur(src, W, H, sigma) {
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

const est = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'fp32' })
const seg = await pipeline('image-segmentation', 'Xenova/segformer-b0-finetuned-ade-512-512')
const list = readdirSync(dir).filter(f => /^(l|o|x|m)_.*\.jpg$/.test(f) && (!only || only.has(f.slice(0, -4))))
let done = 0
for (const f of list) {
  const out = `${dir}/z_${f}`
  if (existsSync(out) && !process.argv.includes('--force') && !only) continue
  const res = await est(`${dir}/${f}`)
  const pd = res.predicted_depth
  const [h, w] = pd.dims.slice(-2)
  const raw = Float32Array.from(pd.data)
  let lo = Infinity, hi = -Infinity
  for (const v of raw) { if (v < lo) lo = v; if (v > hi) hi = v }
  for (let i = 0; i < raw.length; i++) raw[i] = (raw[i] - lo) / (hi - lo || 1)
  const meta = await sharp(`${dir}/${f}`).metadata()
  const W = meta.width, H = meta.height
  // светлое — ближе; расширить ближнее, сгладить, в восемь бит — с шумом, чтобы не было ступенек
  // цвет кадра — направляющая для краёв глубины (0…1, чуть размытый: зерно плёнки не должно рвать глубину)
  const rgbBuf = await sharp(`${dir}/${f}`).removeAlpha().blur(0.6).raw().toBuffer()
  const rgb = new Float32Array(rgbBuf.length)
  for (let i = 0; i < rgb.length; i++) rgb[i] = rgbBuf[i] / 255
  // плоское должно двигаться как жёсткая карточка: внутри однородного по цвету (лицо знака, полотно ворот) глубина
  // выравнивается на большом радиусе, иначе при сдвиге камеры плоский предмет гнётся и волнится
  const { out: planar, fitted, lock } = planes(calmThin(resize(raw, w, h, W, H), W, H), await seg(`${dir}/${f}`), W, H)
  const snapped = snapToImage(snapToImage(planar, rgb, W, H), rgb, W, H)
  for (let i = 0; i < lock.length; i++) if (lock[i]) snapped[i] = planar[i]
  const field = blur(dilate(snapped, W, H, DILATE), W, H, BLUR)
  const px = Buffer.alloc(W * H)
  for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, Math.round(field[i] * 255 + Math.random() - 0.5)))
  await sharp(px, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 92 }).toFile(out)
  done++
  console.log('  ✓', f, `плоскостей ${fitted}`)
}
console.log('готово карт:', done, 'из', list.length)
console.log('для SoloStory.depth:', JSON.stringify(readdirSync(dir).filter(f => f.startsWith('z_')).map(f => f.slice(2, -4))))
