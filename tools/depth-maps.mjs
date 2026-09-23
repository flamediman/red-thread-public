// Карты глубины для объёмных кадров (2,5D): Depth Anything V2 Small (ONNX) локально, ~1 с на кадр, без ключей и кредитов.
//   Один раз: npm i --no-save @huggingface/transformers sharp   (модель ~100 МБ скачается в .cache при первом запуске)
//   node tools/depth-maps.mjs ../red-thread-secret/<история>/art [--force] [--only l_kpp,l_turn]   — для всех l_*/o_* без готовой z_*
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
const DILATE = 2
const BLUR = 1.2

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
const list = readdirSync(dir).filter(f => /^(l|o)_.*\.jpg$/.test(f) && (!only || only.has(f.slice(0, -4))))
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
  const field = blur(dilate(resize(raw, w, h, W, H), W, H, DILATE), W, H, BLUR)
  const px = Buffer.alloc(W * H)
  for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, Math.round(field[i] * 255 + Math.random() - 0.5)))
  await sharp(px, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 92 }).toFile(out)
  done++
  console.log('  ✓', f)
}
console.log('готово карт:', done, 'из', list.length)
console.log('для SoloStory.depth:', JSON.stringify(readdirSync(dir).filter(f => f.startsWith('z_')).map(f => f.slice(2, -4))))
