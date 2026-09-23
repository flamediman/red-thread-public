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
function snapToImage(depth, rgb, W, H) {
  const R = 10, STEP = 2, SS = 2 * 6 * 6, SC = 2 * 0.07 * 0.07
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
  const snapped = snapToImage(snapToImage(calmThin(resize(raw, w, h, W, H), W, H), rgb, W, H), rgb, W, H)
  const field = blur(dilate(snapped, W, H, DILATE), W, H, BLUR)
  const px = Buffer.alloc(W * H)
  for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, Math.round(field[i] * 255 + Math.random() - 0.5)))
  await sharp(px, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 92 }).toFile(out)
  done++
  console.log('  ✓', f)
}
console.log('готово карт:', done, 'из', list.length)
console.log('для SoloStory.depth:', JSON.stringify(readdirSync(dir).filter(f => f.startsWith('z_')).map(f => f.slice(2, -4))))
