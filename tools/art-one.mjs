// Одна иллюстрация через Pollinations (Flux): node tools/art-one.mjs <путь от корня, например media/art/settings/noir.jpg> <ширина> <высота> "<промпт>" [seed]
// Нижняя полоса с ватермаркой генератора срезается.
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const [out, w, h, prompt, seed = '11'] = process.argv.slice(2)
if (!out || !prompt) { console.error('usage: art-one.mjs <out> <w> <h> "<prompt>" [seed]'); process.exit(1) }
const root = resolve(import.meta.dirname, '..')
const file = resolve(root, out)
mkdirSync(dirname(file), { recursive: true })
const H = Math.round(Number(h) * 1.08)
const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${H}&model=flux&nologo=true&seed=${seed}`
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(180000) })
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) throw new Error(String(r.status))
    const tmp = file + '.tmp.jpg'
    writeFileSync(tmp, Buffer.from(await r.arrayBuffer()))
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-vf', `crop=iw:ih*0.925:0:0,scale=${w}:-2`, '-q:v', '3', file])
    unlinkSync(tmp)
    console.log('ok', out)
    process.exit(0)
  } catch (e) {
    console.log(`  попытка ${attempt}: ${e.message}`)
    await new Promise(r => setTimeout(r, 6000 * attempt))
  }
}
process.exit(1)
