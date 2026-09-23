<script setup lang="ts">
/* Кадр места объёмом (2,5D): картинка и её карта глубины (z_<кадр>.jpg, светлое — ближе) рисуются на WebGL как рельеф.
   Камера чуть дышит и смещается за курсором — ближнее уходит сильнее дальнего. В тёмных местах свет считает шейдер:
   пятно фонаря ложится по настоящим стенам и полу, дальнее гаснет раньше ближнего, свет чуть дрожит.
   Не вышло (нет WebGL, не загрузилось) — событие fail, страница вернёт обычную картинку. */
const props = defineProps<{ src: string; depth: string; mode: 'none' | 'torch' | 'black'; lx: number; ly: number; weak?: boolean; focus?: string; rain?: number; fog?: number; other?: boolean; flash?: number; lights?: { x: number; y: number; r?: number; color?: string; flicker?: boolean }[]; motion?: 'calm' | 'run' | 'breath'; surface?: string; wind?: string; windy?: number; leaves?: number; power?: number; beam?: number; gx?: number; gy?: number }>()
const emit = defineEmits<{ fail: []; ready: [] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
/* кадр проявляется, когда нарисован первый раз: без чёрной вспышки на переходе */
const ready = ref(false)
/* телефон и планшет — меньше пикселей: шейдер тяжёлый */
const dprCap = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 1.25 : 2
/* Автокачество: шейдер меряет, успевает ли устройство. Средний кадр дольше 28 мс (меньше ~35 кадров в секунду) два окна
   подряд — ступень ниже: меньше пикселей, без затенения углов, лишних слоёв дождя и пыли. Запас большой (кадр короче 13 мс) —
   ступень выше. Первые секунды после появления и после смены кадра не считаются: загрузка картинок и сборка шейдера
   медленные всегда, и раньше из-за них мощный компьютер навсегда уходил в низкое разрешение — картинка рябила */
const QKEY = 'rn:depth-q2'
const SCALE = [1, 0.75, 0.55]
let level = 0
try { level = Math.min(2, Math.max(0, Number(localStorage.getItem(QKEY)) || 0)) } catch { /* приватный режим */ }
if (level === 0 && typeof navigator !== 'undefined' && ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 2) level = 1
let lastMs = 0, acc = 0, samples = 0, slow = 0, quietUntil = 0
function measure(ms: number) {
  const dt = lastMs ? ms - lastMs : 0
  lastMs = ms
  if (!quietUntil) quietUntil = ms + 3000
  if (ms < quietUntil || dt <= 0 || dt > 200) return
  acc += dt; samples++
  if (samples < 120) return
  const avg = acc / samples
  acc = 0; samples = 0
  if (avg > 28) slow++; else slow = 0
  let next = level
  if (slow >= 2 && level < 2) { next = level + 1; slow = 0 }
  else if (avg < 13 && level > 0) next = level - 1
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
uniform vec2 cover; uniform vec2 shift; uniform vec2 cam; uniform vec2 torch;
uniform float mode; uniform float t; uniform float power; uniform float beamR; uniform vec2 texel;
uniform float rain; uniform float fogAmt; uniform float other; uniform float flash;
uniform vec4 lamp[4]; uniform vec3 lampCol[4]; uniform int lampN; uniform float quality;
uniform sampler2D prev; uniform float fade; uniform vec2 view; uniform float glossy; uniform float wet;
uniform sampler2D windTex; uniform float windOn; uniform float windAmt; uniform float leaves; uniform vec2 imgSize;
uniform sampler2D bgTex; uniform float bgOn;
float depthAt(vec2 q) { return textureLod(dep, q, 0.0).r; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
vec2 toTex(vec2 s) { return shift + (s - 0.5) * cover + 0.5; }
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
  vec2 q = toTex(uv);
  // Параллакс лучом: поверхность глубины t видна со сдвигом cam·(t − 0,35); от ближнего к дальнему — ближнее
  // закрывает дальнее, поэтому край предмета не «перегибается» и не показывается дважды (двойников нет)
  int N = quality > 0.5 ? 32 : 18;
  float tHit = 0.0, tMiss = 1.0; bool hit = false;
  for (int i = 0; i <= N; i++) {
    float tt = 1.0 - float(i) / float(N);
    if (depthAt(q - cam * (tt - 0.35)) >= tt) { tHit = tt; hit = true; break; }
    tMiss = tt;
  }
  if (hit && tMiss > tHit) for (int k = 0; k < 6; k++) { float tm = 0.5 * (tHit + tMiss); if (depthAt(q - cam * (tm - 0.35)) >= tm) tHit = tm; else tMiss = tm; }
  vec2 o = q - cam * (tHit - 0.35);
  // ветер: маска растительности — красное ветки и кроны, зелёное трава. У каждой ветки своя фаза (плавный шум размером
  // с ветку), поэтому крона не колышется флагом целиком; порыв идёт по кадру волной по ветру, между порывами почти тихо.
  // Ветки — плавно и шире к верху кадра, трава — мельче и чаще. Стволы и столбы в маску не входят
  float wat = 0.0, sheen = 0.0;
  if (windOn > 0.5) {
    vec3 wmask = textureLod(windTex, o, 0.0).rgb;
    vec2 wm = wmask.rg;
    // вода (синий канал): мелкая рябь бежит по глади. Ближе — крупнее и медленнее, к горизонту — мельче и чаще
    // (перспектива); отражения в воде дрожат вверх-вниз сильнее, чем вбок; в дождь рябь сильнее
    if (wmask.b > 0.05) {
      float near = textureLod(dep, o, 2.0).r;
      float fr = mix(70.0, 26.0, near);
      vec2 wp = vec2(o.x * fr, o.y * fr * 2.6);
      float n1 = noise(wp + vec2(t * 0.35, t * 0.9)), n2 = noise(wp * 1.7 + vec2(-t * 0.5, t * 0.6) + 11.0);
      o += vec2(n1 - 0.5, (n2 - 0.5) * 1.8) * 0.0022 * mix(0.45, 1.0, near) * wmask.b * (1.0 + 0.8 * rain);
      // переливы: светлые гребни ряби бегут по воде (видно и на тёмной глади, где сдвигать картинке нечего)
      wat = wmask.b;
      // гребни — мелкие, вытянутые вбок (волна видна сбоку), бегут к нам
      sheen = wat * smoothstep(0.72, 0.96, noise(vec2(o.x * fr * 2.2, o.y * fr * 7.0) + vec2(t * 0.3, -t * 0.9))) * mix(0.5, 1.0, near);
    }
    if (wm.r + wm.g > 0.03) {
      float gust = 0.3 + 0.7 * smoothstep(0.15, 0.95, 0.5 + 0.5 * sin(t * 0.5 - o.x * 2.4) * sin(t * 0.21 + 1.3));
      float ph = noise(o * vec2(7.0, 5.0)) * 6.283;
      float up = 1.0 - smoothstep(0.3, 0.9, o.y);
      vec2 branch = vec2(sin(t * 1.25 + ph) + 0.45 * sin(t * 2.2 + ph * 1.7), 0.3 * sin(t * 1.6 + ph * 1.3)) * (0.0022 + 0.0036 * up);
      vec2 blade = vec2(sin(t * 2.7 + o.x * 36.0 + ph) + 0.4 * sin(t * 4.1 + o.x * 71.0), 0.0) * 0.0015;
      o += (branch * wm.r + blade * wm.g) * windAmt * gust;
    }
  }
  vec3 albedo = quality > 0.5 ? sharpAt(o) : textureLod(img, o, 0.0).rgb;
  // резкая глубина — только для параллакса и для того, что прячется за предметами (дождь, пыль)
  float d = depthAt(o);
  // Туман, свет, затенение углов считаются по сглаженной глубине (уровни мип-карты): резкий край глубины никогда не
  // совпадает с краем предмета на картинке, и всё, что по нему посчитано, обводит предмет светлой или тёмной каймой
  float ds = textureLod(dep, o, 3.0).r;
  vec2 st = texel * 4.0;
  float dx = textureLod(dep, o + vec2(st.x, 0.0), 2.0).r - textureLod(dep, o - vec2(st.x, 0.0), 2.0).r;
  float dy = textureLod(dep, o + vec2(0.0, st.y), 2.0).r - textureLod(dep, o - vec2(0.0, st.y), 2.0).r;
  vec3 n = normalize(vec3(-dx * 2.5, dy * 2.5, 1.0));
  // Растяжение: при сдвиге камеры за краем предмета открывается фон, которого на картинке нет, и край тянется
  // резиной — там точка картинки меняется медленнее, чем экран. Там цвет берётся из задника (b_<кадр>: у краёв ближних
  // предметов вместо предмета — продолжение дальнего плана) в той точке, где был бы виден дальний план при этом сдвиге
  // камеры: фон за краем двигается как фон, а не как размазанный край и не как «призрак» предмета
  float qd = length(abs(dFdx(q)) + abs(dFdy(q))), od = length(abs(dFdx(o)) + abs(dFdy(o)));
  float edge = smoothstep(0.3, 0.65, 1.0 - clamp(od / max(qd, 1e-6), 0.0, 1.0));
  if (edge > 0.0) {
    float sx = depthAt(o + vec2(texel.x, 0.0)) - depthAt(o - vec2(texel.x, 0.0));
    float sy = depthAt(o + vec2(0.0, texel.y)) - depthAt(o - vec2(0.0, texel.y));
    vec2 down = -normalize(vec2(sx, sy) + 1e-6) * texel;
    float farD = d; vec2 bp = o;
    for (int k = 1; k <= 6; k++) {
      vec2 p = o + down * float(k) * 1.5;
      float dp = depthAt(p);
      if (dp < d - 0.07) { farD = dp; bp = p; break; }
    }
    if (bgOn > 0.5) albedo = mix(albedo, textureLod(bgTex, q - cam * (farD - 0.35), 0.0).rgb, edge);
    else if (farD < d - 0.07) albedo = mix(albedo, textureLod(img, bp + down, 0.0).rgb, edge);
  }
  // затенение в углах и щелях — по сглаженной глубине и только для небольших перепадов (настоящие углы)
  // Плавно, без порогов: жёсткий порог перепада давал линию на одном и том же расстоянии от каждого края (контуры).
  // На светлых кадрах тени уже нарисованы в картинке — там затенения нет, только в темноте под фонарём
  float occ = 0.0;
  if (quality > 0.5 && mode > 0.5) for (int k = 0; k < 6; k++) { float a = float(k) * 1.047; vec2 off = vec2(cos(a), sin(a)) * texel * 5.0; float df = textureLod(dep, o + off, 2.0).r - ds; occ += df * smoothstep(0.0, 0.03, df) * (1.0 - smoothstep(0.05, 0.14, df)); }
  float ao = clamp(1.0 - occ * 2.5, 0.6, 1.0);
  // мокро: дождь темнит поверхности
  albedo *= mix(1.0, 0.86, rain);
  vec2 sc = uv * vec2(1.6, 1.0);
  // туман по сглаженной глубине: дальнее тонет, туман медленно плывёт; на изнанке — ржавый
  // гроза: тяжёлое небо — кадр и туман темнеют, чтобы вспышке было куда светлеть
  float storm = smoothstep(0.75, 1.0, rain);
  vec3 fogCol = mix(vec3(0.62, 0.65, 0.66), vec3(0.42, 0.28, 0.22), other) * mix(1.0, 0.62, storm);
  float drift = fbm(vec2(sc.x * 2.2 + t * 0.035 + (1.0 - ds) * 1.5, sc.y * 1.6 - t * 0.012));
  // картинки уже нарисованы в тумане: свой туман шейдера лёгкий, только оживляет нарисованный
  float fogF = fogAmt * 0.8 * pow(1.0 - ds, 1.25) * (0.55 + 0.8 * drift);
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
  if (mode < 0.5) {
    col = albedo * mix(1.0, 0.62, storm);
    col += fogCol * sheen * 0.09;
    col = mix(col, fogCol, clamp(fogF, 0.0, 0.6));
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
    glint += cone * power * lying * wet * pow(core, 4.0) * fall * 0.32 * (1.0 - 0.7 * lum) * flicker * (wat > 0.05 ? 0.5 + 1.2 * sheen / max(wat, 0.05) : 1.0);
    // рябь на воде ловит луч: блёстки на гребнях, гуще к центру пятна фонаря
    glint += cone * power * sheen * core * fall * 0.9 * flicker;
    // мокрый пол блестит в луче
    float spec = rain * cone * pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0) * step(0.002, dy) * 0.8;
    float ambient = (0.04 + 0.06 * ds) * ao;
    vec3 warm = vec3(1.0, 0.9, 0.72);
    col = albedo * (ambient + warm * lit) + warm * (spec + glint);
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
    float streak = exp(-pow(dv.x / (r * 0.16), 2.0)) * smoothstep(lp.y, lp.y + 0.03, o.y) * exp(-(o.y - lp.y) / (r * 2.2));
    col += lampCol[k] * streak * floorness * (0.25 + 0.75 * gloss) * (0.5 + 0.8 * rain) * 0.55 * fl;
    col = mix(col, albedo * 1.15 + lampCol[k] * 0.12, clamp(core * fl, 0.0, 1.0));
    col += lampCol[k] * glow * (0.07 + 0.12 * fogAmt) * fl;
  }
  // пылинки на трёх глубинах: плывут, мерцают; видны, только если перед поверхностью, и только в луче фонаря
  // (без фонаря мелкие точки на экране читаются как битые пиксели)
  float motes = 0.0;
  float moteAmt = mode < 0.5 ? 0.0 : 1.0;
  if (moteAmt > 0.0) for (int k = 0; k < (quality > 0.5 ? 3 : 1); k++) {
    float z = 0.92 - float(k) * 0.2;
    vec2 g = (uv - cam * (z - 0.35) * 2.0) * vec2(1.6, 1.0) * (26.0 + float(k) * 14.0) + vec2(t * 0.25 + sin(t * 0.3 + float(k)) * 0.6, -t * 0.12 * (1.0 + float(k)));
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
  if (leaves > 0.01) {
    int NL = int(2.0 + 2.5 * leaves);
    for (int k = 0; k < 7; k++) {
      if (k >= NL) break;
      float fk = float(k);
      float P = 9.0 + 7.0 * hash(vec2(fk, 1.3));
      float cyc = floor((t + fk * 3.7) / P);
      float age = mod(t + fk * 3.7, P);
      vec2 id = vec2(fk, cyc);
      float h1 = hash(id + 0.17), h2 = hash(id + 3.1), h3 = hash(id + 7.7);
      float z = mix(0.55, 0.95, h3);
      // старт выше и левее кадра: часть листьев пролетает мимо, не каждый цикл на экране есть лист
      vec2 start = vec2(h1 * 1.6 - 0.7, -0.1 - 0.35 * h2);
      vec2 vel = vec2((0.07 + 0.08 * h2) * (0.6 + 0.6 * windAmt), 0.055 + 0.05 * h1) * mix(0.6, 1.0, z);
      vec2 pos = start + vel * age + vec2(0.035 * sin(age * 1.6 + h1 * 6.0), 0.02 * sin(age * 2.7 + h2 * 5.0));
      pos -= cam * (z - 0.35) * 2.0;
      vec2 dv = (uv - pos) * vec2(1.6, 1.0);
      float sz = mix(0.006, 0.014, z) * (0.8 + 0.4 * h2);
      if (dot(dv, dv) > sz * sz * 2.5 || z < d + 0.03) continue;
      float spin = age * (1.6 + 2.2 * h1) + h2 * 6.0;
      float ang = age * (0.5 + h3) + h1 * 6.28;
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
      vec3 lc = mix(vec3(0.6, 0.49, 0.23), vec3(0.56, 0.3, 0.14), h3 * h1);
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
  // дождь: четыре слоя тонких струй на разной глубине, со сдвигом параллакса; у каждой струи своя скорость;
  // дальние слои гуще и бледнее; ближний предмет закрывает дальние струи
  if (rain > 0.01) {
    float drops = 0.0;
    for (int k = 0; k < (quality > 0.5 ? 4 : 2); k++) {
      float fk = float(k);
      float z = 0.95 - fk * 0.22;
      vec2 rp = uv - cam * (z - 0.35) * 2.0;
      rp.x += rp.y * 0.07;
      float gx = rp.x * (90.0 + fk * 70.0);
      float cx = floor(gx);
      float hx = hash(vec2(cx, fk * 7.0));
      float yy = rp.y * (1.4 + fk * 0.6) - t * (2.4 - fk * 0.4) * (0.75 + 0.5 * hx) - hx * 9.0;
      float cy = floor(yy); float fy = fract(yy);
      float h = hash(vec2(cx, cy + fk * 13.0));
      // сила дождя — густота и длина струй: морось редкая и короткая, ливень густой
      if (h > 1.0 - 0.3 * rain && z > d + 0.02) {
        float fx = fract(gx) - 0.5 - (hash(vec2(cx, cy + 3.0)) - 0.5) * 0.5;
        float len = (0.12 + 0.2 * rain) + 0.2 * h;
        float along = smoothstep(0.0, 0.04, fy) * smoothstep(len, len * 0.2, fy);
        drops += smoothstep(0.14, 0.0, abs(fx)) * along * (1.0 - fk * 0.22);
      }
    }
    col += (mode < 0.5 ? vec3(0.78, 0.8, 0.82) * (0.1 + 0.12 * rain) : vec3(1.0, 0.92, 0.8) * cone * 0.55) * drops * min(1.0, rain * 1.4);
  }
  // молния: холодный свет с неба — дальнее и небо вспыхивают, ближнее остаётся силуэтом; струи дождя загораются
  if (flash > 0.001) {
    vec3 sky = vec3(0.82, 0.87, 1.0);
    float reach = mix(1.0, 0.25, smoothstep(0.35, 0.9, ds)) * (0.75 + 0.25 * (1.0 - uv.y));
    col = col * (1.0 + 0.9 * flash * reach) + sky * 0.2 * flash * reach;
  }
  // смена кадра: последний кадр прошлого места плавно перетекает в новый
  if (fade < 0.999) col = mix(texture(prev, gl_FragCoord.xy / view).rgb, col, fade);
  color = vec4(col, 1.0);
}`

/** гладкость по покрытию места */
const GLOSS: Record<string, number> = { tile: 1, water: 1, wood: 0.45, asphalt: 0.25, grass: 0.1 }
/** цвет ламп в кадре */
const LAMP: Record<string, number[]> = { warm: [1.0, 0.76, 0.46], red: [1.0, 0.26, 0.18], cold: [0.7, 0.8, 1.0] }

let gl: WebGL2RenderingContext | null = null
let raf = 0
let dead = false
const texSize = { w: 1, h: 1 }
const cam = { x: 0, y: 0, tx: 0, ty: 0 }
let prog: WebGLProgram | null = null
const u: Record<string, WebGLUniformLocation | null> = {}
let texImg: WebGLTexture | null = null, texDep: WebGLTexture | null = null, texPrev: WebGLTexture | null = null
/* Холст один на всю игру: при смене места новые картинки грузятся в фоне, а старый кадр рисуется как был — со своей
   темнотой, погодой и лампами (applied). Готово — последний кадр запоминается в текстуру, и шейдер за FADE мс
   перетекает из него в новый. Холст и шейдер не пересоздаются, два тяжёлых холста разом не рисуются */
type Scene = Pick<typeof props, 'mode' | 'weak' | 'focus' | 'rain' | 'fog' | 'other' | 'lights' | 'motion' | 'surface'>
const snapshot = (): Scene => ({ mode: props.mode, weak: props.weak, focus: props.focus, rain: props.rain, fog: props.fog, other: props.other, lights: props.lights, motion: props.motion, surface: props.surface })
let applied: Scene = snapshot()
let pending: { img: ImageBitmap | HTMLImageElement; dep: ImageBitmap | HTMLImageElement; wind: ImageBitmap | HTMLImageElement | null; bg: ImageBitmap | HTMLImageElement | null; key: string } | null = null
let texWind: WebGLTexture | null = null, texBg: WebGLTexture | null = null
let windOn = false, bgOn = false
let loadingKey = ''
let fadeStart = -1
let shownKey = ''
const FADE = 900

async function decode(url: string): Promise<ImageBitmap | HTMLImageElement> {
  // декодирование вне основного потока — смена кадра не подтормаживает
  if (typeof createImageBitmap === 'function') {
    // с перепроверкой: кадр могли перерисовать под тем же именем
    const r = await fetch(url, { cache: 'no-cache' })
    if (!r.ok) throw new Error(String(r.status))
    return createImageBitmap(await r.blob())
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
/** новые картинки: грузим в фоне; кадр сменится в frame(), когда обе готовы */
async function request(src: string, depth: string, wind?: string) {
  const key = `${src}|${depth}`
  loadingKey = key
  try {
    // задник (b_<кадр>) лежит рядом с картой глубины; нет его — открывшийся фон берётся с края, как раньше
    const back = depth.replace(/\/z_([^/]+)$/, '/b_$1')
    const [img, dep, w, bg] = await Promise.all([decode(src), decode(depth), wind ? decode(wind).catch(() => null) : Promise.resolve(null), back !== depth ? decode(back).catch(() => null) : Promise.resolve(null)])
    if (dead || loadingKey !== key) return
    pending = { img, dep, wind: w, bg, key }
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
  bgOn = !!p.bg
  if (p.bg) texBg = upload(4, p.bg, false, texBg)
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

async function init() {
  const c = canvas.value
  if (!c) return
  gl = c.getContext('webgl2', { antialias: false, premultipliedAlpha: false })
  if (!gl) return emit('fail')
  try {
    prog = gl.createProgram()!
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link')
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    for (const k of ['img', 'dep', 'prev', 'fade', 'view', 'cover', 'shift', 'cam', 'torch', 'mode', 't', 'power', 'beamR', 'texel', 'rain', 'fogAmt', 'other', 'flash', 'lamp', 'lampCol', 'lampN', 'quality', 'glossy', 'wet', 'windTex', 'windOn', 'windAmt', 'leaves', 'imgSize', 'bgTex', 'bgOn']) u[k] = gl.getUniformLocation(prog, k)
    gl.uniform1i(u.img!, 0); gl.uniform1i(u.dep!, 1); gl.uniform1i(u.prev!, 2); gl.uniform1i(u.windTex!, 3); gl.uniform1i(u.bgTex!, 4)
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
  const px = Math.min(dprCap, devicePixelRatio) * SCALE[level]!
  const w = Math.round(c.clientWidth * px), h = Math.round(c.clientHeight * px)
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; g.viewport(0, 0, w, h) }
  // «object-fit: cover» с запасом на параллакс: кадр чуть больше окна
  const ca = w / h, ia = texSize.w / texSize.h
  // бег — медленный наезд вперёд за первые 8 с; дыхание — ещё медленнее, за 25 с
  const age = (ms - born) / 1000
  const zoom = still ? 1 : sc.motion === 'run' ? 1 - Math.min(age / 8, 1) * 0.06 : sc.motion === 'breath' ? 1 - Math.min(age / 25, 1) * 0.05 : 1
  const cover = ca > ia ? [0.94 * zoom, 0.94 * zoom * ia / ca] : [0.94 * zoom * ca / ia, 0.94 * zoom]
  const [fx, fy] = (sc.focus ?? '50% 50%').split(' ').map(v => parseFloat(v) / 100)
  const shift = [(1 - cover[0]!) * ((fx ?? 0.5) - 0.5), (1 - cover[1]!) * ((fy ?? 0.5) - 0.5)]
  const t = ms / 1000
  cam.x += (cam.tx - cam.x) * 0.05; cam.y += (cam.ty - cam.y) * 0.05
  g.uniform2f(u.cover!, cover[0]!, cover[1]!)
  g.uniform2f(u.shift!, shift[0]!, shift[1]!)
  // камера: бег — покачивание в такт шагам (вбок раз за два шага, вверх-вниз на каждый); дыхание — медленный вдох;
  // спокойно — едва заметно
  let bx = Math.sin(t * 0.37) * 0.003, by = Math.sin(t * 0.23) * 0.002
  if (sc.motion === 'run') { bx = Math.sin(t * Math.PI * 2.2) * 0.007; by = Math.abs(Math.sin(t * Math.PI * 4.4)) * 0.009 - 0.0045 }
  else if (sc.motion === 'breath') { bx = Math.sin(t * 0.5) * 0.006; by = Math.sin(t * 1.1) * 0.004 }
  g.uniform2f(u.cam!, still ? 0 : cam.x + bx, still ? 0 : cam.y + by)
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
  g.uniform1f(u.bgOn!, bgOn ? 1 : 0)
  g.uniform1f(u.windAmt!, props.windy ?? 1)
  g.uniform1f(u.leaves!, windOn && !still ? props.leaves ?? 0 : 0)
  g.uniform1f(u.wet!, Math.max(sc.surface === 'water' ? 1 : 0, sc.rain ?? 0))
  g.uniform1f(u.flash!, props.flash ?? 0)
  g.uniform2f(u.view!, w, h)
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

function frame(ms: number) {
  if (dead || !gl || !prog) return
  measure(ms)
  if (!born) born = ms
  if (texImg) draw(ms)
  // новые картинки готовы: снимок только что нарисованного кадра — и смена
  if (pending) { swap(ms); draw(ms) }
  if (fadeStart >= 0 && ms - fadeStart > FADE) fadeStart = -1
  raf = requestAnimationFrame(frame)
}

watch(() => [props.src, props.depth] as const, ([src, depth]) => { if (gl && prog) void request(src, depth, props.wind) })
/* кому движение мешает (настройка системы «уменьшить движение») — кадр стоит, фонарь светит как обычно */
const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
/* камера — за взглядом (gx/gy: курсор над картинкой, иначе середина) или, если его не дали, за лучом фонаря */
watch(() => [props.gx ?? props.lx, props.gy ?? props.ly], ([x, y]) => { if (still) return; cam.tx = ((x ?? 50) / 100 - 0.5) * -0.013; cam.ty = ((y ?? 50) / 100 - 0.5) * -0.007 }, { immediate: true })
onMounted(init)
onBeforeUnmount(() => { dead = true; cancelAnimationFrame(raf); gl?.getExtension('WEBGL_lose_context')?.loseContext() })
</script>

<template>
  <canvas ref="canvas" class="solo-depth" :class="{ 'solo-depth--ready': ready }" aria-hidden="true" />
</template>
