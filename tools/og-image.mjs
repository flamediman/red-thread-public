// Картинка превью ссылок: tools/og-image.html → public/og/red-thread.jpg (1200×630, JPEG).
//   node tools/og-image.mjs
// Рисует Chrome без окна, сжимает ffmpeg. Нужны установленный Google Chrome и ffmpeg.
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const html = resolve(root, 'tools/og-image.html')
const outDir = resolve(root, 'public/og')
const png = resolve(outDir, 'red-thread.png')
const jpg = resolve(outDir, 'red-thread.jpg')
mkdirSync(outDir, { recursive: true })

execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=4000',
  `--screenshot=${png}`, pathToFileURL(html).href
], { stdio: 'ignore' })
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-q:v', '3', jpg])
rmSync(png)
console.log(`${jpg} — ${Math.round(statSync(jpg).size / 1024)} КБ`)
