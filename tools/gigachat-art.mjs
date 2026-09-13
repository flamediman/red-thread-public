// Иллюстрации через GigaChat (Kandinsky): ключ GIGACHAT_AUTH_KEY в .env, сертификат Минцифры — tools/certs.
//   NODE_EXTRA_CA_CERTS=tools/certs/russian_ca_bundle.pem CASE=<дело> SETTING=<мир> node tools/gigachat-art.mjs [--only a,b] [--force] [--skip-existing-big]
// Модель отдаёт квадрат 1024×1024 и несколько вариантов: первый идёт в игру, остальные — в .variants рядом для выбора.
// Кадр под нужные пропорции вырезается по центру (портреты 3:4 без потери разрешения, фоны — по ширине).
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { artDir, worldArtDir, loadArtSet } from './paths.mjs'

const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries(readFileSync(resolve(root, '.env'), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const AUTH = env.GIGACHAT_AUTH_KEY
if (!AUTH) { console.error('нет GIGACHAT_AUTH_KEY в .env'); process.exit(1) }
const CASE = process.env.CASE || 'meridian'
const OUT = artDir(CASE)
const SETTING_OUT = worldArtDir(process.env.SETTING || 'noir')
const args = process.argv.slice(2)
const onlyList = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
const force = args.includes('--force')
const PAR = Number(process.env.PAR || 3)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const { IMAGES } = await loadArtSet(CASE)
const target = id => resolve(id.startsWith('d_') ? SETTING_OUT : OUT, `${id}.jpg`)

let token = null, tokenUntil = 0
async function auth() {
  if (token && Date.now() < tokenUntil - 60000) return token
  const r = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', RqUID: randomUUID(), Authorization: `Basic ${AUTH}` },
    body: 'scope=GIGACHAT_API_PERS'
  })
  const d = await r.json()
  if (!d.access_token) throw new Error(`oauth ${r.status} ${JSON.stringify(d).slice(0, 120)}`)
  token = d.access_token; tokenUntil = d.expires_at
  return token
}

async function draw(prompt) {
  const tok = await auth()
  const r = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({
      model: 'GigaChat',
      messages: [
        { role: 'system', content: 'Ты — Василий Кандинский, художник-фотограф кино. Всегда рисуешь изображение по описанию, без текста и надписей на картинке.' },
        { role: 'user', content: `Нарисуй изображение по описанию: ${prompt}` }
      ],
      function_call: 'auto'
    }),
    signal: AbortSignal.timeout(180000)
  })
  const d = await r.json()
  const ids = [...(d.choices?.[0]?.message?.content ?? '').matchAll(/<img src="([^"]+)"/g)].map(m => m[1])
  if (!ids.length) throw new Error(`нет картинки: ${r.status} ${JSON.stringify(d).slice(0, 160)}`)
  const files = []
  for (const id of ids.slice(0, 4)) {
    const f = await fetch(`https://gigachat.devices.sberbank.ru/api/v1/files/${id}/content`, { headers: { Accept: 'application/jpg', Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(120000) })
    if (f.ok) files.push(Buffer.from(await f.arrayBuffer()))
  }
  if (!files.length) throw new Error('файлы не скачались')
  return files
}

/** вырезать по центру под пропорции w:h и привести к ширине w (не больше исходного разрешения ×1.6) */
function fit(src, dst, w, h) {
  const ratio = w / h
  const crop = ratio >= 1 ? `crop=iw:iw/${ratio.toFixed(4)}` : `crop=ih*${ratio.toFixed(4)}:ih`
  const outW = Math.min(w, ratio >= 1 ? 1600 : 1024)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `${crop},scale=${outW}:-2:flags=lanczos,unsharp=5:5:0.4:5:5:0.0`, '-q:v', '2', dst])
}

async function one(id) {
  const { prompt, w, h } = IMAGES[id]
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const files = await draw(prompt)
      const file = target(id)
      mkdirSync(dirname(file), { recursive: true })
      const vdir = resolve(dirname(file), '.variants'); mkdirSync(vdir, { recursive: true })
      files.forEach((b, i) => {
        const raw = resolve(vdir, `${id}.${i}.raw.jpg`)
        writeFileSync(raw, b)
        fit(raw, i === 0 ? file : resolve(vdir, `${id}.${i}.jpg`), w, h)
        unlinkSync(raw)
      })
      return true
    } catch (e) {
      console.log(`  ${id} попытка ${attempt}: ${String(e.message).slice(0, 160)}`)
      await sleep(4000 * attempt)
    }
  }
  return false
}

const todo = (onlyList ?? Object.keys(IMAGES)).filter(id => IMAGES[id] && (force || only(id)))
function only(id) { return onlyList ? true : !existsSync(target(id)) }
console.log(`картинок к генерации: ${todo.length}`)
let ok = 0, fail = 0, next = 0
await Promise.all(Array.from({ length: PAR }, async () => {
  while (next < todo.length) {
    const id = todo[next++]
    if (await one(id)) ok++; else fail++
    console.log(`  ✓ ${ok} · ✗ ${fail} · осталось ${todo.length - next}  (${id})`)
  }
}))
console.log('готово')
