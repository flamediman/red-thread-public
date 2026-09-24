// Трава для живых травинок: маска w_<кадр>.jpg (зелёный канал — трава), шейдер растит из неё свои травинки поверх
// картинки. Где трава — отмечено точками в grass.json истории ({ "<кадр>": [[x, y], ...] } или { "pts": […], "top": 55 },
// проценты кадра, точка внутри травы; top — выше этой строки травы нет); Segment Anything (Apache 2.0, локально) обводит траву по её краю на картинке. Из маски выкидывается
// то, что не лежит на земле (по карте глубины z_: стена леса, туман), — там травинкам расти не из чего.
//   node tools/grass-masks.mjs ../red-thread-secret/<история> [--only l_turn,l_square]
//   → art/w_<кадр>.jpg; имена кадров — в SoloStory.wind
import { SamModel, AutoProcessor, RawImage, env } from '@huggingface/transformers'
import sharp from 'sharp'
import { readFileSync, readdirSync, unlinkSync } from 'node:fs'
env.cacheDir = process.env.DEPTH_CACHE ?? '.cache/depth'
const story = process.argv[2]
if (!story) { console.error('укажите папку истории'); process.exit(1) }
const onlyArg = process.argv.indexOf('--only')
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null
const list = JSON.parse(readFileSync(`${story}/grass.json`, 'utf8'))
const W = 640
const sam = await SamModel.from_pretrained('Xenova/sam-vit-base', { dtype: 'fp32' })
const proc = await AutoProcessor.from_pretrained('Xenova/sam-vit-base')
// маски кадров, которых больше нет в списке, — убрать
if (!only) for (const f of readdirSync(`${story}/art`)) if (/^w_.*\.jpg$/.test(f) && !list[f.slice(2, -4)]) unlinkSync(`${story}/art/${f}`)
for (const [id, spec] of Object.entries(list)) {
  if (only && !only.has(id)) continue
  const pts = Array.isArray(spec) ? spec : spec.pts, top = Array.isArray(spec) ? 0 : spec.top ?? 0
  const image = await RawImage.read(`${story}/art/${id}.jpg`)
  const [oh, ow] = [image.height, image.width]
  const H = Math.round(W * oh / ow)
  const acc = new Uint8Array(ow * oh)
  const emb = await sam.get_image_embeddings(await proc(image))
  for (const [px, py] of pts) {
    const ip = await proc(image, { input_points: [[[[(px / 100) * ow, (py / 100) * oh]]]] })
    const out = await sam({ ...emb, input_points: ip.input_points, input_labels: ip.input_labels })
    const masks = await proc.post_process_masks(out.pred_masks, ip.original_sizes, ip.reshaped_input_sizes)
    // из трёх вариантов — уверенный и не больше трети кадра (иначе сеть берёт всю землю вместе с дорогой)
    const sc = Array.from(out.iou_scores.data), m = masks[0].data
    const area = sc.map((_, k) => { let n = 0; for (let i = 0; i < ow * oh; i++) if (m[k * ow * oh + i]) n++; return n / (ow * oh) })
    let best = -1
    for (let k = 0; k < 3; k++) if (area[k] < 0.33 && (best < 0 || sc[k] > sc[best])) best = k
    if (best < 0) continue
    for (let i = 0; i < acc.length; i++) if (m[best * ow * oh + i]) acc[i] = 255
  }
  const mk = await sharp(Buffer.from(acc), { raw: { width: ow, height: oh, channels: 1 } }).resize(W, H).extractChannel(0).raw().toBuffer()
  const z = await sharp(`${story}/art/z_${id}.jpg`).resize(W, H, { fit: 'fill' }).extractChannel(0).blur(4).raw().toBuffer()
  const lying = Buffer.alloc(W * H)
  for (let y = 6; y < H - 6; y++) for (let x = 0; x < W; x++) { const i = y * W + x; lying[i] = z[i + 6 * W] - z[i - 6 * W] > 1 ? 255 : 0 }
  const lb = await sharp(lying, { raw: { width: W, height: H, channels: 1 } }).blur(6).extractChannel(0).raw().toBuffer()
  const px = Buffer.alloc(W * H * 3)
  let on = 0
  for (let i = 0; i < W * H; i++) { const v = lb[i] > 90 && Math.floor(i / W) >= (H * top) / 100 ? mk[i] : 0; px[i * 3 + 1] = v; if (v > 127) on++ }
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).blur(1.2).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(`${story}/art/w_${id}.jpg`)
  console.log('  ✓', id, `трава ${(on / (W * H) * 100).toFixed(1)} %`)
}
console.log('для SoloStory.wind:', JSON.stringify(Object.keys(list)))
