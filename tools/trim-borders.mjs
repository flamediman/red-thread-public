// Срезает белую «фотографическую» рамку, которую генератор иногда рисует вокруг кадра.
//   node tools/trim-borders.mjs ../red-thread-secret/<дело>/art [--dry]
// Ищет почти белые поля по краям (ffmpeg negate + cropdetect), обрезает их с запасом и возвращает кадру прежний размер.
import { readdirSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const dir = resolve(process.argv[2] ?? '.')
const dry = process.argv.includes('--dry')
const size = f => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number)

for (const name of readdirSync(dir).filter(n => n.endsWith('.jpg'))) {
  const file = join(dir, name)
  const [W, H] = size(file)
  // почти белое (≥ 236) после инверсии становится почти чёрным (≤ 19) — это и ищет cropdetect
  const out = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'negate,cropdetect=limit=20:round=2:reset=0:skip=0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  const m = [...out.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop()
  if (!m) continue
  const [cw, ch, cx, cy] = m.slice(1).map(Number)
  const cut = { l: cx, t: cy, r: W - cx - cw, b: H - cy - ch }
  if (Math.max(cut.l, cut.t, cut.r, cut.b) < 6) continue
  // срезать больше четверти кадра — это уже не рамка, а светлое небо; не трогаем
  if (cw < W * 0.75 || ch < H * 0.75) { console.log(`  ? ${name}: подозрительно много (${JSON.stringify(cut)}) — пропуск`); continue }
  console.log(`  ✂ ${name}: слева ${cut.l}, сверху ${cut.t}, справа ${cut.r}, снизу ${cut.b}`)
  if (dry) continue
  const pad = 6
  const tmp = file + '.tmp.jpg'
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf',
    `crop=${cw - pad * 2}:${ch - pad * 2}:${cx + pad}:${cy + pad},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`, '-q:v', '2', tmp])
  renameSync(tmp, file)
}
