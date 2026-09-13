// Иллюстрации дела через бесплатный генератор (Pollinations / Flux). Набор — cases/<CASE>/prompts/art.mjs.
//   CASE=<дело> SETTING=<мир> node tools/images.mjs — сгенерировать недостающие
//   node tools/images.mjs --redo id  — перегенерировать одну (seed сдвигается)
//   node tools/images.mjs --list     — список
// Стиль задаёт файл набора. Портреты сыщиков d_* ложатся в папку мира. Ватермарка генератора обрезается снизу.
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { artDir, worldArtDir, loadArtSet } from './paths.mjs'

const root = resolve(import.meta.dirname, '..')
// дело — CASE (портреты сыщиков d_* кладутся в папку сеттинга SETTING)
const OUT = artDir(process.env.CASE || 'meridian')
const SETTING_OUT = worldArtDir(process.env.SETTING || 'noir')
mkdirSync(OUT, { recursive: true })
mkdirSync(SETTING_OUT, { recursive: true })
const args = process.argv.slice(2)
const redo = args.includes('--redo') ? new Set(args[args.indexOf('--redo') + 1].split(',')) : null
const seedShift = Number(process.env.SEED || 0)

const { IMAGES } = await loadArtSet(process.env.CASE || 'meridian')

if (args.includes('--list')) { console.log(Object.keys(IMAGES).join('\n')); process.exit(0) }

const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function gen(id, attempt = 1) {
  const { prompt, w, h } = IMAGES[id]
  const seed = (hash(id) % 10000) + seedShift + (redo?.has(id) ? Math.floor(Math.random() * 1000) : 0)
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h + Math.round(h * 0.08)}&model=flux&nologo=true&seed=${seed}`
  const tmp = resolve(OUT, `${id}.tmp.jpg`)
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(180000) })
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) throw new Error(`${r.status}`)
    writeFileSync(tmp, Buffer.from(await r.arrayBuffer()))
    // срезаем полосу с ватермаркой снизу и пишем jpg
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-vf', `crop=iw:ih*0.925:0:0,scale=${w}:-2`, '-q:v', '3', resolve(id.startsWith('d_') ? SETTING_OUT : OUT, `${id}.jpg`)])
    unlinkSync(tmp)
    return true
  } catch (e) {
    if (attempt < 4) { await sleep(5000 * attempt); return gen(id, attempt + 1) }
    console.log(`  ✗ ${id}: ${e.message}`)
    return false
  }
}

const todo = Object.keys(IMAGES).filter(id => redo ? redo.has(id) : !existsSync(resolve(id.startsWith('d_') ? SETTING_OUT : OUT, `${id}.jpg`)))
console.log(`картинок всего ${Object.keys(IMAGES).length} · к генерации ${todo.length}`)
let ok = 0
for (let i = 0; i < todo.length; i += 1) {
  const batch = todo.slice(i, i + 1)
  const res = await Promise.all(batch.map(gen))
  ok += res.filter(Boolean).length
  console.log(`  ${batch.join(', ')} → готово ${ok} из ${todo.length}`)
  await sleep(4000)
}
console.log('готово')
