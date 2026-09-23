<script setup lang="ts">
/* Кадр места объёмом (2,5D): картинка и её карта глубины (z_<кадр>.jpg, светлое — ближе) рисуются на WebGL как рельеф.
   Камера чуть дышит и смещается за курсором — ближнее уходит сильнее дальнего. В тёмных местах свет считает шейдер:
   пятно фонаря ложится по настоящим стенам и полу, дальнее гаснет раньше ближнего, свет чуть дрожит.
   Не вышло (нет WebGL, не загрузилось) — событие fail, страница вернёт обычную картинку. */
const props = defineProps<{ src: string; depth: string; mode: 'none' | 'torch' | 'black'; lx: number; ly: number; weak?: boolean; focus?: string; rain?: number; fog?: number; other?: boolean; flash?: number; lights?: { x: number; y: number; r?: number; color?: string; flicker?: boolean }[] }>()
const emit = defineEmits<{ fail: []; ready: [] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
/* кадр проявляется, когда нарисован первый раз: без чёрной вспышки на переходе */
const ready = ref(false)
/* телефон и планшет — меньше пикселей: шейдер тяжёлый */
const dprCap = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 1.25 : 2

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`
const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 color;
uniform sampler2D img; uniform sampler2D dep;
uniform vec2 cover; uniform vec2 shift; uniform vec2 cam; uniform vec2 torch;
uniform float mode; uniform float t; uniform float weak; uniform vec2 texel;
uniform float rain; uniform float fogAmt; uniform float other; uniform float flash;
uniform vec4 lamp[4]; uniform vec3 lampCol[4]; uniform int lampN;
float depthAt(vec2 q) { return texture(dep, q).r; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
vec2 toTex(vec2 s) { return shift + (s - 0.5) * cover + 0.5; }
void main() {
  vec2 q = toTex(uv);
  // параллакс лучом: поверхность глубины t видна со сдвигом cam·(t − 0,35); от ближнего к дальнему — ближнее закрывает дальнее
  const int N = 28;
  float tHit = 0.0, tMiss = 1.0; bool hit = false;
  for (int i = 0; i <= N; i++) {
    float tt = 1.0 - float(i) / float(N);
    if (depthAt(q - cam * (tt - 0.35)) >= tt) { tHit = tt; hit = true; break; }
    tMiss = tt;
  }
  if (hit && tMiss > tHit) for (int k = 0; k < 5; k++) { float tm = 0.5 * (tHit + tMiss); if (depthAt(q - cam * (tm - 0.35)) >= tm) tHit = tm; else tMiss = tm; }
  vec2 o = q - cam * (tHit - 0.35);
  vec3 albedo = texture(img, o).rgb;
  float d = depthAt(o);
  // нормаль по наклону глубины; dy > 0 — поверхность смотрит вверх (пол, земля)
  float dx = depthAt(o + vec2(texel.x, 0.0)) - depthAt(o - vec2(texel.x, 0.0));
  float dy = depthAt(o + vec2(0.0, texel.y)) - depthAt(o - vec2(0.0, texel.y));
  vec3 n = normalize(vec3(-dx * 9.0, dy * 9.0, 1.0));
  // край предмета: глубина здесь круто падает, и при сдвиге камеры шейдер растянул бы пиксели края резиной.
  // На таком склоне берём цвет и глубину (для тумана) с фона за краем: ищем вниз по склону точку заметно дальше
  float slope = length(vec2(dx, dy));
  float edge = smoothstep(0.035, 0.1, slope);
  if (edge > 0.0) {
    vec2 down = -normalize(vec2(dx, dy) + 1e-6) * texel;
    for (int k = 1; k <= 6; k++) {
      vec2 bp = o + down * float(k) * 1.5;
      float bd = depthAt(bp);
      if (bd < d - 0.07) { albedo = mix(albedo, texture(img, bp + down).rgb, edge); d = mix(d, bd, edge); break; }
    }
  }
  // затенение в углах и щелях: соседи ближе — сюда меньше попадает рассеянного света
  float occ = 0.0;
  // только небольшой перепад — настоящий угол; большой (предмет далеко перед фоном) не затеняет, иначе вокруг ближних
  // предметов на светлом тумане проступает тёмный силуэт
  for (int k = 0; k < 6; k++) { float a = float(k) * 1.047; vec2 off = vec2(cos(a), sin(a)) * texel * 3.5; float df = depthAt(o + off) - d - 0.01; occ += df > 0.0 && df < 0.1 ? df : 0.0; }
  float ao = clamp(1.0 - occ * 2.2, 0.45, 1.0);
  // мокро: дождь темнит поверхности
  albedo *= mix(1.0, 0.86, rain);
  vec2 sc = uv * vec2(1.6, 1.0);
  // туман по глубине: дальнее тонет, туман медленно плывёт; на изнанке — ржавый
  // гроза: тяжёлое небо — кадр и туман темнеют, чтобы вспышке было куда светлеть
  float storm = smoothstep(0.75, 1.0, rain);
  vec3 fogCol = mix(vec3(0.62, 0.65, 0.66), vec3(0.42, 0.28, 0.22), other) * mix(1.0, 0.62, storm);
  float drift = fbm(vec2(sc.x * 2.2 + t * 0.035 + (1.0 - d) * 1.5, sc.y * 1.6 - t * 0.012));
  // туман — по глубине, поджатой внутрь ближних предметов: мягкий край сети вылезает за контур, и без этого вокруг
  // предмета светилась бы кайма незатуманенного фона
  float fd = d;
  for (int k = 0; k < 8; k++) { float a = float(k) * 0.785; fd = min(fd, depthAt(o + vec2(cos(a), sin(a)) * texel * 2.2)); }
  float fogF = fogAmt * pow(1.0 - fd, 1.25) * (0.55 + 0.8 * drift);
  vec3 col;
  float lit = 0.0, cone = 0.0;
  if (mode < 0.5) {
    col = albedo * (0.78 + 0.22 * ao) * mix(1.0, 0.62, storm);
    col = mix(col, fogCol, clamp(fogF, 0.0, 0.82));
  } else {
    // фонарь у камеры: пятно по экрану, свет по нормали и расстоянию, тень от ближнего по лучу к фонарю
    vec3 P = vec3(sc, d * 0.9);
    vec3 L = vec3(torch * vec2(1.6, 1.0), 1.25);
    vec3 toL = L - P; float dist = length(toL); vec3 l = toL / dist;
    float diffuse = max(dot(n, l), 0.0) * 0.7 + 0.3;
    float radius = weak > 0.5 ? 0.24 : 0.46;
    float r = distance(sc, torch * vec2(1.6, 1.0));
    cone = mode > 1.5 ? 0.0 : 1.0 - smoothstep(radius * 0.3, radius, r);
    float fall = 1.0 / (1.0 + dist * dist * (weak > 0.5 ? 2.0 : 0.8));
    float shadow = 1.0;
    if (cone > 0.01) for (int k = 1; k <= 10; k++) {
      float f = float(k) / 12.0;
      vec2 sp = mix(uv, torch, f);
      float zr = mix(d, 1.15, f);
      if (depthAt(toTex(sp)) > zr + 0.04) { shadow *= 0.55; }
    }
    float flicker = 0.93 + 0.07 * sin(t * 23.0) * sin(t * 7.3 + 1.7);
    lit = cone * diffuse * fall * 2.2 * flicker * mix(0.35, 1.0, clamp(shadow, 0.0, 1.0));
    // мокрый пол блестит в луче
    float spec = rain * cone * pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0) * step(0.002, dy) * 0.8;
    float ambient = (0.04 + 0.06 * d) * ao;
    vec3 warm = vec3(1.0, 0.9, 0.72);
    col = albedo * (ambient + warm * lit) + warm * spec;
    // туман и пыль видны только в луче: объёмный конус
    float beam = (1.0 - smoothstep(radius * 0.2, radius * 1.3, r)) * (mode > 1.5 ? 0.0 : 1.0);
    col += warm * beam * (0.05 + 0.13 * fogAmt) * (0.6 + 0.8 * drift) * (1.0 - d * 0.6) * flicker;
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
    float pool = exp(-pow(dist / r, 2.0)) * exp(-abs(d - ld) * 6.0);
    float core = exp(-pow(dist / (r * 0.12), 2.0));
    float glow = exp(-pow(dist / (r * 0.5), 2.0));
    col += albedo * lampCol[k] * pool * 1.6 * fl;
    col = mix(col, albedo * 1.15 + lampCol[k] * 0.12, clamp(core * fl, 0.0, 1.0));
    col += lampCol[k] * glow * (0.07 + 0.12 * fogAmt) * fl;
  }
  // пылинки на трёх глубинах: плывут, мерцают; видны, только если перед поверхностью, и только в луче фонаря
  // (без фонаря мелкие точки на экране читаются как битые пиксели)
  float motes = 0.0;
  float moteAmt = mode < 0.5 ? 0.0 : 1.0;
  if (moteAmt > 0.0) for (int k = 0; k < 3; k++) {
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
  // дождь: четыре слоя тонких струй на разной глубине, со сдвигом параллакса; у каждой струи своя скорость;
  // дальние слои гуще и бледнее; ближний предмет закрывает дальние струи
  if (rain > 0.01) {
    float drops = 0.0;
    for (int k = 0; k < 4; k++) {
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
    float reach = mix(1.0, 0.25, smoothstep(0.35, 0.9, d)) * (0.75 + 0.25 * (1.0 - uv.y));
    col = col * (1.0 + 0.9 * flash * reach) + sky * 0.2 * flash * reach;
  }
  color = vec4(col, 1.0);
}`

/** цвет ламп в кадре */
const LAMP: Record<string, number[]> = { warm: [1.0, 0.76, 0.46], red: [1.0, 0.26, 0.18], cold: [0.7, 0.8, 1.0] }

let gl: WebGL2RenderingContext | null = null
let raf = 0
let dead = false
const texSize = { w: 1, h: 1 }
const cam = { x: 0, y: 0, tx: 0, ty: 0 }
let prog: WebGLProgram | null = null
const u: Record<string, WebGLUniformLocation | null> = {}

function load(url: string) {
  return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
}
function texture(unit: number, img: HTMLImageElement) {
  const t = gl!.createTexture()
  gl!.activeTexture(gl!.TEXTURE0 + unit)
  gl!.bindTexture(gl!.TEXTURE_2D, t)
  gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGB, gl!.RGB, gl!.UNSIGNED_BYTE, img)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
}
function shader(type: number, src: string) {
  const s = gl!.createShader(type)!
  gl!.shaderSource(s, src); gl!.compileShader(s)
  if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) ?? 'shader')
  return s
}

async function init() {
  const c = canvas.value
  if (!c) return
  gl = c.getContext('webgl2', { antialias: false, premultipliedAlpha: false })
  if (!gl) return emit('fail')
  try {
    const [img, dep] = await Promise.all([load(props.src), load(props.depth)])
    if (dead) return
    texSize.w = img.naturalWidth; texSize.h = img.naturalHeight
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
    texture(0, img); texture(1, dep)
    for (const k of ['img', 'dep', 'cover', 'shift', 'cam', 'torch', 'mode', 't', 'weak', 'texel', 'rain', 'fogAmt', 'other', 'flash', 'lamp', 'lampCol', 'lampN']) u[k] = gl.getUniformLocation(prog, k)
    gl.uniform1i(u.img!, 0); gl.uniform1i(u.dep!, 1)
    gl.uniform2f(u.texel!, 3 / img.naturalWidth, 3 / img.naturalHeight)
    raf = requestAnimationFrame(frame)
  } catch { emit('fail') }
}

function frame(ms: number) {
  if (dead || !gl || !prog) return
  const c = canvas.value!
  const w = Math.round(c.clientWidth * Math.min(dprCap, devicePixelRatio)), h = Math.round(c.clientHeight * Math.min(dprCap, devicePixelRatio))
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; gl.viewport(0, 0, w, h) }
  // «object-fit: cover» с запасом на параллакс: кадр чуть больше окна
  const ca = w / h, ia = texSize.w / texSize.h
  const cover = ca > ia ? [0.94, 0.94 * ia / ca] : [0.94 * ca / ia, 0.94]
  const [fx, fy] = (props.focus ?? '50% 50%').split(' ').map(v => parseFloat(v) / 100)
  const shift = [(1 - cover[0]!) * ((fx ?? 0.5) - 0.5), (1 - cover[1]!) * ((fy ?? 0.5) - 0.5)]
  // камера: медленное дыхание и мягкое следование за курсором
  const t = ms / 1000
  cam.x += (cam.tx - cam.x) * 0.05; cam.y += (cam.ty - cam.y) * 0.05
  gl.uniform2f(u.cover!, cover[0]!, cover[1]!)
  gl.uniform2f(u.shift!, shift[0]!, shift[1]!)
  gl.uniform2f(u.cam!, still ? 0 : cam.x + Math.sin(t * 0.37) * 0.004, still ? 0 : cam.y + Math.sin(t * 0.23) * 0.0025)
  gl.uniform2f(u.torch!, props.lx / 100, props.ly / 100)
  gl.uniform1f(u.mode!, props.mode === 'none' ? 0 : props.mode === 'torch' ? 1 : 2)
  gl.uniform1f(u.t!, t)
  gl.uniform1f(u.weak!, props.weak ? 1 : 0)
  gl.uniform1f(u.rain!, props.rain ?? 0)
  gl.uniform1f(u.fogAmt!, props.fog ?? 0.6)
  gl.uniform1f(u.other!, props.other ? 1 : 0)
  gl.uniform1f(u.flash!, props.flash ?? 0)
  const L = (props.lights ?? []).slice(0, 4)
  const pos = new Float32Array(16), rgb = new Float32Array(12)
  L.forEach((l, i) => {
    pos.set([l.x / 100, l.y / 100, (l.r ?? 8) / 100, l.flicker ? 1 : 0], i * 4)
    rgb.set(LAMP[l.color ?? 'warm'] ?? LAMP.warm!, i * 3)
  })
  gl.uniform4fv(u.lamp!, pos); gl.uniform3fv(u.lampCol!, rgb); gl.uniform1i(u.lampN!, L.length)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  if (!ready.value) { ready.value = true; emit('ready') }
  raf = requestAnimationFrame(frame)
}

/* кому движение мешает (настройка системы «уменьшить движение») — кадр стоит, фонарь светит как обычно */
const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
watch(() => [props.lx, props.ly], ([x, y]) => { if (still) return; cam.tx = ((x ?? 50) / 100 - 0.5) * -0.028; cam.ty = ((y ?? 50) / 100 - 0.5) * -0.015 })
onMounted(init)
onBeforeUnmount(() => { dead = true; cancelAnimationFrame(raf); gl?.getExtension('WEBGL_lose_context')?.loseContext() })
</script>

<template>
  <canvas ref="canvas" class="solo-view__art solo-view__depth" :class="{ 'solo-view__depth--ready': ready }" aria-hidden="true" />
</template>
