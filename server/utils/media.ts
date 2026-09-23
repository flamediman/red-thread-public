/* Картинки, озвучка и музыка отдаются с диска на лету, а не из сборки:
   их перегенерируют без пересборки, а встроенная раздача Nitro запоминает размер файла при сборке
   и отдаёт перерисованный файл обрезанным.
   /art/<дело|мир>/<файл>   → cases/<дело>/art/ или media/art/<мир>/
   /voice/<дело>/<файл>     → cases/<дело>/voice/
   /music/<дело|settings>/<файл> → cases/<дело>/music/ или media/music/settings/ */
import { createReadStream, statSync, type Stats } from 'node:fs'
import { resolve } from 'node:path'
import type { H3Event } from 'h3'
import { IS_PUBLIC } from './mode'

export const CASES_DIR = process.env.CASES_DIR || resolve(process.cwd(), 'cases')
export const MEDIA_DIR = process.env.MEDIA_DIR || resolve(process.cwd(), 'media')

export type MediaKind = 'art' | 'voice' | 'music'

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', json: 'application/json'
}
const FOLDER = /^[a-z0-9-]{1,40}$/
const FILE = /^[a-z0-9][a-z0-9_.-]{0,80}\.([a-z0-9]{2,4})$/i

function statFile(path: string): Stats | null {
  try { const s = statSync(path); return s.isFile() ? s : null } catch { return null }
}

function locate(kind: MediaKind, folder: string, file: string): string | null {
  const fromCase = statFile(resolve(CASES_DIR, folder, kind, file)) && resolve(CASES_DIR, folder, kind, file)
  if (fromCase) return fromCase
  if (kind === 'voice') return null
  const fromMedia = resolve(MEDIA_DIR, kind, folder, file)
  return statFile(fromMedia) ? fromMedia : null
}

/** ответ на HEAD: заголовки с размером и статусом как у GET, без тела. Вернуть null нельзя — h3 превратит его в 204 */
function headOnly(event: H3Event) {
  event.node.res.end()
  return undefined
}

export function serveMedia(event: H3Event, kind: MediaKind) {
  const parts = (getRouterParam(event, 'path') || '').split('/')
  const [folder, file] = parts
  const ext = parts.length === 2 && folder && file && FOLDER.test(folder) ? FILE.exec(file)?.[1]?.toLowerCase() : undefined
  const type = ext && TYPES[ext]
  const path = type ? locate(kind, folder!, file!) : null
  const stat = path ? statFile(path) : null
  if (!path || !stat || !type) throw createError({ statusCode: 404, statusMessage: 'Нет файла' })

  const etag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`
  setResponseHeaders(event, {
    'content-type': type,
    etag,
    'last-modified': stat.mtime.toUTCString(),
    'accept-ranges': 'bytes',
    // дома файлы меняются на лету — браузер переспрашивает. В сети звук кэшируется на час; картинки — с перепроверкой
    // (ответ 304, если не менялись): имена кадров при перерисовке не меняются, и старый кадр жил бы в кэше до суток
    'cache-control': IS_PUBLIC && kind !== 'art' ? 'public, max-age=3600, stale-while-revalidate=86400' : IS_PUBLIC ? 'public, no-cache' : 'no-cache'
  })
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }

  // Safari не проигрывает звук без ответов на запросы диапазонов
  const range = /^bytes=(\d*)-(\d*)$/.exec(getRequestHeader(event, 'range') || '')
  if (range && (range[1] || range[2])) {
    const size = stat.size
    let start = range[1] ? Number(range[1]) : size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    start = Math.max(0, start); end = Math.min(size - 1, end)
    if (start > end) {
      setResponseHeader(event, 'content-range', `bytes */${size}`)
      throw createError({ statusCode: 416, statusMessage: 'Неверный диапазон' })
    }
    setResponseStatus(event, 206)
    setResponseHeaders(event, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
    if (event.method === 'HEAD') return headOnly(event)
    return sendStream(event, createReadStream(path, { start, end }))
  }

  setResponseHeader(event, 'content-length', stat.size)
  if (event.method === 'HEAD') return headOnly(event)
  return sendStream(event, createReadStream(path))
}
