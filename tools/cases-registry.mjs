// Список дел для сборки: сканирует папку дел и пишет server/scenario/cases.gen.ts.
// Папка дел — CASES_DIR (переменная окружения или строка в .env), по умолчанию cases/ в корне.
// Вызывается из nuxt.config.ts при каждом запуске dev/build/prepare; вручную — node tools/cases-registry.mjs.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** CASES_DIR из окружения, иначе из .env, иначе cases/ */
export function casesDir(root = ROOT) {
  let dir = process.env.CASES_DIR
  if (!dir) {
    try {
      const line = readFileSync(resolve(root, '.env'), 'utf8').split('\n').find(l => /^\s*CASES_DIR\s*=/.test(l))
      dir = line?.slice(line.indexOf('=') + 1).trim()
    } catch { /* .env нет — берём папку по умолчанию */ }
  }
  return resolve(root, dir || 'cases')
}

export function writeCaseRegistry(root = ROOT) {
  const dir = casesDir(root)
  const ids = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^[a-z0-9-]+$/.test(d.name) && existsSync(resolve(dir, d.name, 'index.ts')))
      .map(d => d.name).sort()
    : []
  const out = resolve(root, 'server/scenario')
  const name = id => `c_${id.replace(/-/g, '_')}`
  const from = id => {
    const rel = relative(out, resolve(dir, id, 'index')).split('\\').join('/')
    return rel.startsWith('.') ? rel : `./${rel}`
  }
  const code = [
    '// Сгенерировано tools/cases-registry.mjs из папки дел — не править руками, в git не попадает.',
    "import type { CaseInfo, CaseScenario, SoloInfo, SoloStory } from '../../shared/types'",
    ...ids.map(id => `import * as ${name(id)} from '${from(id)}'`),
    '',
    '/** дело для компании (INFO + SCENARIO) или одиночная история (SOLO_INFO + SOLO) */',
    'export const CASE_MODULES: Record<string, { INFO?: CaseInfo; SCENARIO?: CaseScenario; SOLO_INFO?: SoloInfo; SOLO?: SoloStory }> = {',
    ...ids.map(id => `  '${id}': ${name(id)},`),
    '}',
    ''
  ].join('\n')
  const file = resolve(out, 'cases.gen.ts')
  mkdirSync(out, { recursive: true })
  // не трогаем файл без изменений — иначе dev-сервер перезапускается по кругу
  if (!existsSync(file) || readFileSync(file, 'utf8') !== code) writeFileSync(file, code)
  return { dir, ids }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dir, ids } = writeCaseRegistry()
  console.log(ids.length ? `дела (${dir}): ${ids.join(', ')}` : `в ${dir} нет дел — меню покажет, как их подключить`)
}
