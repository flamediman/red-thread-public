// Маски растительности для ветра в объёмных кадрах: SegFormer (ADE20K, ONNX) локально, без ключей и кредитов.
//   Один раз: npm i --no-save @huggingface/transformers sharp   (модель ~15 МБ скачается в .cache при первом запуске)
//   node tools/wind-masks.mjs ../red-thread-secret/<история>/art [--force] [--only l_kpp,l_turn]
//   → w_<кадр>.jpg (светлое — деревья, трава, кусты) для кадров, где растительности больше 1 %; имена — в SoloStory.wind
// Шейдер по маске качает ветки и траву: верхушки сильнее, порывами, в грозу сильнее.
import { pipeline, env } from '@huggingface/transformers'
import sharp from 'sharp'
import { readdirSync, existsSync, unlinkSync } from 'node:fs'
env.cacheDir = process.env.DEPTH_CACHE ?? '.cache/depth'
const dir = process.argv[2]
if (!dir) { console.error('укажите папку art истории'); process.exit(1) }
const onlyArg = process.argv.indexOf('--only')
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null
/** что качается ветром (классы ADE20K) */
const FOLIAGE = new Set(['tree', 'grass', 'plant', 'palm', 'flower', 'field'])
const W = 480

const seg = await pipeline('image-segmentation', 'Xenova/segformer-b0-finetuned-ade-512-512')
const list = readdirSync(dir).filter(f => /^(l|o|x)_.*\.jpg$/.test(f) && (!only || only.has(f.slice(0, -4))))
const kept = []
for (const f of list) {
  const out = `${dir}/w_${f}`
  if (existsSync(out) && !process.argv.includes('--force') && !only) { kept.push(f.slice(0, -4)); continue }
  const parts = await seg(`${dir}/${f}`)
  const hits = parts.filter(p => FOLIAGE.has(p.label))
  if (!hits.length) { if (existsSync(out)) unlinkSync(out); continue }
  const { width, height } = hits[0].mask
  const acc = new Uint8Array(width * height)
  for (const h of hits) { const m = h.mask.data; for (let i = 0; i < acc.length; i++) if (m[i] > acc[i]) acc[i] = m[i] }
  let on = 0
  for (const v of acc) if (v > 127) on++
  const share = on / acc.length
  if (share < 0.01) { if (existsSync(out)) unlinkSync(out); continue }
  // края мягкие: у границы ветки качаются слабее, чем внутри кроны
  await sharp(Buffer.from(acc), { raw: { width, height, channels: 1 } }).resize(W).blur(1.4).jpeg({ quality: 85 }).toFile(out)
  kept.push(f.slice(0, -4))
  console.log('  ✓', f, `${Math.round(share * 100)} %`, hits.map(h => h.label).join(', '))
}
console.log('для SoloStory.wind:', JSON.stringify(kept))
