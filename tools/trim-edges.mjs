// Мягкие рамки генератора, которые не ловит trim-borders.mjs: ровная полоса у края, резко отличающаяся по яркости от кадра
// (белая, серая или тёмная, с размытым переходом). Без флага только печатает, --fix обрезает и возвращает прежний размер.
//   node tools/trim-edges.mjs ../red-thread-secret/<дело>/art [--fix]
// Перед --fix посмотрите края глазами: светлый туман или тёмная стена у самого края иногда похожи на рамку.
import { execFileSync } from 'node:child_process'
import { readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
const dir = process.argv[2], fix = process.argv.includes('--fix')
const size = f => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number)
const profile = (f, vertical) => [...execFileSync('ffmpeg', ['-loglevel', 'error', '-i', f, '-vf', vertical ? 'scale=1:ih:flags=area' : 'scale=iw:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])]
function band(p) {
  // p — значения от края внутрь; ищем резкий скачок в первых 70 px, снаружи — ровная полоса
  let best = 0, at = -1
  for (let i = 1; i < Math.min(70, p.length - 5); i++) {
    const outside = p.slice(0, i), inside = p.slice(i, i + 5)
    const mo = outside.reduce((a, b) => a + b, 0) / outside.length
    const mi = inside.reduce((a, b) => a + b, 0) / inside.length
    const spread = Math.max(...outside) - Math.min(...outside)
    const jump = Math.abs(mo - mi)
    if (jump > 45 && spread < 30 && jump > best) { best = jump; at = i }
  }
  return at > 0 ? at + 2 : 0
}
for (const name of readdirSync(dir).filter(n => n.endsWith('.jpg'))) {
  const f = join(dir, name)
  const [W, H] = size(f)
  const cols = profile(f, false), rows = profile(f, true)
  const cut = { l: band(cols), r: band([...cols].reverse()), t: band(rows), b: band([...rows].reverse()) }
  if (!cut.l && !cut.r && !cut.t && !cut.b) continue
  console.log(name, JSON.stringify(cut))
  if (!fix) continue
  const tmp = f.replace(/\.jpg$/, '.edge.jpg')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-vf', `crop=${W - cut.l - cut.r}:${H - cut.t - cut.b}:${cut.l}:${cut.t},scale=${W}:${H}:flags=lanczos`, '-q:v', '2', tmp])
  renameSync(tmp, f)
}
