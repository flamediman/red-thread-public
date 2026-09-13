import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './data-dir'

interface Photo {
  data: Buffer
  type: string
}

/** В памяти — по id игрока (так отдаём в /api/photo/:id), на диске — по токену (он переживает перезапуск). */
const photos = new Map<string, Photo>()
const DIR = join(DATA_DIR, 'photos')
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const TYPE: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export const MAX_PHOTO_BYTES = 400_000

function safe(token: string) {
  return /^[a-z0-9]{6,32}$/i.test(token)
}

export function savePhoto(playerId: string, token: string, dataUrl: string): boolean {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) return false
  const data = Buffer.from(match[2]!, 'base64')
  if (!data.length || data.length > MAX_PHOTO_BYTES) return false
  const type = match[1]!
  photos.set(playerId, { data, type })

  if (safe(token)) {
    try {
      mkdirSync(DIR, { recursive: true })
      for (const ext of Object.keys(TYPE)) {
        const old = join(DIR, `${token}.${ext}`)
        if (existsSync(old)) unlinkSync(old)
      }
      writeFileSync(join(DIR, `${token}.${EXT[type]}`), data)
    } catch (e) {
      console.warn('фото не записалось на диск:', (e as Error).message)
    }
  }
  return true
}

/** Игрок вернулся после перезапуска сервера — поднимаем его фото с диска. */
export function restorePhoto(token: string, playerId: string): boolean {
  if (!safe(token)) return false
  for (const [ext, type] of Object.entries(TYPE)) {
    const file = join(DIR, `${token}.${ext}`)
    if (!existsSync(file)) continue
    try {
      photos.set(playerId, { data: readFileSync(file), type })
      return true
    } catch { /* нечитаемый файл — считаем, что фото нет */ }
  }
  return false
}

export function getPhoto(playerId: string): Photo | null {
  return photos.get(playerId) ?? null
}

export function dropPhoto(playerId: string, token?: string | null) {
  photos.delete(playerId)
  if (!token || !safe(token)) return
  for (const ext of Object.keys(TYPE)) {
    try {
      const file = join(DIR, `${token}.${ext}`)
      if (existsSync(file)) unlinkSync(file)
    } catch { /* уже нет — и ладно */ }
  }
}
