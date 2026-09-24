// Поверхности кадра для света фонаря и ламп: g_<кадр>.png — красное стекло (витрины, окна, стекло будки: блик и
// полоса отражения), зелёное — гладкий пол (кафель, лак, мокрое: световая дорожка), синее — осколки и мелкий блестящий
// мусор на полу (искры, вспыхивают и гаснут, когда водят лучом). Где что — точками в materials.json истории:
//   { "<кадр>": { "glass": [[x, y], ...], "tiles": [...], "floor": [...] } } — проценты кадра, точка внутри поверхности;
//   tiles — кафельная стена, ванна: блестит, как стекло, но обводится крупнее
// Segment Anything (Apache 2.0, локально) обводит поверхность по её краю; осколки — светлые мелкие точки на полу.
//   node tools/materials.mjs ../red-thread-secret/<история> [--only l_shop]
import { SamModel, AutoProcessor, RawImage, env } from '@huggingface/transformers'
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
env.cacheDir = process.env.DEPTH_CACHE ?? '.cache/depth'
const story = process.argv[2]
if (!story) { console.error('укажите папку истории'); process.exit(1) }
const onlyArg = process.argv.indexOf('--only')
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null
const list = JSON.parse(readFileSync(`${story}/materials.json`, 'utf8'))
const W = 960
const sam = await SamModel.from_pretrained('Xenova/sam-vit-base', { dtype: 'fp32' })
const proc = await AutoProcessor.from_pretrained('Xenova/sam-vit-base')
for (const [id, spec] of Object.entries(list)) {
  if (only && !only.has(id)) continue
  const image = await RawImage.read(`${story}/art/${id}.jpg`)
  const [oh, ow] = [image.height, image.width]
  const H = Math.round(W * oh / ow)
  const emb = await sam.get_image_embeddings(await proc(image))
  /** маска по точкам: из трёх вариантов сети (часть, предмет, целое) — самая крупная уверенная не больше maxArea кадра
      (для стекла предел мал — стекло витрины, а не вся витрина) */
  async function region(pts, maxArea, part) {
    const acc = new Uint8Array(ow * oh)
    for (const [px, py] of pts ?? []) {
      const ip = await proc(image, { input_points: [[[[(px / 100) * ow, (py / 100) * oh]]]] })
      const out = await sam({ ...emb, input_points: ip.input_points, input_labels: ip.input_labels })
      const masks = await proc.post_process_masks(out.pred_masks, ip.original_sizes, ip.reshaped_input_sizes)
      const sc = Array.from(out.iou_scores.data), m = masks[0].data
      let best = -1, bestN = 0
      for (let k = 0; k < 3; k++) {
        let n = 0
        for (let i = 0; i < ow * oh; i++) if (m[k * ow * oh + i]) n++
        if (n / (ow * oh) >= maxArea || sc[k] < 0.7 || n < 50) continue
        if (best < 0 || (part ? n < bestN : n > bestN)) { best = k; bestN = n }
      }
      if (best >= 0) for (let i = 0; i < acc.length; i++) if (m[best * ow * oh + i]) acc[i] = 255
    }
    return sharp(Buffer.from(acc), { raw: { width: ow, height: oh, channels: 1 } }).resize(W, H).extractChannel(0).raw().toBuffer()
  }
  const glass = await region(spec.glass, 0.05, false)
  const tiles = await region(spec.tiles, 0.35, false)
  for (let i = 0; i < glass.length; i++) glass[i] = Math.max(glass[i], tiles[i])
  const floor0 = await region(spec.floor, 0.55, false)
  // пол — только то, что лежит (по карте глубины z_: к зрителю ближе с каждой строкой вниз): трубы и стены не блестят дорожкой
  const z = await sharp(`${story}/art/z_${id}.jpg`).resize(W, H, { fit: 'fill' }).extractChannel(0).blur(3).raw().toBuffer()
  const lyingB = Buffer.alloc(W * H)
  for (let y = 5; y < H - 5; y++) for (let x = 0; x < W; x++) { const i = y * W + x; lyingB[i] = z[i + 5 * W] - z[i - 5 * W] > 1 ? 255 : 0 }
  const lying = await sharp(lyingB, { raw: { width: W, height: H, channels: 1 } }).blur(4).extractChannel(0).raw().toBuffer()
  const floor = Buffer.from(floor0.map((v, i) => (lying[i] > 90 ? v : 0)))
  // осколки: на полу — точки заметно светлее окружения, мелкие
  const L = await sharp(`${story}/art/${id}.jpg`).resize(W * 2, H * 2).greyscale().raw().toBuffer()
  const Lb = await sharp(L, { raw: { width: W * 2, height: H * 2, channels: 1 } }).blur(4).raw().toBuffer()
  const px = Buffer.alloc(W * H * 3)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    px[i * 3] = glass[i]; px[i * 3 + 1] = floor[i]
    if (!floor[i]) continue
    // искра — точка заметно светлее окружения и самая светлая среди соседей (одна точка, а не полоса)
    let hot = 0, hx = 0, hy = 0
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const j = (y * 2 + dy) * W * 2 + x * 2 + dx; const v = L[j] - Lb[j]; if (v > hot) { hot = v; hx = dx; hy = dy } }
    const j0 = (y * 2 + hy) * W * 2 + x * 2 + hx
    let isMax = true
    for (let dy = -3; dy <= 3 && isMax; dy++) for (let dx = -3; dx <= 3; dx++) { if (!dx && !dy) continue; const j = j0 + dy * W * 2 + dx; if (L[j] - Lb[j] > hot) { isMax = false; break } }
    if (isMax && hot > 30) px[i * 3 + 2] = Math.min(255, (hot - 30) * 10)
  }
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${story}/art/g_${id}.png`)
  let g = 0, f = 0, s = 0
  for (let i = 0; i < W * H; i++) { if (px[i * 3] > 127) g++; if (px[i * 3 + 1] > 127) f++; if (px[i * 3 + 2] > 127) s++ }
  console.log('  ✓', id, `стекло ${(g / W / H * 100).toFixed(1)} %, пол ${(f / W / H * 100).toFixed(1)} %, искры ${s}`)
}
console.log('для SoloStory.materials:', JSON.stringify(Object.keys(list)))
