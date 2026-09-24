// Лёгкие копии объёмных кадров: <кадр>.lq.jpg — 1280 точек в ширину, ~100 КБ. На медленном интернете переход в новое
// место показывает лёгкую копию сразу, полная догружается и подменяет её незаметно (та же картинка, резче).
//   node tools/art-lq.mjs ../red-thread-secret/<история>/art [--force]
import sharp from 'sharp'
import { readdirSync, existsSync, statSync } from 'node:fs'
const dir = process.argv[2]
if (!dir) { console.error('укажите папку art истории'); process.exit(1) }
const force = process.argv.includes('--force')
let n = 0, before = 0, after = 0
for (const f of readdirSync(dir).filter(f => /^(l|o|x|m)_[^.]*\.jpg$/.test(f) && existsSync(`${dir}/z_${f}`))) {
  const out = `${dir}/${f.slice(0, -4)}.lq.jpg`
  if (!force && existsSync(out) && statSync(out).mtimeMs > statSync(`${dir}/${f}`).mtimeMs) continue
  await sharp(`${dir}/${f}`).resize(1280).jpeg({ quality: 74, mozjpeg: true }).toFile(out)
  before += statSync(`${dir}/${f}`).size; after += statSync(out).size; n++
}
console.log('лёгких копий', n, 'полные', (before / 1e6).toFixed(1), 'МБ → лёгкие', (after / 1e6).toFixed(1), 'МБ')
