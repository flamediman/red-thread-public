/* Озвучка одиночной истории через ElevenLabs.
     STORY=<история> node_modules/.bin/jiti tools/voice-solo.ts [--dry] [--only id1,id2] [--speakers hero,zina] [--force]
   Реплики и их id — те же, что даёт движок (server/game/solo-lines.ts). Файлы — cases/<история>/voice/<id>.mp3,
   готовые пропускает. Голос: рассказчик и герой — из story.voices, персонажи — из npcs[].voiceId.
   Обработка: fx 'loudspeaker' (радиоузел, голос из громкоговорителя) и 'tape' (магнитофонная лента) — через ffmpeg;
   pitch у персонажа поднимает тон (детский голос). */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { SOLO_STORIES } from '../server/scenario/index'
import { assignVoiceIds } from '../server/game/solo-lines'
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
const id = process.env.STORY || Object.keys(SOLO_STORIES)[0]
const entry = id ? SOLO_STORIES[id] : null
if (!entry) { console.error('истории нет:', id, '— есть:', Object.keys(SOLO_STORIES).join(', ')); process.exit(1) }
const S = entry.story
const OUT = voiceDir(S.id)
mkdirSync(OUT, { recursive: true })

const lines = assignVoiceIds(S)
const npc = (speaker: string) => S.npcs.find(n => n.id === speaker)
const voiceOf = (speaker: string) => speaker === 'hero' ? S.voices.hero : speaker === 'narrator' ? S.voices.narrator : npc(speaker)?.voiceId ?? S.voices.narrator
/** обработка файла: у реплики своя, иначе — как у персонажа */
const fxOf = (l: { speaker: string; id: string }) => {
  const line = findLine(l.id)
  return line?.fx ?? npc(l.speaker)?.fx
}
function findLine(lineId: string) {
  // реплика с этим id уже помечена в объектах истории — ищем её, чтобы прочитать fx
  const all = [S.start.scene, ...S.places.flatMap(p => [p.enter?.scene ?? [], ...p.exits.map(x => x.lock?.open?.scene ?? [])]),
    ...S.hotspots.flatMap(h => [h.look?.scene ?? [], ...(h.use ?? []).map(u => u.effect.scene ?? []), h.puzzle?.success.scene ?? []]),
    ...S.dialogues.flatMap(d => Object.values(d.nodes).flatMap(n => [n.lines, n.effect?.scene ?? [], ...(n.choices ?? []).map(c => c.effect?.scene ?? [])])),
    ...(S.chases ?? []).map(c => c.success.scene ?? []), ...S.endings.map(e => e.scene)]
  for (const list of all) for (const l of list) if (l.id === lineId) return l
  return null
}

const todo = lines.filter(l => (!only || only.has(l.id)) && (!speakers || speakers.has(l.speaker)) && (force || !existsSync(resolve(OUT, `${l.id}.mp3`))))
const chars = todo.reduce((n, l) => n + l.text.length, 0)
console.log(`история ${S.id}: реплик ${lines.length} · к генерации ${todo.length} · знаков ${chars}`)
for (const sp of new Set(lines.map(l => l.speaker))) if (!voiceOf(sp)) console.log(`  ! у ${sp} нет голоса`)
if (dry) process.exit(0)

async function credits() {
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': KEY! } })
    const d = await r.json() as { character_count: number; character_limit: number }
    return `${d.character_count} из ${d.character_limit}`
  } catch { return '?' }
}

/** ffmpeg-фильтр по обработке: громкоговоритель — узкая полоса, компрессия, короткое эхо над водой; лента — срез верха и лёгкое шипение */
function filterFor(fx: 'loudspeaker' | 'tape' | undefined, pitch: number | undefined) {
  const parts: string[] = []
  if (pitch && pitch !== 1) parts.push(`asetrate=44100*${pitch},aresample=44100,atempo=${(1 / pitch).toFixed(4)}`)
  if (fx === 'loudspeaker') parts.push('highpass=f=380,lowpass=f=3400,acompressor=threshold=-20dB:ratio=5:attack=5:release=80,aecho=0.8:0.45:75:0.22,volume=1.4')
  if (fx === 'tape') parts.push('highpass=f=120,lowpass=f=6200,acompressor=threshold=-18dB:ratio=3')
  return parts.join(',')
}

async function gen(l: { id: string; speaker: string; text: string }, attempt = 1): Promise<boolean> {
  let r: Response
  try {
    r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceOf(l.speaker)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: l.text,
        model_id: 'eleven_v3',
        language_code: 'ru',
        voice_settings: { stability: l.speaker === 'narrator' ? 0.6 : l.speaker === 'hero' ? 0.5 : 0.4, similarity_boost: 0.8, style: l.speaker === 'narrator' ? 0.25 : 0.4 }
      })
    })
  } catch {
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
  const file = resolve(OUT, `${l.id}.mp3`)
  const filter = filterFor(fxOf(l), npc(l.speaker)?.pitch)
  if (!filter) { writeFileSync(file, Buffer.from(await r.arrayBuffer())); return true }
  const raw = `${file}.raw.mp3`
  writeFileSync(raw, Buffer.from(await r.arrayBuffer()))
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', filter, '-codec:a', 'libmp3lame', '-q:a', '2', file])
    execFileSync('rm', [raw])
  } catch (e) {
    console.log(`  ! ${l.id}: обработка не удалась (${(e as Error).message.slice(0, 80)}), оставлен сырой файл`)
    renameSync(raw, file)
  }
  return true
}

console.log('кредитов до:', await credits())
let ok = 0, fail = 0
for (let i = 0; i < todo.length; i += 3) {
  const batch = todo.slice(i, i + 3)
  const res = await Promise.all(batch.map(l => gen(l)))
  ok += res.filter(Boolean).length; fail += res.filter(x => !x).length
  process.stdout.write(`\r  готово ${ok} · ошибок ${fail} · осталось ${todo.length - i - batch.length}   `)
}
console.log()
console.log('кредитов после:', await credits())
const have = lines.filter(l => existsSync(resolve(OUT, `${l.id}.mp3`))).map(l => l.id)
writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(have))
console.log(`манифест: ${have.length} файлов`)
