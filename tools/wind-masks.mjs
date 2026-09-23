// Маски растительности для ветра в объёмных кадрах: SegFormer (ADE20K, ONNX) локально, без ключей и кредитов.
//   Один раз: npm i --no-save @huggingface/transformers sharp   (модель ~15 МБ скачается в .cache при первом запуске)
//   node tools/wind-masks.mjs ../red-thread-secret/<история>/art [--force] [--only l_kpp,l_turn] [--water l_yard,l_sana_bath] [--still l_quay]
//   → w_<кадр>.jpg (красное — ветки и кроны, зелёное — трава, синее — вода) для кадров, где растительности больше 0,2 % (клумба на площади — тоже); имена — в SoloStory.wind
// Шейдер по маске качает ветки и траву: верхушки сильнее, порывами, в грозу сильнее.
// Гладкое внутри «дерева» (знак на фоне ельника, стена) не качается: из маски убирается всё без мелкой фактуры.
import { pipeline, env } from '@huggingface/transformers'
import sharp from 'sharp'
import { readdirSync, existsSync, unlinkSync } from 'node:fs'
env.cacheDir = process.env.DEPTH_CACHE ?? '.cache/depth'
const dir = process.argv[2]
if (!dir) { console.error('укажите папку art истории'); process.exit(1) }
const onlyArg = process.argv.indexOf('--only')
// кадры мест, где по игре есть вода (затопленный пол, лужи, бассейн, озеро): сеть в темноте её не узнаёт — там вода
// ищется по кадру: горизонтальное (по карте глубины z_, как пол) и заметно темнее вокруг
const waterArg = process.argv.indexOf('--water')
const wetFrames = new Set(waterArg > 0 ? process.argv[waterArg + 1].split(',') : [])
// кадры, где маска ошибается и что-то твёрдое колыхалось бы (бетон набережной принят за траву): без ветра и ряби
const stillArg = process.argv.indexOf('--still')
const stillFrames = new Set(stillArg > 0 ? process.argv[stillArg + 1].split(',') : [])
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null
/** что качается ветром (классы ADE20K): ветки и кроны — плавно и широко, трава — мелко и часто */
const BRANCH = new Set(['tree', 'plant', 'palm'])
const GRASS = new Set(['grass', 'flower', 'field'])
const FOLIAGE = new Set([...BRANCH, ...GRASS])
const GROUND = new Set(['road', 'earth', 'grass', 'sidewalk', 'path', 'dirt track', 'field', 'sand', 'floor'])
const SOLID = new Set(['signboard', 'pole', 'streetlight', 'traffic light', 'fence', 'railing', 'car', 'truck', 'bus', 'booth', 'door', 'column', 'sculpture', 'statue', 'fountain', 'bench', 'hovel', 'tower', 'boat'])
/** Вода по кадру: горизонтальная поверхность (глубина растёт книзу — пол, дно, гладь) заметно темнее своего окружения
    (лужа, затопленный пол, бассейн, вода между мостками); светлый кафель и доски не проходят. 0…255 в размере w×h */
async function puddles(img, depth, w, h) {
  const S = 640, SH = Math.round(S * h / w)
  const lum = await sharp(img).resize(S, SH, { fit: 'fill' }).greyscale().blur(1.5).raw().toBuffer()
  const dep = await sharp(depth).resize(S, SH, { fit: 'fill' }).greyscale().blur(6).raw().toBuffer()
  const box = (a, r) => { const o = new Float32Array(S * SH), t = new Float32Array(S * SH), n = 2 * r + 1
    for (let y = 0; y < SH; y++) for (let x = 0; x < S; x++) { let v = 0; for (let k = -r; k <= r; k++) v += a[y * S + Math.min(S - 1, Math.max(0, x + k))]; t[y * S + x] = v / n }
    for (let y = 0; y < SH; y++) for (let x = 0; x < S; x++) { let v = 0; for (let k = -r; k <= r; k++) v += t[Math.min(SH - 1, Math.max(0, y + k)) * S + x]; o[y * S + x] = v / n }
    return o }
  const around = box(Float32Array.from(lum), 40)
  // фактура: доски, бетон, мох — рябые; гладь воды (и размытые отражения в ней) — гладкая
  const g = new Float32Array(S * SH)
  for (let y = 1; y < SH - 1; y++) for (let x = 1; x < S - 1; x++) { const i = y * S + x; g[i] = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + S] - lum[i - S]) }
  const tex = box(g, 3)
  const m = Buffer.alloc(S * SH)
  for (let y = 4; y < SH - 4; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x
    const flat = (dep[i + 4 * S] - dep[i - 4 * S]) / 8 > 0.35
    const dark = lum[i] < around[i] * 0.6
    const smooth = tex[i] < Number(process.env.WATER_TEX ?? 9)
    if (flat && dark && smooth && y > SH * 0.35) m[i] = 255
  }
  // только крупное: мелкие тёмные пятна (щели, тени) — не вода
  const open = await sharp(m, { raw: { width: S, height: SH, channels: 1 } }).blur(2).threshold(160).extractChannel(0).raw().toBuffer()
  return sharp(open, { raw: { width: S, height: SH, channels: 1 } }).resize(w, h, { fit: 'fill' }).extractChannel(0).raw().toBuffer()
}
/** Листва и хвоя по картинке: мелкая фактура во все стороны (структурный тензор: края без общего направления), не светлое
    (штукатурка, небо, туман); только крупными пятнами. 0/1 в размере w×h */
async function leafiness(img, w, h, { light = false, grass = false, big = false } = {}) {
  const S = 640, SH = Math.round(S * h / w)
  const lum = await sharp(img).resize(S, SH, { fit: 'fill' }).greyscale().raw().toBuffer()
  const L = Float32Array.from(lum, v => Math.sqrt(v / 255))
  const jxx = new Float32Array(S * SH), jyy = new Float32Array(S * SH), jxy = new Float32Array(S * SH)
  for (let y = 1; y < SH - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x, gx = (L[i + 1] - L[i - 1]) / 2, gy = (L[i + S] - L[i - S]) / 2
    jxx[i] = gx * gx; jyy[i] = gy * gy; jxy[i] = gx * gy
  }
  const box = (a, r) => { const o = new Float32Array(S * SH), t = new Float32Array(S * SH), n = 2 * r + 1
    for (let y = 0; y < SH; y++) for (let x = 0; x < S; x++) { let v = 0; for (let k = -r; k <= r; k++) v += a[y * S + Math.min(S - 1, Math.max(0, x + k))]; t[y * S + x] = v / n }
    for (let y = 0; y < SH; y++) for (let x = 0; x < S; x++) { let v = 0; for (let k = -r; k <= r; k++) v += t[Math.min(SH - 1, Math.max(0, y + k)) * S + x]; o[y * S + x] = v / n }
    return o }
  const a = box(jxx, 4), b = box(jyy, 4), c = box(jxy, 4)
  // и в крупном окне: у досок, брёвен, кровли и стен есть общее направление на десятки точек, у хвои — нет
  const A2 = box(jxx, 12), B2 = box(jyy, 12), C2 = box(jxy, 12)
  const k = new Float32Array(S * SH)
  for (let i = 0; i < k.length; i++) {
    const tr = a[i] + b[i], e = Math.sqrt(tr)
    const coh = tr > 1e-7 ? Math.sqrt((a[i] - b[i]) ** 2 + 4 * c[i] * c[i]) / tr : 1
    const t2 = A2[i] + B2[i], coh2 = t2 > 1e-7 ? Math.sqrt((A2[i] - B2[i]) ** 2 + 4 * C2[i] * C2[i]) / t2 : 1
    const sm = (v, lo, hi) => { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t) }
    k[i] = sm(e, 0.008, 0.022) * (1 - sm(coh, 0.3, 0.55)) * (1 - sm(coh2, 0.12, 0.28)) * (light ? 1 : 1 - sm(lum[i], 140, 175))
  }
  const soft = box(k, 6)
  const m = Buffer.alloc(S * SH)
  for (let i = 0; i < m.length; i++) m[i] = soft[i] > 0.4 ? 255 : 0
  // одиночные пятна (облупленная краска, трещины) — не лес: только куски от 0,4 % кадра
  const seen = new Uint8Array(S * SH), q = new Int32Array(S * SH), keep = Buffer.alloc(S * SH)
  for (let s0 = 0; s0 < m.length; s0++) {
    if (seen[s0] || !m[s0]) continue
    let hd = 0, tl = 0
    q[tl++] = s0; seen[s0] = 1
    while (hd < tl) { const i = q[hd++], x = i % S; for (const j of [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, i - S, i + S]) { if (j < 0 || j >= m.length || seen[j] || !m[j]) continue; seen[j] = 1; q[tl++] = j } }
    if (tl >= S * SH * (grass ? 0.0008 : big ? 0.015 : 0.004)) for (let t = 0; t < tl; t++) keep[q[t]] = 255
  }
  return sharp(keep, { raw: { width: S, height: SH, channels: 1 } }).resize(w, h, { fit: 'fill' }).extractChannel(0).raw().toBuffer()
}
/** серое (асфальт, бетон, штукатурка, туман): каналы почти равны */
const gray = (rgb, i) => { const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]; return Math.max(r, g, b) - Math.min(r, g, b) < 12 }
/** Расширить двоичную маску на r точек (квадрат): по строкам, потом по столбцам — расстояние до ближней единицы слева и справа */
function grow(m, W, H, r) {
  const pass = (n, len, at) => {
    const d = new Int32Array(len)
    for (let k = 0; k < n; k++) {
      let last = -1e9
      for (let j = 0; j < len; j++) { if (m[at(k, j)]) last = j; d[j] = j - last }
      last = 1e9
      for (let j = len - 1; j >= 0; j--) { if (m[at(k, j)]) last = j; if (Math.min(d[j], last - j) <= r) d[j] = -1 }
      for (let j = 0; j < len; j++) if (d[j] === -1) m[at(k, j)] = 1
    }
  }
  pass(H, W, (y, x) => y * W + x)
  pass(W, H, (x, y) => y * W + x)
}
/** 1 — прямые вытянутые края (столб, ствол): структурный тензор, края в одну сторону */
function straightEdges(lum, W, H) {
  const jxx = new Float32Array(W * H), jyy = new Float32Array(W * H), jxy = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, gx = (lum[i + 1] - lum[i - 1]) / 510, gy = (lum[i + W] - lum[i - W]) / 510
    jxx[i] = gx * gx; jyy[i] = gy * gy; jxy[i] = gx * gy
  }
  const box = (a, r) => { const o = new Float32Array(W * H), t = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let k = -r; k <= r; k++) v += a[y * W + Math.min(W - 1, Math.max(0, x + k))]; t[y * W + x] = v }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let k = -r; k <= r; k++) v += t[Math.min(H - 1, Math.max(0, y + k)) * W + x]; o[y * W + x] = v }
    return o }
  const a = box(jxx, 3), b = box(jyy, 3), c = box(jxy, 3)
  const out = new Float32Array(W * H)
  for (let i = 0; i < out.length; i++) {
    const tr = a[i] + b[i]
    const coh = tr > 1e-4 ? Math.sqrt((a[i] - b[i]) ** 2 + 4 * c[i] * c[i]) / tr : 0
    out[i] = Math.min(1, Math.max(0, (coh - 0.5) / 0.3))
  }
  return out
}
const W = 640

/** 1 — хвоя, листва, трава (мелкая фактура), 0 — гладкое: лицо знака, стена, туман. Яркость берётся под корнем, чтобы
    тёмный ельник считался фактурным наравне со светлым. Сглажено широко: маска плавная, без дыр — иначе у каждой дырки
    картинка рвалась бы, а стволы гнулись змейкой (крона качается целиком, ствол — вместе с ней) */
const E0 = Number(process.env.WIND_E0 ?? 0.003), E1 = Number(process.env.WIND_E1 ?? 0.016)
function textured(lum, W, H) {
  const L = Float32Array.from(lum, v => Math.sqrt(v / 255))
  const e = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    const gx = (L[i + 1] - L[i - 1]) / 2, gy = (L[i + W] - L[i - W]) / 2
    e[i] = gx * gx + gy * gy
  }
  const box = (a, r) => { const o = new Float32Array(W * H), t = new Float32Array(W * H), n = 2 * r + 1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let k = -r; k <= r; k++) v += a[y * W + Math.min(W - 1, Math.max(0, x + k))]; t[y * W + x] = v / n }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0; for (let k = -r; k <= r; k++) v += t[Math.min(H - 1, Math.max(0, y + k)) * W + x]; o[y * W + x] = v / n }
    return o }
  const en = box(e, 3)
  const k = new Float32Array(W * H)
  for (let i = 0; i < k.length; i++) { const t = Math.min(1, Math.max(0, (Math.sqrt(en[i]) - E0) / (E1 - E0))); k[i] = t * t * (3 - 2 * t) }
  return box(box(k, 6), 6)
}

const seg = await pipeline('image-segmentation', 'Xenova/segformer-b0-finetuned-ade-512-512')
const list = readdirSync(dir).filter(f => /^(l|o|x)_.*\.jpg$/.test(f) && (!only || only.has(f.slice(0, -4))))
const kept = []
for (const f of list) {
  const out = `${dir}/w_${f}`
  if (existsSync(out) && !process.argv.includes('--force') && !only) { kept.push(f.slice(0, -4)); continue }
  if (stillFrames.has(f.slice(0, -4))) { if (existsSync(out)) unlinkSync(out); continue }
  const parts = await seg(`${dir}/${f}`)
  const share = (label) => { const p = parts.find(q => q.label === label); if (!p) return 0; let n = 0; for (const v of p.mask.data) if (v > 127) n++; return n / p.mask.data.length }
  // в помещении ветра нет (цветок в горшке не качается): потолок или много пола и нет неба — помещение
  // (асфальт площади сеть тоже зовёт «полом», но над площадью небо)
  const indoor = (share('ceiling') > 0.02 || share('floor') > 0.08) && share('sky') < 0.03
  // вода (лужи, затопленный пол, бассейн) рябит и в помещении — синий канал маски
  const hits = indoor ? [] : parts.filter(p => FOLIAGE.has(p.label))
  // трава на земле: «земля», поле (пол и тротуар — асфальт, их не берём); что из этого трава, решает цвет и фактура ниже
  const soil = indoor ? [] : parts.filter(p => p.label === 'earth' || p.label === 'field')
  if (!hits.length && !soil.length && !wetFrames.has(f.slice(0, -4))) { if (existsSync(out)) unlinkSync(out); continue }
  const walls = parts.filter(p => p.label === 'wall' || p.label === 'building' || p.label === 'house')
  const { width, height } = parts[0].mask
  const br = new Uint8Array(width * height), gr = new Uint8Array(width * height)
  // «растение» сеть часто находит на стенах и крышах: берём, если оно не серое (дерево и трава — любые)
  const rgbAll = await sharp(`${dir}/${f}`).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer()
  for (const h of hits) {
    const m = h.mask.data, to = BRANCH.has(h.label) ? br : gr, picky = h.label !== 'tree' && h.label !== 'grass'
    for (let i = 0; i < to.length; i++) {
      if (m[i] <= to[i]) continue
      // «растение» на стене сеть находит серым — его не берём; осенняя трава и бурьян жёлто-бурые, зелёные — берём
      if (picky && gray(rgbAll, i)) continue
      to[i] = m[i]
    }
  }
  const H = Math.round(W * height / width)
  // линия земли: первая строка, где дорога, земля, трава, тротуар занимают больше пятой части ширины
  const ground = parts.filter(p => GROUND.has(p.label))
  let horizon = height
  for (let y = 0; y < height && horizon === height; y++) {
    let n = 0
    for (const g of ground) for (let x = 0; x < width; x++) if (g.mask.data[y * width + x] > 127) n++
    if (n > width * 0.2) horizon = y
  }
  // «растение» сеть находит и во мху на крышах и стенах будок, на вышках: такое берём только у земли (бурьян, кусты)
  for (const h of hits) if (h.label !== 'tree' && h.label !== 'grass') {
    const m = h.mask.data, to = BRANCH.has(h.label) ? br : gr
    const top = Math.max(0, horizon - Math.round(height * 0.06))
    for (let i = 0; i < top * width; i++) if (m[i] > 127) to[i] = 0
  }
  // «дерево» и «трава» от сети проверяются по самой картинке: сеть ставит «дерево» и на мох на стене, на прутья
  // турникета; хвоя и листва — фактура во все стороны (светлая хвоя в тумане тоже), стволы и прутья — прямые линии
  const leafyAny = await leafiness(`${dir}/${f}`, width, height, { light: true })
  for (let i = 0; i < br.length; i++) if (!leafyAny[i]) { br[i] = 0 }
  const grassy = await leafiness(`${dir}/${f}`, width, height, { light: true, grass: true })
  // столб, ствол, прут — прямые вытянутые края — не качаются ни с ветками, ни с травой (у травы порог мягче: стебли тоже
  // прямые, но идут вразнобой)
  const straight = straightEdges(await sharp(`${dir}/${f}`).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer(), width, height)
  // лес в тумане SegFormer b0 часто зовёт «стеной» и даже «зданием» (ельник за КПП, деревья на берегу): там, где сеть
  // видит стену или дом, ветки ищутся по самой картинке — мелкая фактура во все стороны (хвоя, листва), не светлое;
  // стены, доски, окна — прямые параллельные края или гладко, штукатурка светлая. Только выше земли
  if (walls.length && (hits.length || soil.length)) {
    // лес — большими пятнами (от 1,5 % кадра): потёки и мох на стене будки, прутья турникета — мелкие
    const leafy = await leafiness(`${dir}/${f}`, width, height, { big: true })
    const cand = new Uint8Array(width * height)
    for (const wpart of walls) {
      const m = wpart.mask.data
      for (let i = 0; i < cand.length; i++) if (m[i] > 127 && leafy[i] && Math.floor(i / width) <= horizon - height * 0.02) cand[i] = 1
    }
    // и только то, что уходит к небу (кроны на фоне неба, край кадра сверху): потёк на стене будки окружён стеной
    const sky = new Uint8Array(width * height)
    for (const q of parts.filter(p => p.label === 'sky')) { const m = q.mask.data; for (let i = 0; i < m.length; i++) if (m[i] > 127) sky[i] = 1 }
    for (let x = 0; x < width; x++) sky[x] = 1
    grow(sky, width, height, Math.round(width * 0.02))
    const seen = new Uint8Array(width * height), q = new Int32Array(width * height)
    for (let s0 = 0; s0 < cand.length; s0++) {
      if (!cand[s0] || seen[s0]) continue
      let hd = 0, tl = 0, up = false
      q[tl++] = s0; seen[s0] = 1
      while (hd < tl) {
        const i = q[hd++], x = i % width
        if (sky[i]) up = true
        for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) { if (j < 0 || j >= cand.length || seen[j] || !cand[j]) continue; seen[j] = 1; q[tl++] = j }
      }
      if (up) for (let t = 0; t < tl; t++) br[q[t]] = 255
    }
  }
  // обочины и клумбы сеть часто зовёт «землёй»: фактурная (проверка ниже, textured) зеленовато-жёлтая «земля» — трава;
  // голая земля и грязь рыжие, асфальт серый — не проходят
  if (soil.length) {
    const rgb = await sharp(`${dir}/${f}`).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer()
    for (const q of soil) {
      const m = q.mask.data
      for (let i = 0; i < gr.length; i++) {
        if (m[i] < 128) continue
        // трава: зелёная, жёлтая, соломенная (зелёный канал почти догоняет красный); грязь и глина — заметно рыжее;
        // асфальт и бетон — серые
        const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]
        if (grassy[i] && Math.max(r, g, b) - Math.min(r, g, b) >= 14 && g >= r * 0.82 && g > b + 6) gr[i] = Math.max(gr[i], m[i])
      }
    }
  }
  // и не рядом со знаками, столбами, домами: их край не должен качаться
  const solid = new Uint8Array(width * height)
  const R = Math.round(width * Number(process.env.SOLID_PAD ?? 0.012))
  for (const q of parts.filter(p => SOLID.has(p.label))) { const m = q.mask.data; for (let i = 0; i < m.length; i++) if (m[i] > 127) solid[i] = 1 }
  grow(solid, width, height, R)
  for (let i = 0; i < br.length; i++) if (solid[i]) { br[i] = 0; gr[i] = 0 }
  // знак стоит на столбе: под знаком до низа кадра (с запасом вбок — столб бывает наклонён) ничего не качается
  for (const q of parts.filter(p => p.label === 'signboard' || p.label === 'traffic light' || p.label === 'streetlight')) {
    const m = q.mask.data
    let x0 = width, x1 = -1, y0 = height
    for (let i = 0; i < m.length; i++) if (m[i] > 127) { const x = i % width, y = (i - x) / width; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y }
    if (x1 < 0) continue
    const pad = Math.round(width * 0.04)
    for (let y = Math.max(0, y0 - Math.round(height * 0.02)); y < height; y++) for (let x = Math.max(0, x0 - pad); x <= Math.min(width - 1, x1 + pad); x++) { br[y * width + x] = 0; gr[y * width + x] = 0 }
  }
  const wa = new Uint8Array(width * height)
  // метке «вода» сети не верим: мокрый асфальт, тропинку и туман над озером она тоже зовёт водой — рябь только там,
  // где вода есть по игре (--water), и только по кадру: горизонтальное, тёмное и гладкое
  if (wetFrames.has(f.slice(0, -4)) && existsSync(`${dir}/z_${f}`)) {
    const found = await puddles(`${dir}/${f}`, `${dir}/z_${f}`, width, height)
    for (let i = 0; i < wa.length; i++) if (found[i] > wa[i]) wa[i] = found[i]
  }
  // трава — только с фактурой травы: брёвна скамеек, доски, трещины асфальта (линии) не колышутся
  for (let i = 0; i < gr.length; i++) if (!grassy[i]) gr[i] = 0
  let on = 0, wet = 0
  for (let i = 0; i < br.length; i++) { if (br[i] > 127 || gr[i] > 127) on++; if (wa[i] > 127) wet++ }
  const min = Number(process.env.WIND_MIN ?? 0.002)
  if (on / br.length < min) { br.fill(0); gr.fill(0) }
  const cover = on / br.length, wcover = wet / br.length
  if (cover < min && wcover < 0.01) { if (existsSync(out)) unlinkSync(out); continue }
  for (let i = 0; i < br.length; i++) {
    br[i] = Math.round(br[i] * (1 - straight[i]))
    gr[i] = Math.round(gr[i] * (1 - Math.min(1, Math.max(0, straight[i] * 1.6 - 0.6))))
  }
  const mb = await sharp(Buffer.from(br), { raw: { width, height, channels: 1 } }).resize(W, H).extractChannel(0).raw().toBuffer()
  const mg = await sharp(Buffer.from(gr), { raw: { width, height, channels: 1 } }).resize(W, H).extractChannel(0).raw().toBuffer()
  const lum = await sharp(`${dir}/${f}`).resize(W, H).greyscale().raw().toBuffer()
  const keep = textured(lum, W, H)
  const rg = Buffer.alloc(W * H * 3)
  for (let i = 0; i < W * H; i++) { rg[i * 3] = Math.round(mb[i] * keep[i]); rg[i * 3 + 1] = Math.round(mg[i] * keep[i]) }
  // ветки и трава — с широким размытием: у неподвижного (знак, дом) ветви затихают плавно, без шва посреди кроны;
  // вода — с узким: сваи и ножки баков, стоящие в воде, не должны рябить вместе с ней
  const rgs = await sharp(rg, { raw: { width: W, height: H, channels: 3 } }).blur(5).raw().toBuffer()
  const ws = await sharp(Buffer.from(wa), { raw: { width, height, channels: 1 } }).resize(W, H).blur(1.5).extractChannel(0).raw().toBuffer()
  const px = Buffer.alloc(W * H * 3)
  for (let i = 0; i < W * H; i++) { px[i * 3] = rgs[i * 3]; px[i * 3 + 1] = rgs[i * 3 + 1]; px[i * 3 + 2] = ws[i] }
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(out)
  kept.push(f.slice(0, -4))
  console.log('  ✓', f, cover >= min ? `${Math.round(cover * 100)} %` : '', wcover >= 0.01 ? `вода ${Math.round(wcover * 100)} %` : '', [...hits, ...soil].map(h => h.label).join(', '))
}
console.log('для SoloStory.wind:', JSON.stringify(kept))
