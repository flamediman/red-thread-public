// Маски растительности для ветра в объёмных кадрах: SegFormer (ADE20K, ONNX) локально, без ключей и кредитов.
//   Один раз: npm i --no-save @huggingface/transformers sharp   (модель ~15 МБ скачается в .cache при первом запуске)
//   node tools/wind-masks.mjs ../red-thread-secret/<история>/art [--force] [--only l_kpp,l_turn] [--water l_yard,l_sana_bath]
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
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null
/** что качается ветром (классы ADE20K): ветки и кроны — плавно и широко, трава — мелко и часто */
const BRANCH = new Set(['tree', 'plant', 'palm'])
const GRASS = new Set(['grass', 'flower', 'field'])
const FOLIAGE = new Set([...BRANCH, ...GRASS])
/** вода: рябь (синий канал маски) */
const WATER = new Set(['water', 'sea', 'river', 'lake', 'swimming pool'])
const GROUND = new Set(['road', 'earth', 'grass', 'sidewalk', 'path', 'dirt track', 'field', 'sand', 'floor'])
const SOLID = new Set(['signboard', 'pole', 'streetlight', 'traffic light', 'building', 'house', 'fence', 'railing', 'car', 'truck', 'bus', 'booth', 'door', 'column', 'sculpture', 'statue', 'fountain', 'bench', 'hovel', 'tower', 'boat'])
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
const E0 = Number(process.env.WIND_E0 ?? 0.006), E1 = Number(process.env.WIND_E1 ?? 0.03)
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
  const parts = await seg(`${dir}/${f}`)
  const share = (label) => { const p = parts.find(q => q.label === label); if (!p) return 0; let n = 0; for (const v of p.mask.data) if (v > 127) n++; return n / p.mask.data.length }
  // в помещении ветра нет (цветок в горшке не качается): потолок или много пола и нет неба — помещение
  // (асфальт площади сеть тоже зовёт «полом», но над площадью небо)
  const indoor = (share('ceiling') > 0.02 || share('floor') > 0.08) && share('sky') < 0.03
  // вода (озеро, река, лужи, затопленный пол) рябит и в помещении — синий канал маски
  const water = parts.filter(p => WATER.has(p.label))
  const hits = indoor ? [] : parts.filter(p => FOLIAGE.has(p.label))
  // трава на земле: «земля», поле; на улице (есть небо) — и то, что сеть назвала полом или тротуаром (клумба на площади);
  // что из этого трава, решает цвет и фактура ниже
  const outdoorFloor = share('sky') >= 0.03 ? ['floor', 'sidewalk', 'path'] : []
  const soil = indoor ? [] : parts.filter(p => p.label === 'earth' || p.label === 'field' || outdoorFloor.includes(p.label))
  if (!hits.length && !soil.length && !water.length && !wetFrames.has(f.slice(0, -4))) { if (existsSync(out)) unlinkSync(out); continue }
  // тёмный ельник в тумане сеть нередко принимает за «стену»: в кадре, где лес уже есть, такая «стена» — тоже ветки,
  // если она фактурная и зелёно-серая (кирпич и доски рыжие, штукатурка гладкая — не проходят)
  const walls = parts.filter(p => p.label === 'wall')
  const { width, height } = parts[0].mask
  const br = new Uint8Array(width * height), gr = new Uint8Array(width * height)
  // «растение» сеть часто находит на стенах и крышах: его берём, только если оно зеленоватое (дерево — любое)
  const rgbAll = await sharp(`${dir}/${f}`).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer()
  for (const h of hits) {
    const m = h.mask.data, to = BRANCH.has(h.label) ? br : gr, picky = h.label !== 'tree' && h.label !== 'grass'
    for (let i = 0; i < to.length; i++) {
      if (m[i] <= to[i]) continue
      if (picky && !(rgbAll[i * 3 + 1] >= rgbAll[i * 3] && rgbAll[i * 3 + 1] > rgbAll[i * 3 + 2] + 10)) continue
      to[i] = m[i]
    }
  }
  const H = Math.round(W * height / width)
  // столб, ствол, прут — прямые вытянутые края — не качаются ни с ветками, ни с травой (у травы порог мягче: стебли тоже
  // прямые, но идут вразнобой)
  const straight = straightEdges(await sharp(`${dir}/${f}`).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer(), width, height)
  if (walls.length && hits.some(h => BRANCH.has(h.label))) {
    const rgb = await sharp(`${dir}/${f}`).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer()
    // только выше земли: линия, где начинаются дорога, земля, трава (дорогу сеть тоже зовёт «стеной»)
    const ground = parts.filter(p => GROUND.has(p.label))
    let horizon = height
    for (let y = 0; y < height && horizon === height; y++) {
      let n = 0
      for (const g of ground) for (let x = 0; x < width; x++) if (g.mask.data[y * width + x] > 127) n++
      if (n > width * 0.2) horizon = y
    }
    for (const wpart of walls) {
      const m = wpart.mask.data
      for (let i = 0; i < br.length; i++) {
        if (m[i] < 128 || Math.floor(i / width) > horizon - height * 0.03) continue
        const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]
        if (g >= r - 4 && Math.max(r, g, b) - Math.min(r, g, b) < 60) br[i] = Math.max(br[i], m[i])
      }
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
        const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]
        if (g >= r - 10 && g > b + 10) gr[i] = Math.max(gr[i], m[i])
      }
    }
  }
  // и не рядом со знаками, столбами, домами: их край не должен качаться
  const solid = new Uint8Array(width * height)
  const R = Math.round(width * 0.03)
  // среди домов «стена» — это дом (в лесу сеть зовёт стеной ельник — там её не трогаем)
  const town = share('building') + share('house') > 0.02
  for (const q of parts.filter(p => SOLID.has(p.label) || (town && p.label === 'wall'))) { const m = q.mask.data; for (let i = 0; i < m.length; i++) if (m[i] > 127) solid[i] = 1 }
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
  for (const q of water) { const m = q.mask.data; for (let i = 0; i < wa.length; i++) if (m[i] > wa[i]) wa[i] = m[i] }
  if (wetFrames.has(f.slice(0, -4)) && existsSync(`${dir}/z_${f}`)) {
    const found = await puddles(`${dir}/${f}`, `${dir}/z_${f}`, width, height)
    for (let i = 0; i < wa.length; i++) if (found[i] > wa[i]) wa[i] = found[i]
  }
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
