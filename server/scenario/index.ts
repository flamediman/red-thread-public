/* Каталог «Красной нити»: миры и дела.
   Новый мир — файл server/settings/<id>.ts (описание + своя бригада) и строка в SETTINGS.
   Дела — отдельный репозиторий (папка из CASES_DIR, по умолчанию cases/): каждое дело — <id>/index.ts
   с INFO и SCENARIO. Список собирается сам (tools/cases-registry.mjs → cases.gen.ts). */
import type { CaseInfo, CaseScenario, DetectiveRole, Scenario, SettingInfo, SoloInfo, SoloStory } from '../../shared/types'
import { NOIR, DETECTIVES as NOIR_BRIGADE } from '../settings/noir'
import { NEON, DETECTIVES as NEON_BRIGADE } from '../settings/neon'
import { TUMAN } from '../settings/tuman'
import { CASE_MODULES } from './cases.gen'
import { PLACEHOLDER } from './placeholder'

export interface CaseEntry { info: CaseInfo; scenario: Scenario }

export const SETTINGS: Record<string, SettingInfo> = { noir: NOIR, neon: NEON }
/** бригада сыщиков у каждого мира своя, дела её не задают */
const BRIGADES: Record<string, DetectiveRole[]> = { noir: NOIR_BRIGADE, neon: NEON_BRIGADE }

const withBrigade = (info: CaseInfo, s: CaseScenario): Scenario => ({ ...s, detectives: BRIGADES[info.settingId]! })

/** номер дела из штампа «Дело № 2» — порядок внутри мира */
const caseNo = (info: CaseInfo) => Number(/\d+/.exec(info.stamp)?.[0] ?? 99)

export const CASES: Record<string, CaseEntry> = Object.fromEntries(
  Object.values(CASE_MODULES)
    .filter((m): m is { INFO: CaseInfo; SCENARIO: CaseScenario } => !!m.INFO && !!m.SCENARIO && !!SETTINGS[m.INFO.settingId])
    .sort((a, b) => caseNo(a.INFO) - caseNo(b.INFO) || a.INFO.title.localeCompare(b.INFO.title))
    .map(m => [m.INFO.id, { info: m.INFO, scenario: withBrigade(m.INFO, m.SCENARIO) }])
)

/** одиночные истории: мир «Туман» и другие миры без бригады */
export const SOLO_SETTINGS: Record<string, SettingInfo> = { tuman: TUMAN }
export const SOLO_STORIES: Record<string, { info: SoloInfo; story: SoloStory }> = Object.fromEntries(
  Object.values(CASE_MODULES)
    .filter((m): m is { SOLO_INFO: SoloInfo; SOLO: SoloStory } => !!m.SOLO_INFO && !!m.SOLO)
    .map(m => [m.SOLO_INFO.id, { info: m.SOLO_INFO, story: m.SOLO }])
)

export const HAS_CASES = Object.keys(CASES).length > 0
/** Без дел движок держит пустую заглушку: меню покажет, как подключить репозиторий дел */
export const DEFAULT_CASE = Object.keys(CASES)[0] ?? PLACEHOLDER.info.id
const PLACEHOLDER_ENTRY: CaseEntry = { info: PLACEHOLDER.info, scenario: withBrigade(PLACEHOLDER.info, PLACEHOLDER.scenario) }
if (!HAS_CASES) CASES[PLACEHOLDER.info.id] = PLACEHOLDER_ENTRY

/** Меню: миры по порядку, внутри — дела. Каталог не меняется, пока сервер работает, — считается один раз. */
let catalogCache: ReturnType<typeof buildCatalog> | null = null
export function catalog() { return (catalogCache ??= buildCatalog()) }

function buildCatalog() {
  const group = Object.values(SETTINGS).map(setting => {
    const entries = Object.values(CASES).filter(c => c.info.settingId === setting.id && c !== PLACEHOLDER_ENTRY)
    return {
      setting,
      cases: entries.map(c => c.info),
      /** бригада мира — портреты в меню */
      detectives: entries[0]?.scenario.detectives.map(d => d.id) ?? [],
      solo: [] as SoloInfo[]
    }
  })
  // одиночные миры — в той же карусели, но истории открываются на своей странице
  const solo = Object.values(SOLO_SETTINGS).map(setting => ({
    setting, cases: [] as CaseInfo[], detectives: [] as string[],
    solo: Object.values(SOLO_STORIES).map(s => s.info).filter(i => i.settingId === setting.id)
  }))
  return [...group, ...solo].filter(g => g.cases.length || g.solo.length)
}

/* совместимость для инструментов (voice.ts, check-scenario.ts): дело из переменной CASE или первое */
const toolCase = CASES[(typeof process !== 'undefined' && process.env.CASE) || DEFAULT_CASE] ?? CASES[DEFAULT_CASE]!
export const SCENARIO: Scenario = toolCase.scenario
export const CASE_INFO: CaseInfo = toolCase.info
