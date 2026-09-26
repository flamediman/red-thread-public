// Проверка музыки дела: не звучит ли дорожка как другой мир. 26.09.2026 новые боевые темы «Тумана» вышли электронными,
// с ровным битом, — в хорроре без барабанов это слышно как «музыка из Неона». Считает по каждой теме: ровность бита
// (автокорреляция всплесков спектра на шагах 0,3–1,2 с; у тем «Тумана» 0,16–0,48, у меню «Неона» 0,92), яркость и на тему
// меню какого мира тембр похож больше всего (профиль спектра по 20 полосам).
//   node tools/music-check.mjs <дело> [--only a,b]
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { musicDir } from './paths.mjs'

const SR = 22050, N = 2048, HOP = 1024
/** ровный бит: выше — пульс как у электроники (для миров без барабанов — чужое) */
const STEADY = 0.85

function decode(f) {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}
/** БПФ по месту (длина — степень двойки) */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr
      }
    }
  }
}
const edges = Array.from({ length: 21 }, (_, i) => 40 * Math.pow(10000 / 40, i / 20))

/** профиль спектра (дБ по полосам, от общей энергии), средняя яркость, ровность бита */
function feat(f) {
  const x = decode(f)
  const frames = Math.floor((x.length - N) / HOP)
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
  const prof = new Float64Array(20)
  const flux = []
  let cent = 0, cn = 0, prev = null
  const re = new Float64Array(N), im = new Float64Array(N)
  for (let fr = 0; fr < frames; fr += 2) {
    for (let i = 0; i < N; i++) { re[i] = x[fr * HOP + i] * win[i]; im[i] = 0 }
    fft(re, im)
    const mag = new Float64Array(N / 2)
    let s = 0, sc = 0
    for (let k = 1; k < N / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); s += mag[k]; sc += mag[k] * k * SR / N }
    if (s > 1e-3) { cent += sc / s; cn++ }
    for (let b = 0; b < 20; b++) {
      let e = 0
      for (let k = Math.floor(edges[b] * N / SR); k < Math.floor(edges[b + 1] * N / SR); k++) e += mag[k] ** 2
      prof[b] += e
    }
    let fl = 0
    if (prev) for (let k = 1; k < N / 2; k++) fl += Math.max(0, Math.log1p(mag[k]) - Math.log1p(prev[k]))
    flux.push(fl)
    prev = mag
  }
  const tot = prof.reduce((a, b) => a + b, 0)
  const p = Array.from(prof, v => 10 * Math.log10(v / tot + 1e-12))
  // ровность бита: максимум нормированной автокорреляции потока всплесков на сдвигах 0,3–1,2 с
  const m = flux.reduce((a, b) => a + b, 0) / flux.length
  const d = flux.map(v => v - m)
  const fps = SR / HOP / 2
  const r0 = d.reduce((a, v) => a + v * v, 0)
  let beat = 0
  for (let lag = Math.round(0.3 * fps); lag <= Math.round(1.2 * fps); lag++) {
    let r = 0
    for (let i = 0; i + lag < d.length; i++) r += d[i] * d[i + lag]
    beat = Math.max(beat, r / r0)
  }
  return { p, cent: cent / cn, beat }
}
const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length)

const CASE = process.argv[2]
if (!CASE) { console.error('node tools/music-check.mjs <дело> [--only a,b]'); process.exit(1) }
const onlyArg = process.argv.indexOf('--only')
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null
const root = resolve(import.meta.dirname, '..')
const menuDir = resolve(root, 'media/music/settings')
const menus = Object.fromEntries(readdirSync(menuDir).filter(f => f.endsWith('.mp3')).map(f => [f.replace('.mp3', ''), feat(resolve(menuDir, f))]))

let bad = 0
const dir = musicDir(CASE)
for (const f of readdirSync(dir).filter(n => n.endsWith('.mp3')).sort()) {
  const name = f.replace('.mp3', '')
  if (only && !only.has(name)) continue
  const v = feat(resolve(dir, f))
  const near = Object.entries(menus).map(([w, mm]) => [w, dist(v.p, mm.p)]).sort((a, b) => a[1] - b[1])
  const steady = v.beat > STEADY
  if (steady) bad++
  console.log(`${name.padEnd(16)} бит ${v.beat.toFixed(2)} · яркость ${String(Math.round(v.cent)).padStart(4)} Гц · тембр ближе к меню: ${near.map(([w, dd]) => `${w} ${dd.toFixed(1)}`).join(', ')}${steady ? '  ← ровный бит, как у электроники' : ''}`)
}
if (bad) { console.log(`\n${bad} с ровным битом — послушать и, если это не задумано, перегенерировать без ритма`); process.exitCode = 1 }
