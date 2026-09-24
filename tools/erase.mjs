// Убрать предмет с картинки без генератора: Segment Anything (по точкам на предмете) обводит его, LaMa дорисовывает
// то, что было за ним, — в полном разрешении, кусками по 512 точек вокруг предмета. Всё локально, лицензии Apache 2.0.
//   node tools/erase.mjs <вход.jpg> <выход.jpg> '<[[x, y], ...]>' [запас=12]   — x, y в точках картинки
//   node tools/erase.mjs <вход.jpg> <выход.jpg> <маска.png> [запас]            — готовая маска (белое — стереть): провода, трещины
//   рядом с выходом кладётся <выход>.mask.png — что стёрто (проверить глазами)
//   LaMa: curl -L -o .cache/lama/lama_fp32.onnx https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
import { SamModel, AutoProcessor, RawImage, env } from '@huggingface/transformers'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
env.cacheDir = process.env.DEPTH_CACHE ?? '.cache/depth'
const [src, dst, ptsJson, padArg] = process.argv.slice(2)
if (!ptsJson) { console.error("node tools/erase.mjs <вход> <выход> '[[x, y], ...]' [запас]"); process.exit(1) }
const PAD = Number(padArg ?? 12)
const meta = await sharp(src).metadata()
const W = meta.width, H = meta.height
const mask = new Uint8Array(W * H)
if (ptsJson.endsWith('.png')) {
  const m = await sharp(ptsJson).resize(W, H, { fit: 'fill' }).extractChannel(0).raw().toBuffer()
  for (let i = 0; i < mask.length; i++) mask[i] = m[i] > 127 ? 1 : 0
} else {
const pts = JSON.parse(ptsJson)
const sam = await SamModel.from_pretrained('Xenova/sam-vit-base', { dtype: 'fp32' })
const proc = await AutoProcessor.from_pretrained('Xenova/sam-vit-base')
const image = await RawImage.read(src)
const emb = await sam.get_image_embeddings(await proc(image))
for (const p of pts) {
  const ip = await proc(image, { input_points: [[[p]]] })
  const out = await sam({ ...emb, input_points: ip.input_points, input_labels: ip.input_labels })
  const masks = await proc.post_process_masks(out.pred_masks, ip.original_sizes, ip.reshaped_input_sizes)
  // самая уверенная из масок не больше 4 % кадра (иначе сеть берёт вместе с предметом стену или землю)
  const sc = Array.from(out.iou_scores.data), m = masks[0].data
  let best = -1
  for (let k = 0; k < 3; k++) {
    let n = 0
    for (let i = 0; i < W * H; i++) if (m[k * W * H + i]) n++
    if (n / (W * H) < 0.04 && (best < 0 || sc[k] > sc[best])) best = k
  }
  if (best >= 0) for (let i = 0; i < W * H; i++) if (m[best * W * H + i]) mask[i] = 1
}
}
// запас вокруг предмета: тень, ореол, край
// (порог — вручную после размытия: у sharp порог срабатывает раньше размытия, и край маски выходил мягким на десяток
// точек — сквозь заливку просвечивал стёртый предмет)
const blurred = await sharp(Buffer.from(mask.map(v => v * 255)), { raw: { width: W, height: H, channels: 1 } })
  .blur(PAD / 2).extractChannel(0).raw().toBuffer()
const grown = Buffer.from(blurred.map(v => (v > 8 ? 255 : 0)))
let x0 = W, y0 = H, x1 = 0, y1 = 0
for (let i = 0; i < grown.length; i++) if (grown[i]) { const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
const rgb = await sharp(src).removeAlpha().raw().toBuffer()
const lama = await ort.InferenceSession.create('.cache/lama/lama_fp32.onnx')
// куски 512 с перекрытием по прямоугольнику маски (плюс поле 128 — LaMa нужно окружение)
const T = 512, M = 128
const bx0 = Math.max(0, x0 - M), by0 = Math.max(0, y0 - M), bx1 = Math.min(W, x1 + M), by1 = Math.min(H, y1 + M)
const xs = [], ys = []
for (let x = bx0; ; x += 384) { xs.push(Math.max(0, Math.min(x, W - T))); if (x + T >= bx1) break }
for (let y = by0; ; y += 384) { ys.push(Math.max(0, Math.min(y, H - T))); if (y + T >= by1) break }
const acc = new Float32Array(W * H * 3), wsum = new Float32Array(W * H)
for (const ty of ys) for (const tx of xs) {
  const im = new Float32Array(3 * T * T), mk = new Float32Array(T * T)
  let any = 0
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const i = (ty + y) * W + tx + x, j = y * T + x
    const h = grown[i] ? 1 : 0
    mk[j] = h; any += h
    for (let c = 0; c < 3; c++) im[c * T * T + j] = h ? 0 : rgb[i * 3 + c] / 255
  }
  if (!any) continue
  const out = (await lama.run({ image: new ort.Tensor('float32', im, [1, 3, T, T]), mask: new ort.Tensor('float32', mk, [1, 1, T, T]) })).output.data
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const i = (ty + y) * W + tx + x, j = y * T + x, w = Math.max(1, Math.min(x + 1, T - x, y + 1, T - y))
    for (let c = 0; c < 3; c++) acc[i * 3 + c] += out[c * T * T + j] * w
    wsum[i] += w
  }
}
// шов маски — плавный: край дорисованного смешивается с картинкой на 3 точки
const soft = await sharp(grown, { raw: { width: W, height: H, channels: 1 } }).blur(1.5).extractChannel(0).raw().toBuffer()
const outb = Buffer.from(rgb)
for (let i = 0; i < W * H; i++) {
  if (!soft[i] || !wsum[i]) continue
  const a = soft[i] / 255
  for (let c = 0; c < 3; c++) outb[i * 3 + c] = Math.round(rgb[i * 3 + c] * (1 - a) + Math.max(0, Math.min(255, acc[i * 3 + c] / wsum[i])) * a)
}
await sharp(outb, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toFile(dst)
await sharp(grown, { raw: { width: W, height: H, channels: 1 } }).png().toFile(dst.replace(/\.jpg$/, '.mask.png'))
console.log('стёрто точек', grown.reduce((s, v) => s + (v ? 1 : 0), 0), 'рамка', x0, y0, x1, y1)
