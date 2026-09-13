// Музыкальные темы через ElevenLabs Music → cases/<дело>/music/<тема>.mp3 (готовые пропускает).
//   CASE=<дело> node tools/music.mjs [--only a,b]
// Промпты — cases/<дело>/prompts/music.mjs: одинаковые имена тем, разное звучание.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { musicDir, loadMusicSet } from './paths.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(readFileSync(resolve(root, '.env'), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const KEY = env.ELEVENLABS_API_KEY
const CASE = process.env.CASE || 'meridian'
const args = process.argv.slice(2)
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null
const OUT = musicDir(CASE); mkdirSync(OUT, { recursive: true })

const { THEMES } = await loadMusicSet(CASE).catch(() => ({}))
if (!THEMES) { console.error(`нет cases/${CASE}/prompts/music.mjs`); process.exit(1) }
const credits = async () => { try { return (await (await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': KEY } })).json()).character_count } catch { return '?' } }
console.log('кредитов до:', await credits())
for (const [name, [prompt, ms]] of Object.entries(THEMES)) {
  if (only && !only.has(name)) continue
  const file = resolve(OUT, `${name}.mp3`)
  if (existsSync(file)) { console.log(`  = ${name} уже есть`); continue }
  let r
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
        method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, music_length_ms: ms })
      })
      if (r.status !== 429 && r.status < 500) break
    } catch (e) { console.log(`  … ${name}: ${e.cause?.code ?? e.message}, повтор`) }
    await new Promise(res => setTimeout(res, 8000 * attempt))
  }
  if (!r?.ok) { console.log(`  ✗ ${name}: ${r?.status} ${r ? (await r.text()).slice(0, 160) : 'сеть'}`); continue }
  writeFileSync(file, Buffer.from(await r.arrayBuffer()))
  console.log(`  ✓ ${name} (${ms / 1000} с) · кредитов: ${await credits()}`)
}
await new Promise(r => setTimeout(r, 5000))
console.log('кредитов после:', await credits())
