// Пакетная перерисовка через Gemini Batch API (Nano Banana Pro): вдвое дешевле обычных запросов ($0,067 за 2K), ответ — за часы.
//   CASE=<дело> node tools/gemini-batch.mjs submit <план.json> <имя>   — собрать запросы, загрузить, поставить в очередь
//   CASE=<дело> node tools/gemini-batch.mjs poll <имя>                  — узнать состояние; готово — скачать и разложить картинки
//   CASE=<дело> node tools/gemini-batch.mjs unpack <имя> <файл.jsonl>   — разложить уже скачанный ответ
// План — список { id, mode, refs?, text? }:
//   mode 'new'  — нарисовать заново по промпту из prompts/art.mjs; refs — образцы стиля (кадры дела, пути или id)
//   mode 'place' — нарисовать заново, но места и люди как на образцах (погони, крупные планы, сцены)
//   mode 'edit' — переделать первый образец: та же композиция (изнанка из кадра места, повтор в 2K); text — что изменить
// Готовые картинки — в art/.variants/<id>.nb.jpg (кадры в игре не трогаются), ход дел — в .cache/gemini-batch/<имя>.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { artDir, loadArtSet, readEnv, root } from './paths.mjs'

const KEY = readEnv().GEMINI_API_KEY
if (!KEY) { console.error('нет GEMINI_API_KEY в .env'); process.exit(1) }
const CASE = process.env.CASE || 'lisya-pad'
const MODEL = process.env.MODEL || 'gemini-3-pro-image'
const API = 'https://generativelanguage.googleapis.com'
const ART = artDir(CASE)
const VAR = resolve(ART, '.variants')
const STATE_DIR = resolve(root, '.cache/gemini-batch')
mkdirSync(STATE_DIR, { recursive: true }); mkdirSync(VAR, { recursive: true })
const [cmd, a1, a2] = process.argv.slice(2)
const { IMAGES } = await loadArtSet(CASE)

const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const ratioOf = r => { const [a, b] = r.split(':').map(Number); return a / b }
const nearest = (w, h) => RATIOS.reduce((best, r) => (Math.abs(Math.log(ratioOf(r) * h / w)) < Math.abs(Math.log(ratioOf(best) * h / w)) ? r : best))
const refPath = r => (r.includes('/') ? resolve(root, r) : resolve(ART, `${r}.jpg`))
const jpeg = f => ({ inlineData: { mimeType: 'image/jpeg', data: readFileSync(f).toString('base64') } })

const STYLE = 'The attached images are finished frames from the same game. Match only their photographic look: film stock, grain, colour grading and level of realism. Do not copy their lighting, composition or content: depict only what is described, lit as described. '
const PLACE = 'The attached frames show the places and characters of this game that appear in the new picture. Keep their architecture, materials, colours, landmarks, faces and clothes consistent with the attached frames, and match their photographic look, but show exactly the view, lighting and moment described. '
const EDIT = 'Re-render the first attached frame keeping exactly the same composition, camera angle, framing and the positions of all objects. '
const TAIL = '. No text, no letters, no captions, no watermark, no people unless described.'

function request(item) {
  const img = IMAGES[item.id]
  if (!img) throw new Error(`нет промпта ${item.id}`)
  const parts = []
  for (const r of item.refs ?? []) { const f = refPath(r); if (!existsSync(f)) throw new Error(`нет образца ${f}`); parts.push(jpeg(f)) }
  const lead = item.mode === 'edit' ? EDIT : item.mode === 'place' && parts.length ? PLACE : parts.length ? STYLE : ''
  const body = item.mode === 'edit' ? `${item.text ?? 'Increase resolution and fine detail only.'} The frame shows: ${img.prompt}` : `${item.text ? `${item.text} ` : ''}${img.prompt}`
  parts.push({ text: `${lead}${body}${TAIL}` })
  return { key: item.id, request: { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: nearest(img.w, img.h), imageSize: '2K' } } } }
}

async function upload(buf, name) {
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(buf.length), 'X-Goog-Upload-Header-Content-Type': 'application/jsonl', 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { display_name: name } })
  })
  const url = start.headers.get('x-goog-upload-url')
  if (!url) throw new Error(`загрузка не началась: ${start.status} ${(await start.text()).slice(0, 200)}`)
  const up = await fetch(url, { method: 'POST', headers: { 'Content-Length': String(buf.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: buf })
  const j = await up.json()
  if (!j.file?.name) throw new Error(`загрузка: ${up.status} ${JSON.stringify(j).slice(0, 200)}`)
  return j.file.name
}

/** вырезать по центру под пропорции кадра и привести к ширине кадра дела (не шире 1600) */
function fit(src, dst, w, h) {
  const ratio = w / h
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `crop='min(iw,ih*${ratio.toFixed(4)})':'min(ih,iw/${ratio.toFixed(4)})',scale=${Math.min(w, 1600)}:-2:flags=lanczos`, '-q:v', '2', dst])
}

if (cmd === 'submit') {
  const plan = JSON.parse(readFileSync(resolve(a1), 'utf8'))
  const name = a2
  if (!name) { console.error('укажите имя пакета'); process.exit(1) }
  const lines = plan.map(item => JSON.stringify(request(item)))
  const buf = Buffer.from(lines.join('\n') + '\n')
  console.log(`запросов: ${lines.length}, файл ${(buf.length / 1e6).toFixed(1)} МБ, ориентир ≈ $${(lines.length * 0.067).toFixed(2)}`)
  const file = await upload(buf, `${CASE}-${name}`)
  const r = await fetch(`${API}/v1beta/models/${MODEL}:batchGenerateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch: { display_name: `${CASE}-${name}`, input_config: { file_name: file } } })
  })
  const j = await r.json()
  if (!j.name) { console.error('пакет не принят:', r.status, JSON.stringify(j).slice(0, 300)); process.exit(1) }
  writeFileSync(resolve(STATE_DIR, `${name}.json`), JSON.stringify({ batch: j.name, file, plan, at: new Date().toISOString() }, null, 2))
  console.log('в очереди:', j.name)
} else if (cmd === 'poll') {
  const st = JSON.parse(readFileSync(resolve(STATE_DIR, `${a1}.json`), 'utf8'))
  const j = await (await fetch(`${API}/v1beta/${st.batch}`, { headers: { 'x-goog-api-key': KEY } })).json()
  const state = j.metadata?.state ?? j.state
  const stats = j.metadata?.batchStats ?? j.batchStats
  console.log('состояние:', state, stats ? JSON.stringify(stats) : '')
  const out = j.response?.responsesFile ?? j.metadata?.output?.responsesFile ?? j.output?.responsesFile
  if (!/SUCCEEDED/.test(state ?? '') || !out) process.exit(0)
  // ответ большой (сотни мегабайт картинок в base64): качаем curl на диск, разбираем построчно
  const file = resolve(STATE_DIR, `${a1}.jsonl`)
  if (!existsSync(file)) execFileSync('curl', ['-sS', '-L', '-o', file, '-H', `x-goog-api-key: ${KEY}`, `${API}/download/v1beta/${out}:download?alt=media`], { stdio: 'inherit' })
  await unpack(st, file)
} else if (cmd === 'unpack') {
  // разобрать уже скачанный ответ: unpack <имя> <файл.jsonl>
  const st = JSON.parse(readFileSync(resolve(STATE_DIR, `${a1}.json`), 'utf8'))
  await unpack(st, resolve(a2))
} else {
  console.log('команды: submit <план.json> <имя> | poll <имя> | unpack <имя> <файл.jsonl>')
}

async function unpack(st, file) {
  const { createReadStream } = await import('node:fs')
  const { createInterface } = await import('node:readline')
  let ok = 0, bad = 0, outTok = 0, inTok = 0
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (!line.trim()) continue
    const row = JSON.parse(line)
    const id = row.key
    const resp = row.response
    const parts = resp?.candidates?.[0]?.content?.parts ?? []
    // у Pro бывают черновые «мысленные» картинки — берём последнюю итоговую
    const img = parts.filter(p => p.inlineData && !p.thought).pop()?.inlineData
    outTok += resp?.usageMetadata?.candidatesTokenCount ?? 0
    inTok += resp?.usageMetadata?.promptTokenCount ?? 0
    if (!img) { bad++; console.log('  ✗', id, JSON.stringify(row.error ?? resp?.candidates?.[0]?.finishReason ?? resp?.promptFeedback ?? '').slice(0, 160)); continue }
    const raw = resolve(VAR, `${id}.nb.raw`)
    writeFileSync(raw, Buffer.from(img.data, 'base64'))
    const { w, h } = IMAGES[id]
    fit(raw, resolve(VAR, `${id}.nb.jpg`), w, h)
    unlinkSync(raw)
    ok++
  }
  console.log(`картинок: ${ok}, без картинки: ${bad}; токенов: вход ${inTok}, выход ${outTok} ≈ $${(inTok / 1e6 * 1 + outTok / 1e6 * 60).toFixed(2)} по пакетной цене`)
  st.done = new Date().toISOString(); st.ok = ok; st.bad = bad
  writeFileSync(resolve(STATE_DIR, `${a1}.json`), JSON.stringify(st, null, 2))
}
