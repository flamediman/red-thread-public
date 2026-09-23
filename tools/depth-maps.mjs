// Карты глубины для объёмных кадров (2,5D): Depth Anything V2 Small (ONNX) локально, ~1 с на кадр, без ключей и кредитов.
//   Один раз: npm i --no-save @huggingface/transformers sharp   (модель ~100 МБ скачается в .cache при первом запуске)
//   node tools/depth-maps.mjs ../red-thread-secret/<история>/art   — для всех l_*/o_* без готовой z_*; затем имена — в SoloStory.depth
import { pipeline, env } from '@huggingface/transformers'
import sharp from 'sharp'
import { readdirSync, existsSync } from 'node:fs'
env.cacheDir = '.cache/depth'
const dir = process.argv[2]
if (!dir) { console.error('укажите папку art истории'); process.exit(1) }
const est = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'fp32' })
const list = readdirSync(dir).filter(f => /^(l|o)_.*\.jpg$/.test(f))
let done = 0
for (const f of list) {
  const out = `${dir}/z_${f}`
  if (existsSync(out)) continue
  const d = (await est(`${dir}/${f}`)).depth
  const meta = await sharp(`${dir}/${f}`).metadata()
  // светлое — ближе; лёгкое размытие убирает ступеньки на краях предметов
  await sharp(Buffer.from(d.data), { raw: { width: d.width, height: d.height, channels: d.channels ?? 1 } }).resize(meta.width, meta.height).blur(1.2).jpeg({ quality: 88 }).toFile(out)
  done++
}
console.log('готово карт:', done, 'из', list.length)
console.log('для SoloStory.depth:', JSON.stringify(readdirSync(dir).filter(f => f.startsWith('z_')).map(f => f.slice(2, -4))))
