// Иллюстрации через открытое пространство FLUX.1-schnell на Hugging Face (без ключа, полное разрешение).
//   CASE=<дело> SETTING=<мир> node tools/flux.mjs [--only id1,id2] [--force] [--scale 1.25]
//   node tools/flux.mjs --one media/art/settings/neon.jpg 1600 1200 "<промпт>" [seed]
// Набор картинок — cases/<CASE>/prompts/art.mjs (CASE=settings — tools/art-settings.mjs). Портреты сыщиков d_* ложатся в папку мира.
// Пространство отдаёт webp; macOS sips перегоняет его в jpg.
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { artDir, worldArtDir, loadArtSet } from './paths.mjs'

const root = resolve(import.meta.dirname, '..')
const SPACE = 'https://black-forest-labs-flux-1-schnell.hf.space/gradio_api'
const args = process.argv.slice(2)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const snap = n => Math.max(256, Math.min(2048, Math.round(n / 16) * 16))
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

async function call(prompt, w, h, seed) {
  const r = await fetch(`${SPACE}/call/infer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [prompt, seed, false, snap(w), snap(h), 4] }),
    signal: AbortSignal.timeout(60000)
  })
  if (!r.ok) throw new Error(`call ${r.status}`)
  const { event_id } = await r.json()
  const s = await fetch(`${SPACE}/call/infer/${event_id}`, { signal: AbortSignal.timeout(300000) })
  const text = await s.text()
  if (/event: error/.test(text)) throw new Error('space: ' + (text.split('data:').pop() ?? '').trim().slice(0, 160))
  const m = text.match(/"url":\s*"([^"]+)"/)
  if (!m) throw new Error('нет картинки в ответе')
  const img = await fetch(m[1], { signal: AbortSignal.timeout(120000) })
  if (!img.ok) throw new Error(`file ${img.status}`)
  return Buffer.from(await img.arrayBuffer())
}

/** Квота видеокарты у анонимных пользователей маленькая: когда кончается, пространство отвечает пустой ошибкой.
    Тогда ждём (QUOTA_WAIT минут) и пробуем ту же картинку снова — очередь идёт медленно, но без брака. */
const QUOTA_WAIT = Number(process.env.QUOTA_WAIT || 12) * 60000
async function render(file, w, h, prompt, seed) {
  mkdirSync(dirname(file), { recursive: true })
  let other = 0
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      const buf = await call(prompt, w, h, seed)
      const tmp = file + '.webp'
      writeFileSync(tmp, buf)
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', tmp, '--out', file], { stdio: 'ignore' })
      unlinkSync(tmp)
      return true
    } catch (e) {
      const msg = String(e.message)
      const quota = /space: null|quota|GPU/i.test(msg)
      console.log(`  ${new Date().toTimeString().slice(0, 5)} попытка ${attempt}: ${quota ? 'квота видеокарты, ждём' : msg}`)
      if (!quota && ++other >= 5) return false
      await sleep(quota ? QUOTA_WAIT : 8000 * other)
    }
  }
  return false
}

if (args[0] === '--one') {
  const [, out, w, h, prompt, seed = '11'] = args
  const ok = await render(resolve(root, out), Number(w), Number(h), prompt, Number(seed))
  console.log(ok ? `ok ${out}` : `✗ ${out}`)
  process.exit(ok ? 0 : 1)
}

const CASE = process.env.CASE || 'meridian'
const OUT = artDir(CASE)
const SETTING_OUT = worldArtDir(process.env.SETTING || 'noir')
// --only задаёт и порядок: самые заметные картинки — первыми
const onlyList = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
const only = onlyList ? new Set(onlyList) : null
const force = args.includes('--force')
const scale = args.includes('--scale') ? Number(args[args.indexOf('--scale') + 1]) : 1
const { IMAGES } = await loadArtSet(CASE)
const target = id => resolve(id.startsWith('d_') ? SETTING_OUT : OUT, `${id}.jpg`)

const todo = (onlyList ?? Object.keys(IMAGES)).filter(id => IMAGES[id] && (force || only || !existsSync(target(id))))
console.log(`картинок ${Object.keys(IMAGES).length} · к генерации ${todo.length}`)
let ok = 0
for (const id of todo) {
  const { prompt, w, h } = IMAGES[id]
  const done = await render(target(id), w * scale, h * scale, prompt, hash(id) % 100000)
  if (done) ok++
  console.log(`  ${done ? '✓' : '✗'} ${id} → ${ok} из ${todo.length}`)
  await sleep(1500)
}
console.log('готово')
