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
const DILATE = Number(process.env.DILATE ?? 3)
const BLUR = 0.7

import { resize, box, calmThin, snapToImage, alongLines, connectedParts, fitPlane, NONPLANAR, SEETHROUGH, planes, seeThrough, mendFalseJumps, dilate, blur } from './depth-lib.mjs'

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
  // карта глубины — не шире 1600: глубина плавная, больше точек ей не нужно, а радиусы ниже подобраны под 1600
  const meta = await sharp(`${dir}/${f}`).metadata()
  const W = Math.min(1600, meta.width), H = Math.round(meta.height * W / meta.width)
  // светлое — ближе; расширить ближнее, сгладить, в восемь бит — с шумом, чтобы не было ступенек
  // цвет кадра — направляющая для краёв глубины (0…1, чуть размытый: зерно плёнки не должно рвать глубину)
  const rgbBuf = await sharp(`${dir}/${f}`).resize(W, H).removeAlpha().blur(0.6).raw().toBuffer()
  const rgb = new Float32Array(rgbBuf.length)
  for (let i = 0; i < rgb.length; i++) rgb[i] = rgbBuf[i] / 255
  // плоское должно двигаться как жёсткая карточка: внутри однородного по цвету (лицо знака, полотно ворот) глубина
  // выравнивается на большом радиусе, иначе при сдвиге камеры плоский предмет гнётся и волнится
  const full = resize(raw, w, h, W, H)
  if (process.env.PLANE_DEBUG) globalThis.planeDebug = new Uint8Array(W * H)
  const { out: planar, fitted, see } = planes(calmThin(full, W, H), await seg(`${dir}/${f}`), W, H)
  const snapped = snapToImage(snapToImage(planar, rgb, W, H), rgb, W, H)
  // решётки — ровной плоскостью (выравнивание по цвету растаскивало бы просветы к фону), край — плавно наружу
  const grids = see.length ? seeThrough(see, snapped, W, H) : 0
  const mended = mendFalseJumps(snapped, blur(snapToImage(full, rgb, W, H), W, H, 6), rgb, W, H)
  const straight = alongLines(snapped, rgb, W, H)
  snapped.set(straight)
  const field = blur(dilate(snapped, W, H, DILATE), W, H, BLUR)
  const px = Buffer.alloc(W * H)
  for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, Math.round(field[i] * 255 + Math.random() - 0.5)))
  await sharp(px, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 92 }).toFile(out)
  done++
  console.log('  ✓', f, `плоскостей ${fitted}`, grids ? `решёток ${grids}` : '', mended ? `ложных скачков на фактуре ${mended}` : '')
}
console.log('готово карт:', done, 'из', list.length)
console.log('для SoloStory.depth:', JSON.stringify(readdirSync(dir).filter(f => f.startsWith('z_')).map(f => f.slice(2, -4))))
