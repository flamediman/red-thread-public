// Где лежат файлы для инструментов генерации.
//   <CASES_DIR>/<дело>/    — дело из репозитория red-thread-secret: сценарий, art/, voice/, music/, prompts/
//   media/art/<мир>/       — портреты бригады мира (d_*.jpg)
//   media/art/settings/    — ключевые арты миров для меню
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { casesDir } from './cases-registry.mjs'

export const root = resolve(import.meta.dirname, '..')
export const caseDir = id => resolve(casesDir(root), id)

/** Папка картинок: CASE=settings — арты миров, иначе — дело; портреты сыщиков d_* — в папку мира */
export const artDir = id => id === 'settings' ? resolve(root, 'media/art/settings') : resolve(caseDir(id), 'art')
export const worldArtDir = world => resolve(root, 'media/art', world)
export const voiceDir = id => resolve(caseDir(id), 'voice')
export const musicDir = id => resolve(caseDir(id), 'music')

/** Набор картинок: промпты дела лежат рядом со сценарием, промпты миров — в tools/art-settings.mjs */
export const loadArtSet = id => import(id === 'settings'
  ? pathToFileURL(resolve(root, 'tools/art-settings.mjs')).href
  : pathToFileURL(resolve(caseDir(id), 'prompts/art.mjs')).href)

export const loadMusicSet = id => import(pathToFileURL(resolve(caseDir(id), 'prompts/music.mjs')).href)

/** Ключи из .env (в git не попадает) */
export function readEnv() {
  try {
    return Object.fromEntries(readFileSync(resolve(root, '.env'), 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
  } catch { return {} }
}
