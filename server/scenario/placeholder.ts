/* Заглушка на случай, когда папка cases/ пуста: движку нужно хоть какое-то дело, чтобы стартовать.
   В меню она не попадает — экран показывает, как подключить репозиторий дел. */
import type { CaseInfo, CaseScenario, AmbienceCue } from '../../shared/types'

const quiet: AmbienceCue = { names: [] }
const beat = { id: 'none', speaker: 'narrator', text: '' }

const info: CaseInfo = {
  id: 'none',
  settingId: 'noir',
  title: 'Дела не подключены',
  subtitle: '',
  players: '2–10',
  minutes: '',
  ready: false,
  stamp: '',
  date: '',
  lede: '',
  clock: { start: '23:00', end: '06:00' },
  countdown: '',
  timeUp: '',
  helper: { name: '', role: '', hints: '' },
  stage: { discuss: 'none', accuse: 'none', outdoors: [], gather: '' },
  weather: 'none',
  lightning: false,
  ambience: { lobby: quiet, early: quiet, mid: quiet, late: quiet, accuse: quiet, ending: quiet },
  outcomes: {
    short: { solved: '', partial: '', failed: '' },
    failedTitle: '', failedSub: '', partialSub: '',
    solvedSub: { gold: '', silver: '', bronze: '' },
    dawnAccuse: '', phoneFailed: ''
  },
  lines: { idle: '', noName: '', wrong: '', lost: '' }
}

const scenario: CaseScenario = {
  id: 'none',
  title: info.title,
  scheduleLength: 1,
  clock: { start: '23:00', dawn: '06:00' },
  prologue: [],
  locations: [{ id: 'none', name: '', floor: 1, x: 0, y: 0, w: 1, h: 1, adjacent: [], surface: 'wood' }],
  witnesses: [], spots: [], items: [], questions: [], presentations: [], facts: [], contradictions: [],
  overheard: [], backgrounds: {}, hints: [],
  accusation: { methods: [], motives: [], solution: { culprit: '', method: '', motive: '' }, accomplices: [], defenses: {} },
  epilogue: { truth: [], branch: { itemId: '', found: [], lost: [] }, closing: beat },
  voices: { narrator: '', inspector: '' },
  floors: [{ id: 1, label: '' }]
}

export const PLACEHOLDER = { info, scenario }
