// Иллюстрации через Gemini API (Nano Banana): ключ GEMINI_API_KEY в .env. Промпты — те же, что для GigaChat (prompts/art.mjs дела).
//   CASE=<дело> SETTING=<мир> node tools/gemini-art.mjs --only a,b [--ref x,y]   (прежний кадр уходит в .variants/<id>.before.jpg)
//   --ref — готовые кадры дела как образец стиля: модель видит их и рисует новое в той же манере (свет, плёнка, цвет)
//   --remaster — перерисовать нынешний кадр: та же композиция и расстановка, выше качество (связанные кадры не рассыпаются)
//   --compare — не заменять кадр в игре, а положить вариант в .variants/<id>.nb-new.jpg / .nb-remaster.jpg для сравнения
//   MODEL=gemini-3-pro-image (Nano Banana Pro, по умолчанию) или gemini-3.1-flash-image (Nano Banana 2, дешевле)
// Платно: примерно 4–15 центов за картинку. Без --only ничего не рисует — чтобы случайно не перерисовать всё дело.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { artDir, worldArtDir, loadArtSet } from './paths.mjs'

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(readFileSync(resolve(root, '.env'), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const KEY = env.GEMINI_API_KEY
if (!KEY) { console.error('нет GEMINI_API_KEY в .env'); process.exit(1) }
const CASE = process.env.CASE || 'meridian'
const MODEL = process.env.MODEL || 'gemini-3-pro-image'
const OUT = artDir(CASE)
const SETTING_OUT = worldArtDir(process.env.SETTING || 'noir')
const args = process.argv.slice(2)
const arg = name => (args.includes(name) ? args[args.indexOf(name) + 1].split(',') : null)
const onlyList = arg('--only')
const refs = arg('--ref') ?? []
const remaster = args.includes('--remaster')
const compare = args.includes('--compare')
if (!onlyList) { console.error('укажите --only id1,id2'); process.exit(1) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const { IMAGES } = await loadArtSet(CASE)
const target = id => resolve(id.startsWith('d_') ? SETTING_OUT : OUT, `${id}.jpg`)

const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const ratioOf = r => { const [a, b] = r.split(':').map(Number); return a / b }
const nearest = (w, h) => RATIOS.reduce((best, r) => (Math.abs(Math.log(ratioOf(r) * h / w)) < Math.abs(Math.log(ratioOf(best) * h / w)) ? r : best))

async function draw(id, prompt, w, h) {
  const parts = []
  const jpeg = f => ({ inlineData: { mimeType: 'image/jpeg', data: readFileSync(f).toString('base64') } })
  let lead = ''
  if (remaster && existsSync(target(id))) {
    parts.push(jpeg(target(id)))
    lead = 'Re-render the attached frame as a high-quality film photograph. Keep exactly the same composition, camera angle and framing, the same objects in the same places, the same light direction, colour palette and mood. Improve realism, detail and textures; remove AI artifacts, warped geometry and garbled text. The frame shows: '
  } else {
    // образец — id картинки этого набора или путь к файлу (например, кадр из папки дела для картинки меню)
    for (const r of refs) { const f = r.includes('/') ? resolve(root, r) : target(r); if (existsSync(f)) parts.push(jpeg(f)) }
    if (parts.length) lead = 'The attached images are finished frames from the same game. Match their photographic style, lighting, film grain and colour exactly, but depict a new subject. '
  }
  parts.push({ text: `${lead}${prompt}. No text, no letters, no captions, no watermark, no people unless described.` })
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: nearest(w, h), imageSize: '2K' } } }),
    signal: AbortSignal.timeout(240000)
  })
  const d = await r.json()
  // у Pro бывают черновые «мысленные» картинки — берём последнюю итоговую
  const img = (d.candidates?.[0]?.content?.parts ?? []).filter(p => p.inlineData && !p.thought).pop()?.inlineData
  if (!img) throw new Error(`нет картинки: ${r.status} ${JSON.stringify(d).slice(0, 200)}`)
  return Buffer.from(img.data, 'base64')
}

/** вырезать по центру под пропорции w:h, не шире 2560 */
function fit(src, dst, w, h) {
  const ratio = w / h
  const crop = `crop='min(iw,ih*${ratio.toFixed(4)})':'min(ih,iw/${ratio.toFixed(4)})'`
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `${crop},scale='min(iw,2560)':-2:flags=lanczos`, '-q:v', '3', dst])
}

async function one(id) {
  const { prompt, w, h } = IMAGES[id]
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const buf = await draw(id, prompt, w, h)
      const game = target(id)
      mkdirSync(dirname(game), { recursive: true })
      const vdir = resolve(dirname(game), '.variants'); mkdirSync(vdir, { recursive: true })
      const file = compare ? resolve(vdir, `${id}.nb-${remaster ? 'remaster' : 'new'}.jpg`) : game
      // прежний кадр не теряется: уходит в .variants рядом
      if (!compare && existsSync(game)) writeFileSync(resolve(vdir, `${id}.before.jpg`), readFileSync(game))
      const raw = resolve(vdir, `${id}.gemini.raw`)
      writeFileSync(raw, buf)
      fit(raw, file, w, h)
      unlinkSync(raw)
      return true
    } catch (e) {
      console.log(`  ${id} попытка ${attempt}: ${String(e.message).slice(0, 200)}`)
      await sleep(5000 * attempt)
    }
  }
  return false
}

const todo = onlyList.filter(id => IMAGES[id])
if (todo.length < onlyList.length) console.log('нет в prompts/art.mjs:', onlyList.filter(id => !IMAGES[id]).join(', '))
console.log(`картинок к генерации: ${todo.length} (${MODEL})`)
let ok = 0, fail = 0
for (const id of todo) {
  if (await one(id)) ok++; else fail++
  console.log(`  ✓ ${ok} · ✗ ${fail}  (${id})`)
}
console.log('готово')
