// Точки петли для музыки: темы — законченные пьесы (вступление из тишины, в конце затухание), и петля «конец → начало»
// давала провал в тишину на несколько секунд и резкий вход первой доли. Здесь для каждой темы ищутся две точки внутри
// тела пьесы — a после вступления, b перед затуханием, — где музыка звучит одинаково: та же гармония (хрома), тот же
// спектр и громкость, та же фаза ритма. Игра проигрывает вступление один раз, дальше крутит [a, b] с короткой склейкой.
//   node tools/music-loops.mjs <папка с mp3> [--only town,title]   → <папка>/loops.json { "<тема>": { "a": с, "b": с } }
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, basename } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('node tools/music-loops.mjs <папка с mp3>'); process.exit(1) }
const onlyArg = process.argv.indexOf('--only')
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null
const SR = 22050, N = 4096, HOP = 1024, FS = SR / HOP // кадров в секунду
/** короче — не петля, а дребезг: пусть лучше играет целиком со старой склейкой */
const MIN_BODY = 30

function decode(file, sr) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
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
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr
      }
    }
  }
}

/** по кадрам: хрома (12), полосы спектра в дБ (16), громкость и всплеск (новое в спектре — доли) */
function features(x) {
  const frames = Math.floor((x.length - N) / HOP)
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
  const chroma = [], bands = [], rms = new Float32Array(frames), flux = new Float32Array(frames)
  const edges = Array.from({ length: 17 }, (_, i) => 60 * Math.pow(8000 / 60, i / 16))
  let prev = null
  const re = new Float64Array(N), im = new Float64Array(N)
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let i = 0; i < N; i++) { const v = x[f * HOP + i]; re[i] = v * win[i]; im[i] = 0; e += v * v }
    rms[f] = 10 * Math.log10(e / N + 1e-12)
    fft(re, im)
    const mag = new Float32Array(N / 2)
    for (let k = 1; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k])
    const ch = new Float32Array(12), bd = new Float32Array(16)
    for (let k = 1; k < N / 2; k++) {
      const hz = k * SR / N
      if (hz >= 55 && hz <= 5000) { const pc = ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12; ch[pc] += mag[k] }
      for (let b = 0; b < 16; b++) if (hz >= edges[b] && hz < edges[b + 1]) { bd[b] += mag[k] * mag[k]; break }
    }
    const cn = Math.hypot(...ch) + 1e-9
    chroma.push(ch.map(v => v / cn))
    bands.push(bd.map(v => 10 * Math.log10(v + 1e-12)))
    if (prev) { let s = 0; for (let k = 1; k < N / 2; k++) { const d = mag[k] - prev[k]; if (d > 0) s += d } flux[f] = s }
    prev = mag
  }
  return { frames, chroma, bands, rms, flux }
}

/** насколько похожа музыка после кадра i и после кадра j (и чуть до них): меньше — лучше */
function cost(F, i, j, after, before) {
  let s = 0, n = 0
  for (let w = -before; w < after; w += 2) {
    const a = i + w, b = j + w
    let dc = 0; for (let k = 0; k < 12; k++) dc += (F.chroma[a][k] - F.chroma[b][k]) ** 2
    let db = 0; for (let k = 0; k < 16; k++) db += Math.abs(F.bands[a][k] - F.bands[b][k])
    s += 4 * Math.sqrt(dc) + db / 16 / 6 + Math.abs(F.rms[a] - F.rms[b]) / 6
    n++
  }
  return s / n
}

function norm(v) { const m = v.reduce((s, q) => s + q, 0) / v.length; const d = Math.sqrt(v.reduce((s, q) => s + (q - m) ** 2, 0)) + 1e-9; return v.map(q => (q - m) / d) }

function findLoop(file) {
  const x = decode(file, SR)
  const F = features(x)
  const T = F.frames
  // тело пьесы: громкость, сглаженная по 2 с, не ниже медианы − 10 дБ
  const med = [...F.rms].sort((a, b) => a - b)[Math.floor(T / 2)]
  const W = Math.round(FS)
  const sm = Array.from(F.rms, (_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - W); k < Math.min(T, i + W); k++) { s += F.rms[k]; n++ } return s / n })
  let intro = 0; while (intro < T && sm[intro] < med - 10) intro++
  let outro = T - 1; while (outro > 0 && sm[outro] < med - 10) outro--
  const after = Math.round(3 * FS), before = Math.round(1.5 * FS)
  const aMin = intro + Math.round(1 * FS) + before, aMax = Math.round(intro + (outro - intro) * 0.45)
  const bMax = outro - after - Math.round(2.5 * FS)
  const minLen = Math.max(MIN_BODY * FS, (outro - intro) * 0.45)
  if ((bMax - aMin) / FS < MIN_BODY) return null
  // грубо — шагом 4 кадра, потом точнее вокруг лучшей пары
  let best = { c: 1e9, a: 0, b: 0 }
  for (let a = aMin; a <= aMax; a += 4) for (let b = Math.round(a + minLen); b <= bMax; b += 4) {
    const c = cost(F, a, b, after, before)
    if (c < best.c) best = { c, a, b }
  }
  if (!best.b) return null
  for (let a = best.a - 4; a <= best.a + 4; a++) for (let b = best.b - 4; b <= best.b + 4; b++) {
    if (a < aMin || b > bMax) continue
    const c = cost(F, a, b, after, before)
    if (c < best.c) best = { c, a, b }
  }
  // фаза ритма: сдвиг b до ±0,35 с, при котором доли после a и после b совпадают
  const on = F.flux
  const seg = (i) => norm(Array.from({ length: Math.round(4 * FS) }, (_, k) => on[i + k] ?? 0))
  const ea = seg(best.a)
  let bestShift = 0, bestCorr = -1e9
  for (let d = -8; d <= 8; d++) {
    if (best.b + d > bMax) continue
    const eb = seg(best.b + d); let r = 0; for (let k = 0; k < ea.length; k++) r += ea[k] * eb[k]
    if (r > bestCorr) { bestCorr = r; bestShift = d }
  }
  let aSec = best.a * HOP / SR, bSec = (best.b + bestShift) * HOP / SR
  // до выборки: волна в точке b продолжает волну в точке a (±12 мс, по 44,1 кГц) — без щелчка на склейке
  const X = decode(file, 44100), R = 44100, L = Math.round(0.03 * R)
  const ia = Math.round(aSec * R), ib = Math.round(bSec * R)
  let lag = 0, bestR = -1e9
  for (let d = -Math.round(0.012 * R); d <= Math.round(0.012 * R); d++) {
    let r = 0, na = 0, nb = 0
    for (let k = -L; k < L; k++) { const p = X[ia + k], q = X[ib + d + k]; r += p * q; na += p * p; nb += q * q }
    r /= Math.sqrt(na * nb) + 1e-12
    if (r > bestR) { bestR = r; lag = d }
  }
  bSec = (ib + lag) / R
  return { a: +aSec.toFixed(4), b: +bSec.toFixed(4), score: +best.c.toFixed(3), beat: +bestCorr.toFixed(2), wave: +bestR.toFixed(2), intro: +(intro / FS).toFixed(1), outro: +(outro / FS).toFixed(1), len: +(x.length / SR).toFixed(1) }
}

const out = resolve(dir, 'loops.json')
const loops = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {}
for (const f of readdirSync(dir).filter(n => n.endsWith('.mp3')).sort()) {
  const name = basename(f, '.mp3')
  if (only && !only.has(name)) continue
  const r = findLoop(resolve(dir, f))
  if (!r) { delete loops[name]; console.log(`  – ${name}: тело короче ${MIN_BODY} с — играет целиком`); continue }
  loops[name] = { a: r.a, b: r.b }
  console.log(`  ✓ ${name} (${r.len} с, тело ${r.intro}–${r.outro}): петля ${r.a.toFixed(2)} → ${r.b.toFixed(2)} с, непохожесть ${r.score}, доли ${r.beat}, волна ${r.wave}`)
}
writeFileSync(out, JSON.stringify(loops, null, 1) + '\n')
