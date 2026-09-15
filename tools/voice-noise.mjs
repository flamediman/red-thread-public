// Шумовой пол озвучки: у чистой записи самые тихие окна тише −75 дБ, у грязной — ровное шипение или гул.
//   node tools/voice-noise.mjs ../red-thread-secret/<дело>/voice [--all]
// Меряет RMS окнами по 50 мс и берёт 1-й процентиль (самые тихие окна). 5-й процентиль для коротких реплик врёт:
// туда попадают вдохи и хвосты слов, а не пол записи. Шум у eleven_v3 бывает от дубля к дублю, не только от голоса:
// один и тот же голос даёт −88 в одной реплике и −58 в другой — такие реплики перегенерировать (`--only id --force`).
// Печатает файлы громче порога; с --all — все.
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = resolve(process.argv[2] ?? '.')
const all = process.argv.includes('--all')
const LIMIT = -75

function floor(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'asetnsamples=2205,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const vals = [...r.stdout.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map(m => m[1] === '-inf' ? -120 : Number(m[1])).filter(Number.isFinite).sort((a, b) => a - b)
  if (!vals.length) return null
  return vals[Math.floor((vals.length - 1) * 0.01)]
}

const files = readdirSync(dir).filter(n => n.endsWith('.mp3')).sort()
const bad = []
for (const name of files) {
  const f = floor(join(dir, name))
  if (f == null) continue
  if (f > LIMIT) bad.push([name, f])
  if (all) console.log(`${f.toFixed(1).padStart(7)} дБ  ${name}`)
}
if (!all) for (const [name, f] of bad) console.log(`  ! ${name}: пол ${f.toFixed(1)} дБ`)
console.log(`файлов ${files.length}, шумных (пол выше ${LIMIT} дБ): ${bad.length}${bad.length ? ' — перегенерировать: --only ' + bad.map(([n]) => n.replace(/\.mp3$/, '')).join(',') + ' --force' : ''}`)
