<script setup lang="ts">
/* Кадр места объёмом (2,5D): картинка и её карта глубины (z_<кадр>.jpg, светлое — ближе) рисуются на WebGL как рельеф.
   Камера чуть дышит и смещается за курсором — ближнее уходит сильнее дальнего. В тёмных местах свет считает шейдер:
   пятно фонаря ложится по настоящим стенам и полу, дальнее гаснет раньше ближнего, свет чуть дрожит.
   Не вышло (нет WebGL, не загрузилось) — событие fail, страница вернёт обычную картинку. */
const props = defineProps<{ src: string; depth: string; mode: 'none' | 'torch' | 'black'; lx: number; ly: number; weak?: boolean; focus?: string }>()
const emit = defineEmits<{ fail: [] }>()
const canvas = ref<HTMLCanvasElement | null>(null)

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`
const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 color;
uniform sampler2D img; uniform sampler2D dep;
uniform vec2 cover; uniform vec2 shift; uniform vec2 cam; uniform vec2 torch;
uniform float mode; uniform float t; uniform float weak; uniform vec2 texel;
float depthAt(vec2 q) { return texture(dep, q).r; }
void main() {
  vec2 q = shift + (uv - 0.5) * cover + 0.5;
  // параллакс лучом: поверхность глубины t видна со сдвигом cam·(t − 0,35). Идём от ближнего к дальнему и берём первую
  // поверхность, которая дотягивается до луча, — ближнее честно закрывает дальнее, края не двоятся. Потом уточняем
  // точку попадания половинным делением между последним промахом и попаданием
  const int N = 28;
  float tHit = 0.0, tMiss = 1.0;
  bool hit = false;
  for (int i = 0; i <= N; i++) {
    float t = 1.0 - float(i) / float(N);
    if (depthAt(q - cam * (t - 0.35)) >= t) { tHit = t; hit = true; break; }
    tMiss = t;
  }
  if (hit && tMiss > tHit) {
    for (int k = 0; k < 5; k++) {
      float tm = 0.5 * (tHit + tMiss);
      if (depthAt(q - cam * (tm - 0.35)) >= tm) tHit = tm; else tMiss = tm;
    }
  }
  vec2 o = q - cam * (tHit - 0.35);
  vec3 albedo = texture(img, o).rgb;
  if (mode < 0.5) { color = vec4(albedo, 1.0); return; }
  float d = depthAt(o);
  // нормаль по наклону глубины
  float dx = depthAt(o + vec2(texel.x, 0.0)) - depthAt(o - vec2(texel.x, 0.0));
  float dy = depthAt(o + vec2(0.0, texel.y)) - depthAt(o - vec2(0.0, texel.y));
  vec3 n = normalize(vec3(-dx * 18.0, dy * 18.0, 1.0));
  // экранные координаты пикселя и фонаря; фонарь — у самой камеры
  vec2 s = uv;
  vec3 P = vec3(s * vec2(1.6, 1.0), d * 0.9);
  vec3 L = vec3(torch * vec2(1.6, 1.0), 1.25);
  vec3 toL = L - P; float dist = length(toL); vec3 l = toL / dist;
  float diffuse = max(dot(n, l), 0.0) * 0.7 + 0.3;
  float radius = weak > 0.5 ? 0.24 : 0.46;
  float r = distance(s * vec2(1.6, 1.0), torch * vec2(1.6, 1.0));
  float cone = 1.0 - smoothstep(radius * 0.3, radius, r);
  float fall = 1.0 / (1.0 + dist * dist * (weak > 0.5 ? 2.0 : 0.8));
  float flicker = 0.93 + 0.07 * sin(t * 23.0) * sin(t * 7.3 + 1.7);
  float lit = mode > 1.5 ? 0.0 : cone * diffuse * fall * 2.2 * flicker;
  float ambient = 0.04 + 0.06 * d;
  vec3 warm = vec3(1.0, 0.9, 0.72);
  color = vec4(albedo * (ambient + warm * lit), 1.0);
}`

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
    for (const k of ['img', 'dep', 'cover', 'shift', 'cam', 'torch', 'mode', 't', 'weak', 'texel']) u[k] = gl.getUniformLocation(prog, k)
    gl.uniform1i(u.img!, 0); gl.uniform1i(u.dep!, 1)
    gl.uniform2f(u.texel!, 1.5 / img.naturalWidth, 1.5 / img.naturalHeight)
    raf = requestAnimationFrame(frame)
  } catch { emit('fail') }
}

function frame(ms: number) {
  if (dead || !gl || !prog) return
  const c = canvas.value!
  const w = Math.round(c.clientWidth * Math.min(2, devicePixelRatio)), h = Math.round(c.clientHeight * Math.min(2, devicePixelRatio))
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
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  raf = requestAnimationFrame(frame)
}

/* кому движение мешает (настройка системы «уменьшить движение») — кадр стоит, фонарь светит как обычно */
const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
watch(() => [props.lx, props.ly], ([x, y]) => { if (still) return; cam.tx = ((x ?? 50) / 100 - 0.5) * -0.018; cam.ty = ((y ?? 50) / 100 - 0.5) * -0.01 })
onMounted(init)
onBeforeUnmount(() => { dead = true; cancelAnimationFrame(raf); gl?.getExtension('WEBGL_lose_context')?.loseContext() })
</script>

<template>
  <canvas ref="canvas" class="solo-view__art solo-view__depth" aria-hidden="true" />
</template>
