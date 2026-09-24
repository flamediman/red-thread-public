<script setup lang="ts">
/* Кадр места — живой картиной. Картинка остаётся как нарисована: ничего не сдвигается относительно друг друга, весь
   кадр только медленно «дышит» наплывом (поворот камеры по карте глубины из одной картинки давал изгибы или картон).
   Объём даёт свет и воздух, посчитанные по карте глубины z_<кадр>.jpg (светлое — ближе): туман в несколько слоёв
   плывёт между ближним и дальним, фонарь ложится по стенам и полу, лампы светят лучами в тумане, мокрое и вода
   отражают, дождь, пыль и листья летят на разной глубине и прячутся за предметами, по небу идут облака, ветки и
   трава качаются (маска ветра w_), вода рябит. Всё — один проход по экрану.
   Не вышло (нет WebGL, не загрузилось) — событие fail, страница вернёт обычную картинку. */
const props = defineProps<{ src: string; depth: string; mode: 'none' | 'torch' | 'black'; lx: number; ly: number; weak?: boolean; focus?: string; rain?: number; fog?: number; other?: boolean; flash?: number; lights?: { x: number; y: number; r?: number; color?: string; flicker?: boolean }[]; motion?: 'calm' | 'run' | 'breath'; surface?: string; wind?: string; mat?: string; windy?: number; leaves?: number; power?: number; beam?: number; outdoor?: boolean; grade?: [number, number, number] }>()
const emit = defineEmits<{ fail: []; ready: [] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
/* кадр проявляется, когда нарисован первый раз: без чёрной вспышки на переходе */
const ready = ref(false)
/* телефон и планшет — меньше пикселей: шейдер тяжёлый */
const dprCap = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 1.25 : 2
/* Автокачество: шейдер меряет, успевает ли устройство за своим темпом (30 кадров в секунду в покое, 60 при движении).
   Отстаёт больше чем в полтора раза два окна подряд — ступень ниже: меньше пикселей, без бикубики, затенения углов
   и лишних слоёв. Идёт почти вровень — ступень выше. Первые секунды после появления и после смены кадра не
   считаются: загрузка картинок и сборка шейдера медленные всегда */
const QKEY = 'rn:depth-q3'
const SCALE = [1, 0.75, 0.55]
let level = 0
try { level = Math.min(2, Math.max(0, Number(localStorage.getItem(QKEY)) || 0)) } catch { /* приватный режим */ }
if (level === 0 && typeof navigator !== 'undefined' && ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 2) level = 1
let lastMs = 0, acc = 0, samples = 0, slow = 0, quietUntil = 0
function measure(ms: number, expected: number) {
  const dt = lastMs ? ms - lastMs : 0
  lastMs = ms
  if (!quietUntil) quietUntil = ms + 3000
  if (ms < quietUntil || dt <= 0 || dt > 250) return
  acc += dt / expected; samples++
  if (samples < 60) return
  const lag = acc / samples
  acc = 0; samples = 0
  if (lag > 1.6) slow++; else slow = 0
  let next = level
  if (slow >= 2 && level < 2) { next = level + 1; slow = 0 }
  else if (lag < 1.15 && level > 0) next = level - 1
  if (next !== level) { level = next; quietUntil = ms + 2000; try { localStorage.setItem(QKEY, String(level)) } catch { /* приватный режим */ } }
}
let born = 0

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`
const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 color;
uniform sampler2D img; uniform sampler2D dep;
uniform vec2 cover; uniform vec2 shift; uniform vec2 torch;
uniform float mode; uniform float t; uniform float power; uniform float beamR; uniform vec2 texel;
uniform float rain; uniform float fogAmt; uniform float other; uniform float flash;
uniform vec4 lamp[4]; uniform vec3 lampCol[4]; uniform int lampN; uniform float quality;
uniform sampler2D prev; uniform float fade; uniform vec2 view; uniform float glossy; uniform float wet;
uniform sampler2D windTex; uniform float windOn; uniform float windAmt; uniform float leaves; uniform vec4 leafP[7]; uniform vec4 leafQ[7]; uniform int leafN; uniform vec2 imgSize;
uniform float breath; uniform vec2 sun; uniform float sunOn; uniform float indoor; uniform vec3 fogTint; uniform sampler2D matTex; uniform float matOn; uniform sampler2D noiseTex; uniform vec3 grade; uniform vec4 tint;
float depthAt(vec2 q) { return textureLod(dep, q, 0.0).r; }
float hAt(vec2 q, float lod) { return textureLod(dep, q, lod).r; }
vec2 toTex(vec2 s) { return shift + (s - 0.5) * cover + 0.5; }
// Случайное без синусов: синус на видеокарте дорогой, а туман, листья и трава брали их сотню на точку — клочья тумана
// одни стоили больше, чем вся картинка. Шум — из таблицы 256×256, где в каждой клетке сразу четыре её угла (одна
// выборка вместо четырёх синусов); одиночные случайные числа — арифметикой (хэш Хоскинса)
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  vec4 c = texelFetch(noiseTex, ivec2(i) & 255, 0);
  return mix(mix(c.r, c.g, u.x), mix(c.b, c.a, u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
// Бикубическая выборка (Кэтмелл — Ром, пять выборок): кадр немного растянут под окно, и билинейная выборка его мылит
vec3 sharpAt(vec2 uv) {
  vec2 sp = uv * imgSize, p1 = floor(sp - 0.5) + 0.5, f = sp - p1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, p0 = (p1 - 1.0) / imgSize, p3 = (p1 + 2.0) / imgSize, p12 = (p1 + w2 / w12) / imgSize;
  vec3 c = textureLod(img, vec2(p12.x, p0.y), 0.0).rgb * w12.x * w0.y + textureLod(img, vec2(p0.x, p12.y), 0.0).rgb * w0.x * w12.y
    + textureLod(img, p12, 0.0).rgb * w12.x * w12.y + textureLod(img, vec2(p3.x, p12.y), 0.0).rgb * w3.x * w12.y + textureLod(img, vec2(p12.x, p3.y), 0.0).rgb * w12.x * w3.y;
  return max(c / (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y), 0.0);
}
void main() {
  vec2 o = toTex(uv);
  // координаты сцены — точка самой картинки (ширина в долях её высоты): всё, что живёт поверх картинки (трава, дождь,
  // листья, пыль, туман), считается в них — кадр «дышит», а они остаются на своих местах картинки, не скользят по ней
  vec2 sv = vec2(o.x * imgSize.x / imgSize.y, o.y);
  // уровень детализации — по тому, насколько картинка на экране мельче своего размера (как в играх): тонкие прутья
  // и провода вдали не мерцают при движении. Картинка крупнее экрана — бикубика, резко
  vec2 gdx = dFdx(o) * imgSize, gdy = dFdy(o) * imgSize;
  float lod = clamp(0.5 * log2(max(max(dot(gdx, gdx), dot(gdy, gdy)), 1e-6)), 0.0, 2.0);
  vec3 albedo = quality > 0.5 && lod < 0.3 ? sharpAt(o) : textureLod(img, o, lod).rgb;
  // Трава на ветру — своими травинками поверх картинки (сама картинка не гнётся): там, где на ней трава (маска w_,
  // зелёное), растут тонкие травинки и гнутся порывами. Цвет каждая берёт с картинки у своего корня, поэтому сливается
  // с нарисованной травой. Вдали травинки мельче, по три яруса глубины; растут из своей точки картинки. Кроны не
  // трогаем: свои веточки поверх нарисованных читались чужими
  if (windOn > 0.5) {
    float dsw = textureLod(dep, o, 3.0).r;
    vec2 P = sv;
    float aa = fwidth(P.x);
    float gust = 0.4 + 0.6 * smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(t * 0.45 - o.x * 3.0) * sin(t * 0.19 + 1.3));
    // трава
    vec2 gmask = vec2(textureLod(windTex, o, 1.5).g, textureLod(windTex, o + vec2(0.0, 0.03), 1.5).g);
    if (max(gmask.x, gmask.y) > 0.08) for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float band = k == 0 ? smoothstep(0.55, 0.7, dsw) : k == 1 ? smoothstep(0.3, 0.42, dsw) * (1.0 - smoothstep(0.6, 0.72, dsw)) : 1.0 - smoothstep(0.32, 0.45, dsw);
      if (band < 0.01) continue;
      float cs = k == 0 ? 0.016 : k == 1 ? 0.009 : 0.005;
      vec2 cell = floor(P / cs);
      for (int j = 0; j < 4; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        float hr = hash(c + fk * 17.0);
        if (hr > 0.7) continue;
        vec2 root = (c + vec2(hash(c + 1.3), hash(c + 2.7))) * cs;
        float Hh = cs * (1.6 + 1.8 * hash(c + 3.9));
        float sl = (root.y - P.y) / Hh;
        if (sl < 0.0 || sl > 1.0) continue;
        vec2 ro = vec2(root.x * imgSize.y / imgSize.x, root.y);
        if (textureLod(windTex, ro, 0.0).g < 0.35) continue;
        // что стоит ближе корня травинки (бревно, столб), травинку закрывает
        if (dsw > textureLod(dep, ro, 2.0).r + 0.025) continue;
        float ph = hash(c + 6.1) * 6.28 + noise(root * 9.0) * 3.0;
        // ветерок есть всегда (трава чуть покачивается и в штиль), порывы и буря — сильнее
        float breeze = (0.55 + 0.45 * gust) * (0.7 + 0.5 * windAmt);
        float sway = ((sin(t * 1.6 + ph) + 0.5 * sin(t * 2.7 + ph * 1.7)) * 0.3 + 0.08 * sin(t * 5.3 + ph * 2.3)) * cs * breeze;
        float bend = (hash(c + 4.4) - 0.5) * 0.9 * cs;
        float B = bend + sway;
        float xs = root.x + B * sl * sl;
        // расстояние до оси травинки — поперёк неё (у наклонной части горизонтальное давало лесенку); тоньше точки —
        // не резкая линия, а бледнее; корень и кончик растворяются, а не обрезаны
        float slope = 2.0 * B * sl / Hh;
        float dd = abs(P.x - xs) / sqrt(1.0 + slope * slope);
        float w = cs * 0.07 * (1.0 - sl * 0.85);
        float we = max(w, aa * 0.5);
        float a = clamp((we - dd) / aa + 0.5, 0.0, 1.0) * min(1.0, w / (aa * 0.5))
          * smoothstep(0.0, aa / Hh + 0.02, sl) * (1.0 - smoothstep(0.9, 1.0, sl));
        if (a < 0.01) continue;
        vec3 bc = textureLod(img, ro, 1.0).rgb * (0.7 + 0.55 * sl) * (0.85 + 0.3 * hash(c + 5.5));
        albedo = mix(albedo, bc, a * 0.85 * band);
      }
    }
  }
  // поверхности (g_): красное — стекло и кафель, зелёное — гладкий пол (синее — осколки — не используется: искры
  // по всему полу читались соринками на экране)
  vec3 mt = matOn > 0.5 ? textureLod(matTex, o, 0.0).rgb : vec3(0.0);
  // резкая глубина — для того, что прячется за предметами (дождь, пыль, листья)
  float d = hAt(o, 0.0);
  // Туман, свет, затенение углов считаются по сглаженной глубине (уровни мип-карты): резкий край глубины никогда не
  // совпадает с краем предмета на картинке, и всё, что по нему посчитано, обводит предмет светлой или тёмной каймой
  float ds0 = hAt(o, 3.0);
  // У края предмета сглаженная глубина — смесь ближнего и дальнего: туман, свет фонаря и луч по ней рисовали кайму —
  // на ближнем светлый ореол, на дальнем тёмную полосу у силуэта. У края берём почти резкую глубину
  float d1 = textureLod(dep, o, 1.0).r;
  float edgeK = smoothstep(0.012, 0.05, abs(d1 - ds0));
  float ds = mix(ds0, d1, edgeK);
  float dF = ds;
  vec2 st = texel * 4.0;
  float dx = hAt(o + vec2(st.x, 0.0), 2.0) - hAt(o - vec2(st.x, 0.0), 2.0);
  float dy = hAt(o + vec2(0.0, st.y), 2.0) - hAt(o - vec2(0.0, st.y), 2.0);
  vec3 n = normalize(vec3(-dx * 2.5, dy * 2.5, 1.0));
  // затенение в углах и щелях — по сглаженной глубине и только для небольших перепадов (настоящие углы)
  // Плавно, без порогов: жёсткий порог перепада давал линию на одном и том же расстоянии от каждого края (контуры).
  // На светлых кадрах тени уже нарисованы в картинке — там затенения нет, только в темноте под фонарём
  float occ = 0.0;
  if (quality > 0.5 && mode > 0.5) for (int k = 0; k < 6; k++) { float a = float(k) * 1.047; vec2 off = vec2(cos(a), sin(a)) * texel * 5.0; float df = hAt(o + off, 2.0) - ds0; occ += df * smoothstep(0.0, 0.03, df) * (1.0 - smoothstep(0.05, 0.14, df)); }
  float ao = clamp(1.0 - occ * 2.5, 0.6, 1.0);
  // мокро: дождь темнит поверхности
  albedo *= mix(1.0, 0.86, rain);
  vec2 sc = uv * vec2(1.6, 1.0);
  // туман по сглаженной глубине: дальнее тонет, туман медленно плывёт; на изнанке — ржавый
  // гроза: тяжёлое небо — кадр и туман темнеют, чтобы вспышке было куда светлеть
  float storm = smoothstep(0.75, 1.0, rain);
  // цвет тумана — с самой картинки (светлый дальний план: розоватая дымка у КПП, голубая в дождь), иначе мой туман
  // серил нарисованный; на изнанке — ржавый
  vec3 fogCol = mix(fogTint, vec3(0.42, 0.28, 0.22), other) * mix(1.0, 0.62, storm);
  float drift = fbm(vec2(sv.x * 2.2 + t * 0.035 + (1.0 - ds) * 1.5, sv.y * 1.6 - t * 0.012));
  // картинки уже нарисованы в тумане: свой туман шейдера лёгкий, только оживляет нарисованный
  float fogF = fogAmt * 0.4 * pow(1.0 - dF, 1.25) * (0.55 + 0.8 * drift);
  // гладкость для отражений (стекло, металл, кафель, лак, мокрое) — по размытой картинке: светлое и бесцветное.
  // Размытая — чтобы блестели поверхности, а не контуры. Яркость самой точки усиливает нарисованные отражения
  vec3 ab = textureLod(img, o, 3.0).rgb;
  float gloss = smoothstep(0.3, 0.7, dot(ab, vec3(0.299, 0.587, 0.114))) * (1.0 - smoothstep(0.06, 0.2, max(ab.r, max(ab.g, ab.b)) - min(ab.r, min(ab.g, ab.b))));
  // покрытие места: кафель и вода гладкие, лакированное дерево умеренно, асфальт и трава матовые (белая штукатурка
  // не должна блестеть, как кафель)
  gloss *= glossy;
  gloss = max(gloss, wet * 0.6);
  float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
  float floorness = smoothstep(0.015, 0.06, dy);
  vec3 col;
  float lit = 0.0, cone = 0.0;
  // небо: дальнее и светлое вверху кадра — там медленно идут облака (светлее и темнее на несколько процентов);
  // в грозу облака темнее и быстрее
  float skyness = (1.0 - smoothstep(0.02, 0.09, ds)) * smoothstep(0.42, 0.75, lum) * (1.0 - smoothstep(0.35, 0.75, o.y));
  // мокрое и вода отражают то, что над ними: размытая вертикальная дорожка, как на мокром асфальте; сильнее на воде
  float lyingW = smoothstep(0.004, 0.03, dy);
  vec3 refl = vec3(0.0);
  if (wet > 0.05 && lyingW > 0.02) {
    for (int k = 1; k <= 4; k++) refl += textureLod(img, o - vec2(0.0, 0.018 * float(k) * (0.6 + 0.8 * ds)), 2.5).rgb * (1.0 - 0.18 * float(k));
    refl /= 3.1;
  }
  float reflAmt = wet * lyingW * 0.25;
  if (mode < 0.5) {
    col = albedo * mix(1.0, 0.62, storm);
    if (skyness > 0.01) {
      float cl = fbm(vec2(o.x * 2.4 + t * mix(0.006, 0.02, storm), o.y * 5.5 - t * 0.002));
      col *= 1.0 + (cl - 0.5) * mix(0.16, 0.3, storm) * skyness;
    }
    col = mix(col, max(col, refl * 0.85), reflAmt);
    col = mix(col, fogCol, clamp(fogF, 0.0, 0.32));
    // туман клочьями на трёх глубинах: плывёт вбок с разной скоростью; клочок на глубине z виден только перед тем, что
    // дальше него, — ближний предмет его закрывает. Так туман ходит между деревьями, а не лежит плёнкой на картинке
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float z = 0.72 - fk * 0.2;
      float vis = 1.0 - smoothstep(z - 0.12, z - 0.02, dF);
      if (vis < 0.01) continue;
      vec2 fp = vec2(sv.x * (0.9 + fk * 0.4) + t * (0.02 + 0.014 * fk) * (1.0 + storm), sv.y * (4.2 + fk * 1.6) + fk * 7.0);
      // клочья — редкие и вытянутые вдоль земли, между ними — чисто; у земли гуще
      float wisp = smoothstep(0.58, 0.8, fbm(fp)) * (0.35 + 0.65 * smoothstep(0.25, 0.8, o.y));
      col = mix(col, fogCol * (1.02 + 0.04 * fk), wisp * vis * fogAmt * (0.11 - fk * 0.02));
    }
    // лучи сквозь туман: самое светлое место кадра (просвет неба, окно — точку находит страница, sun) светит
    // полосами к зрителю; где на пути ближний тёмный предмет (ствол, рама), там тень. Источник — светлое и далёкое
    // (небо) или, в помещении, светлое (окно)
    if (quality > 0.5 && fogAmt > 0.2 && sunOn > 0.5) {
      vec2 dir = (sun - uv) / 12.0;
      float shaft = 0.0, decay = 1.0;
      vec2 sp = uv;
      for (int k = 0; k < 12; k++) {
        sp += dir;
        vec2 so = toTex(clamp(sp, 0.0, 1.0));
        // тень луча начинается у самого предмета: глубина и яркость почти без размытия
        float sd = textureLod(dep, so, 1.0).r;
        float sl = dot(textureLod(img, so, 2.0).rgb, vec3(0.299, 0.587, 0.114));
        float far = indoor > 0.5 ? 1.0 : 1.0 - smoothstep(0.03, 0.12, sd);
        shaft += far * smoothstep(0.55, 0.85, sl) * decay;
        decay *= 0.9;
      }
      // на и так светлом (небо, дымка) лучи не прибавляют — иначе середина кадра выгорала в белое
      col += fogCol * shaft * mix(0.012, 0.022, indoor) * fogAmt * (1.0 - storm) * (1.0 - 0.6 * dF) * (1.0 - smoothstep(0.45, 0.8, lum));
    }
  } else {
    // фонарь в руке у героя: источник у камеры, чуть ниже и правее глаз; курсор задаёт, куда смотрит луч (пятно на экране).
    // Свет — по нормали и расстоянию от руки (по сглаженной глубине). Отброшенных теней нет: по карте глубины из одной
    // картинки честную тень не построить — выходила рваная «копия» предмета
    vec3 P = vec3(sc, ds * 0.9);
    vec2 hand = vec2(0.58, 1.12);
    vec3 L = vec3(hand * vec2(1.6, 1.0), 1.3);
    vec3 toL = L - P; float dist = length(toL); vec3 l = toL / dist;
    float diffuse = max(dot(n, l), 0.0) * 0.7 + 0.3;
    // луч от заряда: полный — широкий и яркий, к нулю — узкий и тусклый (мигание и провалы задаёт страница через power)
    float radius = mix(0.22, 0.46, beamR);
    float r = distance(sc, torch * vec2(1.6, 1.0));
    cone = mode > 1.5 ? 0.0 : 1.0 - smoothstep(radius * 0.3, radius, r);
    float fall = 1.0 / (1.0 + dist * dist * mix(1.6, 0.6, beamR));
    float flicker = 0.93 + 0.07 * sin(t * 23.0) * sin(t * 7.3 + 1.7);
    // самое дальнее (туман, небо) луч почти не достаёт — иначе светлый туман в центре луча засвечивается в белое
    lit = cone * diffuse * fall * 2.2 * flicker * power * mix(0.45, 1.0, smoothstep(0.03, 0.25, ds));
    // отражение фонаря на гладком: фонарь почти у глаз, поэтому блестит то, что смотрит на нас, — в центре луча;
    // нарисованные отражения стекла и металла вспыхивают сильнее, блик едет за лучом
    float core = 1.0 - smoothstep(0.0, radius * 0.75, r);
    float glint = cone * power * pow(max(n.z, 0.0), 6.0) * gloss * pow(lum, 2.0) * core * core * fall * 3.0 * flicker;
    // вода и мокрый пол отражают фонарь даже тёмными: узкое световое пятно на полу в центре луча, едет за ним;
    // на тёмной воде заметнее, на светлом полу (и так освещён) слабее — без слепящего пересвета
    float lying = max(floorness, smoothstep(0.004, 0.02, dy) * 0.6);
    glint += cone * power * lying * wet * pow(core, 4.0) * fall * 0.32 * (1.0 - 0.7 * lum) * flicker;
    // мокрый пол блестит в луче
    float spec = rain * cone * pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0) * step(0.002, dy) * 0.8;
    float ambient = (0.04 + 0.06 * ds) * ao;
    vec3 warm = vec3(1.0, 0.9, 0.72);
    col = albedo * (ambient + warm * lit) + warm * (spec + glint);
    // Поверхности. Фонарь у глаз, поэтому гладкое отражает его там, куда смотрит луч.
    // Стекло и кафель: мягкий блик в центре луча (фонарь у глаз — блестит то, куда он смотрит); сквозь стекло освещённое
    // чуть холоднее и светлее. Прямых «лазерных» полос нет — на картинке они читались наклейкой
    vec2 d2 = sc - torch * vec2(1.6, 1.0);
    if (mt.r > 0.02) {
      float hot = exp(-dot(d2, d2) / (radius * radius * 0.03));
      col += vec3(0.93, 0.96, 1.0) * mt.r * power * flicker * cone * hot * 0.28 * (1.0 - 0.6 * lum);
      col = mix(col, col * 1.06 + vec3(0.01, 0.015, 0.022) * cone, mt.r * 0.4);
    }
    // гладкий пол: световая дорожка — отражение луча, вытянутое к зрителю
    if (mt.g > 0.02) {
      float lane = exp(-pow(d2.x / (radius * 0.2), 2.0)) * exp(-pow((d2.y - radius * 0.3) / (radius * 0.8), 2.0));
      col += warm * mt.g * lane * power * flicker * 0.18 * (1.0 - 0.5 * lum);
    }
    // мокрый пол и вода в луче отражают освещённое над ними
    col = mix(col, max(col, refl * (ambient + warm * lit * 0.8)), reflAmt * cone);
    // туман и пыль видны только в луче: объёмный конус
    float beam = (1.0 - smoothstep(radius * 0.2, radius * 1.3, r)) * (mode > 1.5 ? 0.0 : 1.0);
    col += warm * beam * power * (0.05 + 0.13 * fogAmt) * (0.6 + 0.8 * drift) * (1.0 - ds * 0.6) * flicker;
  }
  // лампы, нарисованные в кадре: в темноте светятся сами; пятно света ложится только на то, что рядом с лампой по глубине
  // (стол под лампой — да, стена в пяти метрах перед ней — нет); вокруг — свечение в тумане
  if (mode > 0.5) for (int k = 0; k < 4; k++) {
    if (k >= lampN) break;
    vec2 lp = lamp[k].xy;
    float ld = depthAt(lp);
    vec2 dv = vec2(o.x - lp.x, (o.y - lp.y) * texel.x / texel.y);
    float dist = length(dv);
    float r = lamp[k].z;
    float fl = lamp[k].w > 0.5 ? 0.82 + 0.18 * sin(t * 13.0 + float(k) * 2.1) * sin(t * 5.3 + 1.1) : 1.0;
    float pool = exp(-pow(dist / r, 2.0)) * exp(-abs(ds - ld) * 6.0);
    float core = exp(-pow(dist / (r * 0.12), 2.0));
    float glow = exp(-pow(dist / (r * 0.5), 2.0));
    col += albedo * lampCol[k] * pool * 1.6 * fl;
    // отражения лампы: отблеск на гладком рядом и световая дорожка на полу под лампой (на мокром и кафеле — ярче)
    col += lampCol[k] * gloss * pow(lum, 2.0) * pool * 1.3 * fl;
    col += lampCol[k] * mt.r * pool * 0.5 * fl;
    float streak = exp(-pow(dv.x / (r * 0.16), 2.0)) * smoothstep(lp.y, lp.y + 0.03, o.y) * exp(-(o.y - lp.y) / (r * 2.2));
    col += lampCol[k] * streak * floorness * (0.25 + 0.75 * gloss) * (0.5 + 0.8 * rain) * 0.55 * fl;
    col = mix(col, albedo * 1.15 + lampCol[k] * 0.12, clamp(core * fl, 0.0, 1.0));
    col += lampCol[k] * glow * (0.07 + 0.12 * fogAmt) * fl;
    // лучи от лампы в тумане: к зрителю по воздуху; там, где между лампой и точкой ближний предмет, — тень
    if (quality > 0.5) {
      vec2 dv2 = lp - o;
      float vis = 0.0;
      for (int j = 1; j <= 8; j++) {
        vec2 sp = o + dv2 * (float(j) / 9.0);
        vis += step(textureLod(dep, sp, 2.0).r, ld + 0.04);
      }
      vis /= 8.0;
      float ray = exp(-dist / (r * 1.6)) * vis;
      col += lampCol[k] * ray * (0.05 + 0.16 * fogAmt) * fl * (0.6 + 0.4 * drift);
    }
  }
  // пылинки на трёх глубинах: плывут, мерцают; видны, только если перед поверхностью, и только в луче фонаря
  // (без фонаря мелкие точки на экране читаются как битые пиксели)
  float motes = 0.0;
  float moteAmt = mode < 0.5 ? 0.0 : 1.0;
  if (moteAmt > 0.0) for (int k = 0; k < (quality > 0.5 ? 3 : 1); k++) {
    float z = 0.92 - float(k) * 0.2;
    vec2 g = sv * (26.0 + float(k) * 14.0) + vec2(t * 0.25 + sin(t * 0.3 + float(k)) * 0.6, -t * 0.12 * (1.0 + float(k)));
    vec2 cell = floor(g); vec2 f = fract(g) - 0.5;
    float h = hash(cell + float(k) * 17.0);
    if (h > 0.965 && z > d + 0.03) {
      vec2 off = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
      motes += smoothstep(0.08, 0.0, length(f - off * 0.6)) * (0.5 + 0.5 * sin(t * 1.3 + h * 50.0)) * (1.0 - float(k) * 0.25);
    }
  }
  col += (mode < 0.5 ? vec3(0.06) : vec3(1.0, 0.9, 0.72) * cone * 0.9) * motes * moteAmt;
  // листья: в кадрах с растительностью под открытым небом изредка пролетают по ветру. У каждого листа свой путь: влетает
  // сверху-слева, сносится ветром, покачивается и кувыркается (поворачивается ребром — становится узким, изнанка бледнее).
  // Лист берёзы или осины: шире у черешка, острый кончик, светлее с одного бока, тёмная прожилка и край; дальние мельче
  // и тонут в тумане; ближний предмет лист закрывает
  // (путь листа одинаков для всего экрана — его считает страница раз в кадр, leafP/leafQ; здесь — только сам лист)
  if (leaves > 0.01) {
    for (int k = 0; k < 7; k++) {
      if (k >= leafN) break;
      vec2 pos = leafP[k].xy;
      float sz = leafP[k].z, z = leafP[k].w;
      vec2 dv = (o - pos) * vec2(imgSize.x / imgSize.y, 1.0);
      if (dot(dv, dv) > sz * sz * 2.5 || z < d + 0.03) continue;
      float ang = leafQ[k].x, spin = leafQ[k].y, h13 = leafQ[k].z, h2 = leafQ[k].w;
      vec2 rr = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * dv;
      float flip = cos(spin), wsc = max(0.14, abs(flip));
      vec2 lp = rr / vec2(sz, sz * 0.62 * wsc);
      // ширина по длине листа: у черешка (x < 0) шире, к кончику сходится остро
      float prof = (1.0 - lp.x * lp.x) * (1.0 - 0.35 * lp.x);
      float inside = prof - abs(lp.y);
      float aa = 1.6 / (view.y * sz * 0.62 * wsc);
      float leaf = smoothstep(0.0, aa, inside) * step(abs(lp.x), 1.0);
      float stem = smoothstep(0.1 + aa, 0.0, abs(lp.y)) * step(-1.3, lp.x) * step(lp.x, -0.9);
      // цвет: жёлтая берёза, рыжая осина, бурый сухой; изнанка бледнее и серее
      vec3 lc = mix(vec3(0.6, 0.49, 0.23), vec3(0.56, 0.3, 0.14), h13);
      lc = mix(lc, vec3(0.36, 0.26, 0.15), step(0.75, h2));
      if (flip < 0.0) lc = mix(lc, vec3(0.58, 0.55, 0.42), 0.35) * 0.8;
      // светотень поперёк листа, прожилка посередине, край темнее
      lc *= 0.82 + 0.3 * clamp(0.5 + lp.y * sign(flip) * 0.6, 0.0, 1.0);
      lc *= 1.0 - 0.28 * exp(-pow(lp.y / 0.07, 2.0)) * step(lp.x, 0.85);
      lc *= 0.78 + 0.22 * smoothstep(0.0, 0.25, inside);
      lc = mix(lc, vec3(0.3, 0.22, 0.12), stem * (1.0 - leaf));
      float a = max(leaf, stem * 0.9);
      lc = mode < 0.5 ? mix(lc * mix(1.0, 0.62, storm), fogCol, (1.0 - z) * 0.95 + fogAmt * 0.1) : lc * (0.06 + 1.3 * cone);
      col = mix(col, lc, a * mix(0.75, 0.95, z));
    }
  }
  // Дождь. Пять слоёв струй от ближнего к дальнему: ближние редкие, крупные и размытые (не в фокусе), длиннее —
  // падают быстрее по экрану; дальние густые, тонкие и бледные, тонут в тумане. Наклон струй меняется порывами ветра,
  // по кадру ходят полосы гуще и реже — завесы. Струя — вода: на тёмном светлее фона, на светлом небе чуть темнее
  // (смешивается с цветом отражённого неба, а не прибавляется светом). Края сглажены по размеру точки. Ближний предмет
  // закрывает дальние струи. У земли — дымка от брызг, весь кадр чуть глушит водяная пелена
  if (rain > 0.01) {
    float slant = 0.06 + 0.05 * sin(t * 0.23) + 0.03 * sin(t * 0.61 + 1.7);
    vec3 streakCol = mode < 0.5 ? mix(fogCol * 1.12, vec3(0.86, 0.89, 0.92), 0.35) : vec3(1.0, 0.93, 0.8);
    float veil = 0.55 + 0.9 * smoothstep(0.25, 0.8, fbm(vec2(sv.x * 0.8 - t * (0.12 + slant), sv.y * 0.6 - t * 0.05)));
    col = mix(col, fogCol, rain * 0.07 * (1.0 - ds) * (0.7 + 0.3 * veil) * (mode < 0.5 ? 1.0 : 0.3));
    float NL = quality > 0.5 ? 5.0 : 3.0;
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      if (fk >= NL) break;
      float z = 0.97 - fk * 0.18;
      vec2 rp = o;
      rp.x += rp.y * slant * (1.0 - 0.15 * fk);
      float dens = 38.0 + fk * fk * 22.0;
      float gx = rp.x * dens;
      float pxw = fwidth(gx);
      float cx = floor(gx);
      float hx = hash(vec2(cx, fk * 7.0));
      float speed = (3.2 - fk * 0.45) * (0.8 + 0.4 * hx);
      float yy = rp.y * (0.9 + fk * 0.55) - t * speed - hx * 9.0;
      float cy = floor(yy); float fy = fract(yy);
      float h = hash(vec2(cx, cy + fk * 13.0));
      if (h > 1.0 - 0.34 * rain * veil && z > d + 0.02) {
        float fx = fract(gx) - 0.5 - (hash(vec2(cx, cy + 3.0)) - 0.5) * 0.6;
        float len = (0.16 + 0.22 * rain) * (1.3 - 0.2 * fk) + 0.15 * h;
        float along = smoothstep(0.0, 0.08, fy) * smoothstep(len, len * 0.1, fy);
        // ближние слои размыты: струя шире и прозрачнее; дальние — в точку экрана
        float blurW = mix(0.16, 0.05, fk / 4.0);
        float hw = max(blurW, pxw * 0.6);
        float line = 1.0 - smoothstep(hw * 0.3, hw + pxw * 0.5, abs(fx));
        float a = line * along * (0.1 / max(0.1, hw * 1.3)) * mix(0.34, 0.16, fk / 4.0) * min(1.0, rain * 1.4);
        a *= mode < 0.5 ? 1.0 : cone * 1.6;
        col = mix(col, streakCol, clamp(a, 0.0, 0.6));
      }
    }
    // дымка от брызг у земли: низко над лежащим, клочьями, бежит по ветру
    float mist = lyingW * smoothstep(0.45, 0.95, o.y) * smoothstep(0.35, 0.75, fbm(vec2(sv.x * 2.5 - t * 0.3, sv.y * 9.0 - t * 0.1)));
    col = mix(col, streakCol * (mode < 0.5 ? 1.0 : cone), mist * rain * 0.09);
  }
  // молния: холодный свет с неба — дальнее и небо вспыхивают, ближнее остаётся силуэтом; струи дождя загораются
  if (flash > 0.001) {
    vec3 sky = vec3(0.82, 0.87, 1.0);
    float reach = mix(1.0, 0.25, smoothstep(0.35, 0.9, ds)) * (0.75 + 0.25 * (1.0 - uv.y));
    // вспышка внутри облаков: небо светлеет клубами, а не ровной заливкой; ближнее — силуэтом
    float skyN = (1.0 - smoothstep(0.02, 0.1, ds)) * (1.0 - smoothstep(0.35, 0.7, o.y));
    reach *= mix(1.0, 0.35 + 1.3 * smoothstep(0.35, 0.8, fbm(sv * 2.6 + vec2(floor(t * 0.7) * 3.7, 0.0))), skyN);
    col = col * (1.0 + 0.9 * flash * reach) + sky * 0.2 * flash * reach;
  }
  // Цвет кадра: приглушить, добавить контраста, притемнить и охолодить — то же, что делали css-фильтр холста и слой
  // тонировки поверх (saturate → contrast → brightness с обрезкой после каждого шага, затем умножение на тон). Здесь —
  // потому что css-фильтр и наложение умножением заставляли браузер пересобирать весь экран лишними проходами каждый кадр
  mat3 satM = mat3(0.213 + 0.787 * grade.x, 0.213 - 0.213 * grade.x, 0.213 - 0.213 * grade.x,
                   0.715 - 0.715 * grade.x, 0.715 + 0.285 * grade.x, 0.715 - 0.715 * grade.x,
                   0.072 - 0.072 * grade.x, 0.072 - 0.072 * grade.x, 0.072 + 0.928 * grade.x);
  col = clamp(satM * clamp(col, 0.0, 1.0), 0.0, 1.0);
  col = clamp((col - 0.5) * grade.y + 0.5, 0.0, 1.0);
  col = clamp(col * grade.z, 0.0, 1.0) * mix(vec3(1.0), tint.rgb, tint.a);
  // смена кадра: последний кадр прошлого места плавно перетекает в новый (он уже в этом цвете)
  if (fade < 0.999) col = mix(texture(prev, gl_FragCoord.xy / view).rgb, col, fade);
  color = vec4(col, 1.0);
}`

/** гладкость по покрытию места */
const GLOSS: Record<string, number> = { tile: 1, water: 1, wood: 0.45, asphalt: 0.25, grass: 0.1 }
/** цвет кадра — как --photo-filter «Тумана» (saturate, contrast, brightness) и слой .solo-tint поверх (цвет, доля) */
const GRADE: [number, number, number] = [0.62, 1.14, 0.72]
const TINT = [0x5d / 255, 0x6f / 255, 0x75 / 255, 0.35], TINT_OTHER = [0x7a / 255, 0x4a / 255, 0x3c / 255, 0.5]
/** цвет ламп в кадре */
const LAMP: Record<string, number[]> = { warm: [1.0, 0.76, 0.46], red: [1.0, 0.26, 0.18], cold: [0.7, 0.8, 1.0] }
type Img = ImageBitmap | HTMLImageElement

let gl: WebGL2RenderingContext | null = null
let raf = 0
let dead = false
const texSize = { w: 1, h: 1 }
let prog: WebGLProgram | null = null
const u: Record<string, WebGLUniformLocation | null> = {}
let texImg: WebGLTexture | null = null, texDep: WebGLTexture | null = null, texPrev: WebGLTexture | null = null, texWind: WebGLTexture | null = null, texMat: WebGLTexture | null = null
/* Холст один на всю игру: при смене места новые картинки грузятся в фоне, а старый кадр рисуется как был — со своей
   темнотой, погодой и лампами (applied). Готово — последний кадр запоминается в текстуру, и шейдер за FADE мс
   перетекает из него в новый. Холст и шейдер не пересоздаются, два тяжёлых холста разом не рисуются */
type Scene = Pick<typeof props, 'mode' | 'weak' | 'focus' | 'rain' | 'fog' | 'other' | 'lights' | 'motion' | 'surface'>
const snapshot = (): Scene => ({ mode: props.mode, weak: props.weak, focus: props.focus, rain: props.rain, fog: props.fog, other: props.other, lights: props.lights, motion: props.motion, surface: props.surface })
let applied: Scene = snapshot()
let pending: { img: Img; dep: Img; wind: Img | null; mat: Img | null; key: string } | null = null
let windOn = false, matOn = false
/** полная картинка кадра догрузилась после лёгкой копии — подменить в следующем кадре анимации */
let sharper: { img: Img; key: string } | null = null
/* точка света для лучей в тумане — самое светлое место картинки (в долях картинки); нет светлого — лучей нет */
const sunTex = { x: 0.5, y: 0, on: false }
const fogTint = [0.62, 0.65, 0.66]
let loadingKey = ''
let fadeStart = -1
let shownKey = ''
const FADE = 900

async function decode(url: string, raw = false): Promise<Img> {
  // декодирование вне основного потока — смена кадра не подтормаживает; карта глубины — без цветовой коррекции
  if (typeof createImageBitmap === 'function') {
    // из кэша, если соседнее место уже загружено заранее (сервер всё равно сверяет по ETag — кадр могли перерисовать)
    const r = await fetch(url)
    if (!r.ok) throw new Error(String(r.status))
    return createImageBitmap(await r.blob(), raw ? { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } : {})
  }
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
}
function upload(unit: number, img: TexImageSource, mip: boolean, old: WebGLTexture | null) {
  const g = gl!
  const t = old ?? g.createTexture()
  g.activeTexture(g.TEXTURE0 + unit)
  g.bindTexture(g.TEXTURE_2D, t)
  g.texImage2D(g.TEXTURE_2D, 0, g.RGB, g.RGB, g.UNSIGNED_BYTE, img)
  if (mip) g.generateMipmap(g.TEXTURE_2D)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, mip ? g.LINEAR_MIPMAP_LINEAR : g.LINEAR)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
  return t
}
function shader(type: number, src: string) {
  const s = gl!.createShader(type)!
  gl!.shaderSource(s, src); gl!.compileShader(s)
  if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) ?? 'shader')
  return s
}
/** самое светлое место в верхних трёх четвертях картинки (центр тяжести ярких точек) — туда сходятся лучи в тумане;
    заодно цвет тумана — цвет этой светлой дымки */
function findSun(img: Img) {
  try {
    const cw = 64, ch = 40
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch
    const cx = cv.getContext('2d', { willReadFrequently: true })!
    cx.drawImage(img, 0, 0, cw, ch)
    const d = cx.getImageData(0, 0, cw, ch).data
    let sx = 0, sy = 0, sw = 0, max = 0
    for (let y = 0; y < ch * 0.75; y++) for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4, l = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) / 255
      if (l > max) max = l
    }
    for (let y = 0; y < ch * 0.75; y++) for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4, l = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) / 255
      if (l < max * 0.92) continue
      const w = l ** 4
      sx += (x + 0.5) * w; sy += (y + 0.5) * w; sw += w
    }
    sunTex.on = max > 0.55 && sw > 0
    if (sunTex.on) { sunTex.x = sx / sw / cw; sunTex.y = sy / sw / ch }
    // цвет тумана — средний цвет самого светлого (дымка, небо): верхние 15 % по яркости
    let tr = 0, tg = 0, tb = 0, tn = 0
    for (let y = 0; y < ch * 0.75; y++) for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4, l = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) / 255
      if (l < max * 0.85) continue
      tr += d[i]!; tg += d[i + 1]!; tb += d[i + 2]!; tn++
    }
    if (tn && max > 0.35) { fogTint[0] = tr / tn / 255 * 0.95; fogTint[1] = tg / tn / 255 * 0.95; fogTint[2] = tb / tn / 255 * 0.95 }
    else { fogTint[0] = 0.62; fogTint[1] = 0.65; fogTint[2] = 0.66 }
  } catch { sunTex.on = false }
}
/** новые картинки: грузим в фоне; кадр сменится в frame(), когда всё готово */
async function request(src: string, depth: string, wind?: string) {
  const key = `${src}|${depth}`
  loadingKey = key
  try {
    const mat = props.mat
    // сначала лёгкая копия кадра (<кадр>.lq.jpg, ~100 КБ): на медленном интернете переход не ждёт полную картинку;
    // полная догружается следом и подменяет лёгкую без перехода (та же картинка, резче)
    const lq = src.replace(/\.jpg$/, '.lq.jpg')
    // (artLoad: картинка места — первой в канале, музыка и соседние места ждут её, см. utils/net-queue)
    const [img, dep, w, m] = await artLoad(Promise.all([decode(lq).catch(() => decode(src)), decode(depth, true), wind ? decode(wind).catch(() => null) : Promise.resolve(null),
      mat ? decode(mat, true).catch(() => null) : Promise.resolve(null)]))
    if (dead || loadingKey !== key) return
    pending = { img, dep, wind: w, mat: m, key }
    if (lq !== src) artLoad(decode(src)).then(full => { if (!dead && loadingKey === key) sharper = { img: full, key } }).catch(() => {})
  } catch { if (!dead && loadingKey === key) emit('fail') }
}
function swap(ms: number) {
  const g = gl!, p = pending!
  pending = null
  // прошлый кадр — в текстуру (только что нарисован в этом же кадре анимации)
  if (texImg) {
    g.activeTexture(g.TEXTURE2)
    if (!texPrev) texPrev = upload(2, new ImageData(1, 1), false, null)
    g.bindTexture(g.TEXTURE_2D, texPrev)
    g.copyTexImage2D(g.TEXTURE_2D, 0, g.RGB, 0, 0, g.drawingBufferWidth, g.drawingBufferHeight, 0)
    fadeStart = ms
  }
  texSize.w = p.img.width; texSize.h = p.img.height
  texImg = upload(0, p.img, true, texImg)
  texDep = upload(1, p.dep, true, texDep)
  windOn = !!p.wind
  if (p.wind) texWind = upload(3, p.wind, false, texWind)
  matOn = !!p.mat
  if (p.mat) texMat = upload(4, p.mat, false, texMat)
  findSun(p.img)
  // шаг выборок глубины — по карте глубины (она не шире 1600), выборка картинки — по её размеру
  g.uniform2f(u.texel!, 3 / p.dep.width, 3 / p.dep.height)
  g.uniform2f(u.imgSize!, p.img.width, p.img.height)
  applied = snapshot()
  shownKey = p.key
  born = ms
  quietUntil = ms + 1500
  if (!ready.value) { ready.value = true }
  emit('ready')
}

/* Листья: у каждого свой путь — влетает сверху-слева, сносится ветром, покачивается и кувыркается. Путь одинаков для
   всего экрана, поэтому считается здесь раз в кадр (в шейдере его считала каждая точка экрана — треть работы
   видеокарты на лесных кадрах). hash — тот же, что в шейдере */
const fract = (x: number) => x - Math.floor(x)
function hash(x: number, y: number) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = a
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)
  a += d; b += d; c += d
  return fract((a + b) * c)
}
const leafP = new Float32Array(28), leafQ = new Float32Array(28)
function leafPaths(g: WebGL2RenderingContext, t: number, amount: number) {
  const n = Math.min(7, Math.floor(2 + 2.5 * amount)), wind = props.windy ?? 1
  for (let k = 0; k < n; k++) {
    const P = 9 + 7 * hash(k, 1.3), cyc = Math.floor((t + k * 3.7) / P), age = (t + k * 3.7) - cyc * P
    const h1 = hash(k + 0.17, cyc + 0.17), h2 = hash(k + 3.1, cyc + 3.1), h3 = hash(k + 7.7, cyc + 7.7)
    const z = 0.55 + 0.4 * h3
    // старт выше и левее кадра: часть листьев пролетает мимо, не каждый цикл на экране есть лист
    const sx = h1 * 1.6 - 0.7, sy = -0.1 - 0.35 * h2, zs = 0.6 + 0.4 * z
    const vx = (0.07 + 0.08 * h2) * (0.6 + 0.6 * wind) * zs, vy = (0.055 + 0.05 * h1) * zs
    leafP.set([sx + vx * age + 0.035 * Math.sin(age * 1.6 + h1 * 6), sy + vy * age + 0.02 * Math.sin(age * 2.7 + h2 * 5), (0.006 + 0.008 * z) * (0.8 + 0.4 * h2), z], k * 4)
    leafQ.set([age * (0.5 + h3) + h1 * 6.28, age * (1.6 + 2.2 * h1) + h2 * 6, h3 * h1, h2], k * 4)
  }
  g.uniform4fv(u.leafP!, leafP); g.uniform4fv(u.leafQ!, leafQ); g.uniform1i(u.leafN!, n)
}
/** таблица шума для шейдера: 256×256 случайных чисел, в каждой клетке — она и три соседа (правый, нижний, по диагонали) */
function noiseTable(g: WebGL2RenderingContext) {
  const N = 256, v = new Uint8Array(N * N), px = new Uint8Array(N * N * 4)
  let seed = 0x9e3779b9
  for (let i = 0; i < v.length; i++) { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); v[i] = ((x ^ (x >>> 14)) >>> 0) & 255 }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, x1 = (x + 1) & 255, y1 = (y + 1) & 255
    px[i] = v[y * N + x]!; px[i + 1] = v[y * N + x1]!; px[i + 2] = v[y1 * N + x]!; px[i + 3] = v[y1 * N + x1]!
  }
  g.activeTexture(g.TEXTURE5)
  g.bindTexture(g.TEXTURE_2D, g.createTexture())
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, N, N, 0, g.RGBA, g.UNSIGNED_BYTE, px)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST)
}
async function init() {
  const c = canvas.value
  if (!c) return
  gl = c.getContext('webgl2', { antialias: false, premultipliedAlpha: false })
  if (!gl) return emit('fail')
  try {
    prog = gl.createProgram()!
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link')
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    for (const k of ['img', 'dep', 'prev', 'fade', 'view', 'cover', 'shift', 'torch', 'mode', 't', 'power', 'beamR', 'texel', 'rain', 'fogAmt', 'other', 'flash', 'lamp', 'lampCol', 'lampN', 'quality', 'glossy', 'wet', 'windTex', 'windOn', 'windAmt', 'leaves', 'imgSize', 'breath', 'sun', 'sunOn', 'indoor', 'fogTint', 'matTex', 'matOn', 'noiseTex', 'leafP', 'leafQ', 'leafN', 'grade', 'tint']) u[k] = gl.getUniformLocation(prog, k)
    gl.uniform1i(u.img!, 0); gl.uniform1i(u.dep!, 1); gl.uniform1i(u.prev!, 2); gl.uniform1i(u.windTex!, 3); gl.uniform1i(u.matTex!, 4); gl.uniform1i(u.noiseTex!, 5)
    noiseTable(gl)
    void request(props.src, props.depth, props.wind)
    raf = requestAnimationFrame(frame)
  } catch { emit('fail') }
}

function draw(ms: number) {
  const g = gl!, c = canvas.value!
  // настройки кадра живые (фонарь, батарейка, погода, изнанка); замораживаются только пока грузится новое место —
  // тогда старый кадр дорисовывается таким, каким был
  if (`${props.src}|${props.depth}` === shownKey) applied = snapshot()
  const sc = applied
  const ca = c.clientWidth / Math.max(1, c.clientHeight), ia = texSize.w / texSize.h
  // точек холста — не больше, чем точек картинки на экране: сверх этого видеокарта считает одно и то же дважды
  const texAcross = texSize.w * (ca > ia ? 0.97 : 0.97 * ca / ia)
  const px = Math.min(dprCap, devicePixelRatio, Math.max(1, texAcross / Math.max(1, c.clientWidth))) * SCALE[level]!
  const w = Math.round(c.clientWidth * px), h = Math.round(c.clientHeight * px)
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; g.viewport(0, 0, w, h) }
  const t = ms / 1000
  // Кадр медленно «дышит» целиком: наплыв на 1,5 % и обратно за полминуты, чуть-чуть в сторону. Ничего не сдвигается
  // относительно друг друга — искажений нет. Бег — наезд вперёд и покачивание в такт шагам; дыхание перед встречей —
  // медленный наезд
  const age = (ms - born) / 1000
  let zoom = 1 - (still ? 0 : 0.0075 * (1 - Math.cos((t * 2 * Math.PI) / 32)))
  let bx = still ? 0 : Math.sin((t * 2 * Math.PI) / 47) * 0.004, by = still ? 0 : Math.sin((t * 2 * Math.PI) / 39) * 0.003
  if (!still && sc.motion === 'run') { zoom = 1 - Math.min(age / 8, 1) * 0.06; bx = Math.sin(t * Math.PI * 2.2) * 0.005; by = Math.abs(Math.sin(t * Math.PI * 4.4)) * 0.007 - 0.0035 }
  else if (!still && sc.motion === 'breath') { zoom = 1 - Math.min(age / 25, 1) * 0.05; bx = Math.sin(t * 0.5) * 0.004; by = Math.sin(t * 1.1) * 0.003 }
  const cover = ca > ia ? [0.97 * zoom, 0.97 * zoom * ia / ca] : [0.97 * zoom * ca / ia, 0.97 * zoom]
  const [fx, fy] = (sc.focus ?? '50% 50%').split(' ').map(v => parseFloat(v) / 100)
  const shift = [(1 - cover[0]!) * ((fx ?? 0.5) - 0.5) + bx * cover[0]!, (1 - cover[1]!) * ((fy ?? 0.5) - 0.5) + by * cover[1]!]
  g.uniform2f(u.cover!, cover[0]!, cover[1]!)
  g.uniform2f(u.shift!, shift[0]!, shift[1]!)
  g.uniform1f(u.breath!, zoom)
  g.uniform1f(u.quality!, level === 0 ? 1 : 0)
  g.uniform2f(u.torch!, props.lx / 100, props.ly / 100)
  g.uniform1f(u.mode!, sc.mode === 'none' ? 0 : sc.mode === 'torch' ? 1 : 2)
  g.uniform1f(u.t!, t)
  g.uniform1f(u.power!, props.power ?? 1)
  g.uniform1f(u.beamR!, props.beam ?? 1)
  g.uniform1f(u.rain!, sc.rain ?? 0)
  g.uniform1f(u.fogAmt!, sc.fog ?? 0.6)
  g.uniform1f(u.other!, sc.other ? 1 : 0)
  g.uniform1f(u.glossy!, GLOSS[sc.surface ?? ''] ?? 0.4)
  g.uniform1f(u.windOn!, windOn && !still ? 1 : 0)
  g.uniform1f(u.matOn!, matOn ? 1 : 0)
  // точка лучей — из долей картинки в доли экрана (кадр «дышит», точка — вместе с картинкой)
  g.uniform2f(u.sun!, (sunTex.x - 0.5 - shift[0]!) / cover[0]! + 0.5, (sunTex.y - 0.5 - shift[1]!) / cover[1]! + 0.5)
  g.uniform1f(u.sunOn!, sunTex.on ? 1 : 0)
  g.uniform3f(u.fogTint!, fogTint[0]!, fogTint[1]!, fogTint[2]!)
  g.uniform1f(u.indoor!, props.outdoor === false ? 1 : 0)
  g.uniform1f(u.windAmt!, props.windy ?? 1)
  const lv = windOn && !still ? props.leaves ?? 0 : 0
  g.uniform1f(u.leaves!, lv)
  if (lv > 0.01) leafPaths(g, t, lv)
  g.uniform1f(u.wet!, Math.max(sc.surface === 'water' ? 1 : 0, sc.rain ?? 0))
  g.uniform1f(u.flash!, props.flash ?? 0)
  g.uniform2f(u.view!, w, h)
  const gr = props.grade ?? GRADE
  g.uniform3f(u.grade!, gr[0], gr[1], gr[2])
  // тон — как у слоя .solo-tint: ржавый на изнанке (класс .solo--other у страницы; встречи его не передают)
  const tn = c.closest('.solo--other') ? TINT_OTHER : TINT
  g.uniform4f(u.tint!, tn[0]!, tn[1]!, tn[2]!, tn[3]!)
  g.uniform1f(u.fade!, fadeStart < 0 ? 1 : Math.min(1, (ms - fadeStart) / FADE))
  const L = (sc.lights ?? []).slice(0, 4)
  const pos = new Float32Array(16), rgb = new Float32Array(12)
  L.forEach((l, i) => {
    pos.set([l.x / 100, l.y / 100, (l.r ?? 8) / 100, l.flicker ? 1 : 0], i * 4)
    rgb.set(LAMP[l.color ?? 'warm'] ?? LAMP.warm!, i * 3)
  })
  g.uniform4fv(u.lamp!, pos); g.uniform3fv(u.lampCol!, rgb); g.uniform1i(u.lampN!, L.length)
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
}

/* 30 кадров в секунду в покое (туман, ветер, листья медленные), 60 — пока водят фонарём или кадр перетекает в новый:
   видеокарта не работает вхолостую */
let lastDraw = 0, busyUntil = 0
function frame(ms: number) {
  if (dead || !gl || !prog) return
  const busy = ms < busyUntil || fadeStart >= 0 || !!pending
  if (texImg && !pending && ms - lastDraw < (busy ? 0 : 1000 / 30 - 4)) { raf = requestAnimationFrame(frame); return }
  lastDraw = ms
  measure(ms, busy ? 1000 / 60 : 1000 / 30)
  if (!born) born = ms
  if (texImg) draw(ms)
  // новые картинки готовы: снимок только что нарисованного кадра — и смена
  if (pending) { swap(ms); draw(ms) }
  else if (sharper && sharper.key === shownKey) {
    // полная картинка вместо лёгкой: тот же кадр, без перехода
    const g = gl!
    texSize.w = sharper.img.width; texSize.h = sharper.img.height
    texImg = upload(0, sharper.img, true, texImg)
    g.uniform2f(u.imgSize!, sharper.img.width, sharper.img.height)
    findSun(sharper.img)
    sharper = null
  }
  if (fadeStart >= 0 && ms - fadeStart > FADE) fadeStart = -1
  raf = requestAnimationFrame(frame)
}

watch(() => [props.src, props.depth] as const, ([src, depth]) => { if (gl && prog) void request(src, depth, props.wind) })
/* кому движение мешает (настройка системы «уменьшить движение») — кадр стоит, фонарь светит как обычно */
const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
watch(() => [props.lx, props.ly], () => { busyUntil = performance.now() + 500 })
onMounted(init)
onBeforeUnmount(() => { dead = true; cancelAnimationFrame(raf); gl?.getExtension('WEBGL_lose_context')?.loseContext() })
</script>

<template>
  <canvas ref="canvas" class="solo-depth" :class="{ 'solo-depth--ready': ready }" aria-hidden="true" />
</template>
