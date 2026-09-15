/* Озвучка сценария через ElevenLabs.
   Запуск: CASE=<дело> node_modules/.bin/jiti tools/voice.ts [--dry] [--only id1,id2] [--speakers w1,w2] [--force]
   --speakers — только реплики этих говорящих (сменили голос свидетелю — перегенерировать его с --force).
   Берёт ключ из .env, обходит все реплики сценария, кладёт cases/<дело>/voice/<id>.mp3,
   готовые пропускает. Печатает только id и числа. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCENARIO as S } from '../server/scenario/index'
import { honestBeatId, type Beat, type Presentation, type Question } from '../shared/types'
// @ts-expect-error — обычный .mjs без типов
import { voiceDir } from './paths.mjs'

const root = resolve(import.meta.dirname ?? '.', '..')
const env = Object.fromEntries(readFileSync(resolve(root, '.env'), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const KEY = env.ELEVENLABS_API_KEY
if (!KEY) { console.error('нет ELEVENLABS_API_KEY в .env'); process.exit(1) }

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const force = args.includes('--force')
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1]!.split(',')) : null
const speakers = args.includes('--speakers') ? new Set(args[args.indexOf('--speakers') + 1]!.split(',')) : null
const OUT = voiceDir(process.env.CASE || 'meridian')
mkdirSync(OUT, { recursive: true })

interface Line { id: string; speaker: string; text: string }
const lines: Line[] = []
const add = (b: Beat) => lines.push({ id: b.id, speaker: b.speaker, text: b.voice ?? b.text })

for (const b of S.prologue) add(b)
for (const w of S.witnesses) { add(w.greeting); add(w.idle) }
// ответ и его честные варианты — после того как ложь раскрыта
const talk = (x: Question | Presentation) => {
  lines.push({ id: x.id, speaker: x.witnessId, text: x.answer.voice ?? x.answer.text })
  for (const [i, h] of (x.honest ?? []).entries()) lines.push({ id: honestBeatId(x.id, i), speaker: x.witnessId, text: h.voice ?? h.text })
}
for (const q of S.questions) talk(q)
for (const p of S.presentations) talk(p)
for (const h of S.hints) add(h.beat)
for (const e of S.events ?? []) add(e.beat)
for (const o of S.overheard) add(o.beat)
for (const b of Object.values(S.backgrounds)) add(b.beat)
for (const d of Object.values(S.accusation.defenses)) add(d.beat)
for (const b of [...S.epilogue.truth, ...S.epilogue.branch.found, ...S.epilogue.branch.lost, S.epilogue.closing]) add(b)

// голос: свидетель — свой, иначе рассказчик/помощник дела. Дело выбирается переменной CASE
const voiceOf = (speaker: string) => S.witnesses.find(w => w.id === speaker)?.voiceId ?? (speaker === 'inspector' ? S.voices.inspector : S.voices.narrator)

const todo = lines.filter(l => (!only || only.has(l.id)) && (!speakers || speakers.has(l.speaker)) && (force || !existsSync(resolve(OUT, `${l.id}.mp3`))))
const chars = todo.reduce((n, l) => n + l.text.length, 0)
console.log(`реплик всего ${lines.length} · к генерации ${todo.length} · знаков ${chars}`)
// --list: id и говорящий каждой реплики — чтобы сгруппировать файлы по голосу (например, для проверки шума)
if (args.includes('--list')) for (const l of lines) console.log(`${l.id}\t${l.speaker}`)
if (dry) process.exit(0)

async function credits() {
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': KEY! } })
    const d = await r.json() as { character_count: number; character_limit: number }
    return `${d.character_count} из ${d.character_limit}`
  } catch { return '?' }
}

async function gen(l: Line, attempt = 1): Promise<boolean> {
  let r: Response
  try {
    r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceOf(l.speaker)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: l.text,
      model_id: 'eleven_v3',
      language_code: 'ru',
      voice_settings: { stability: l.speaker === 'narrator' || l.speaker === 'inspector' ? 0.5 : 0.35, similarity_boost: 0.8, style: 0.4 }
    })
    })
  } catch (e) {
    if (attempt < 4) { await new Promise(res => setTimeout(res, 5000 * attempt)); return gen(l, attempt + 1) }
    console.log(`  ✗ ${l.id}: сеть`)
    return false
  }
  if (!r.ok) {
    const body = await r.text()
    if (r.status === 429 && attempt < 4) { await new Promise(res => setTimeout(res, 4000 * attempt)); return gen(l, attempt + 1) }
    console.log(`  ✗ ${l.id}: ${r.status} ${body.slice(0, 120)}`)
    return false
  }
  writeFileSync(resolve(OUT, `${l.id}.mp3`), Buffer.from(await r.arrayBuffer()))
  return true
}

console.log('кредитов до:', await credits())
let ok = 0, fail = 0
// по три параллельно — лимит одновременных запросов на Starter небольшой
for (let i = 0; i < todo.length; i += 3) {
  const batch = todo.slice(i, i + 3)
  const res = await Promise.all(batch.map(gen))
  ok += res.filter(Boolean).length; fail += res.filter(x => !x).length
  process.stdout.write(`\r  готово ${ok} · ошибок ${fail} · осталось ${todo.length - i - batch.length}   `)
}
console.log()
console.log('кредитов после:', await credits())
// манифест — чтобы клиент знал, какие реплики озвучены
const have = lines.filter(l => existsSync(resolve(OUT, `${l.id}.mp3`))).map(l => l.id)
writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(have))
console.log(`манифест: ${have.length} файлов`)
