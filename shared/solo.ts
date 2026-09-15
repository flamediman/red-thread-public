/* ──────────────────────────────────────────────────────────────
   Одиночная игра («Туман»): исследование, предметы, головоломки, встречи в настоящем времени.
   История целиком (с разгадкой) живёт только на сервере; клиенту уходит срез того, что игрок видит.
   ────────────────────────────────────────────────────────────── */

/** условие: всё перечисленное должно выполняться */
export interface SoloCond {
  flags?: string[]
  notFlags?: string[]
  items?: string[]
  notItems?: string[]
  /** только на изнанке (true) или только в обычном мире (false) */
  otherworld?: boolean
  /** метрики концовок: не меньше указанного */
  score?: Record<string, number>
  /** метрики концовок: строго меньше указанного */
  scoreBelow?: Record<string, number>
}

/** реплика сцены или разговора; speaker — 'narrator', 'hero' или id персонажа */
export interface SoloLine {
  /** id файла озвучки: проставляется при загрузке истории (см. server/game/solo-lines.ts) */
  id?: string
  speaker: string
  text: string
  /** текст для озвучки, если читать нужно не то, что на экране */
  voice?: string
  /** обработка файла озвучки: громкоговоритель или магнитофонная лента */
  fx?: 'loudspeaker' | 'tape'
  /** картинка на весь экран на время реплики */
  art?: string
  sfx?: string[]
}

/** последствие действия игрока */
export interface SoloEffect {
  text?: string
  voice?: string
  sfx?: string[]
  /** сцена на весь экран — несколько реплик подряд */
  scene?: SoloLine[]
  give?: string[]
  take?: string[]
  set?: string[]
  unset?: string[]
  /** записка в журнал */
  note?: string
  heal?: number
  hurt?: number
  battery?: number
  ammo?: number
  /** метрики концовок: что герой делает со своей памятью */
  score?: Record<string, number>
  /** сразу — встреча с существом (id появления) */
  encounter?: string
  /** сразу — погоня (id погони) */
  chase?: string
  /** начать разговор (id разговора) — после сцены */
  talk?: string
  /** перенос в другое место */
  goto?: string
  /** включить или выключить изнанку */
  otherworld?: boolean
  /** финал: id концовки или 'auto' — по правилам */
  ending?: string
}

export interface SoloText { when?: SoloCond; text: string; voice?: string }

export interface SoloExit {
  to: string
  label: string
  when?: SoloCond
  lock?: { item?: string; flag?: string; text: string; consume?: boolean; open?: SoloEffect }
  sfx?: string[]
}

export interface SoloArea {
  id: string
  name: string
  /** пропорции плана района или здания (ширина/высота) */
  aspect: number
}

export interface SoloPlace {
  id: string
  area: string
  name: string
  /** прямоугольник на плане района, в процентах */
  x: number; y: number; w: number; h: number
  text: SoloText[]
  exits: SoloExit[]
  /** темно: без фонаря не видно, что тут есть */
  dark?: boolean
  /** под открытым небом: атмосфера звучит без «стекла» */
  outdoor?: boolean
  surface?: 'asphalt' | 'wood' | 'tile' | 'water' | 'grass'
  ambience?: string[]
  /** звуки места на изнанке; без них — обычные */
  otherAmbience?: string[]
  /** здесь можно сохраниться: что это за место */
  save?: string
  /** здесь можно спрятаться: где */
  hide?: string
  /** картинка: l_<art ?? id> */
  art?: string
  /** у места есть картинка изнанки o_<art ?? id> */
  other?: boolean
  /** первое посещение */
  enter?: SoloEffect
}

export type SoloPuzzle =
  | { kind: 'code'; prompt: string; length: number; alphabet: 'digits' | 'letters'; answer: string; success: SoloEffect; fail: string }
  | { kind: 'dials'; prompt: string; dials: { label: string; values: string[] }[]; answer: string[]; success: SoloEffect; fail: string }
  | { kind: 'sequence'; prompt: string; buttons: { id: string; label: string }[]; answer: string[]; success: SoloEffect; fail: string }
  | { kind: 'word'; prompt: string; answers: string[]; success: SoloEffect; fail: string }

/** головоломка без ответа — то, что уходит клиенту */
export type SoloPublicPuzzle = SoloPuzzle extends infer P ? P extends SoloPuzzle ? Omit<P, 'answer' | 'answers' | 'success'> : never : never

export interface SoloHotspot {
  id: string
  place: string
  name: string
  when?: SoloCond
  /** в темноте без фонаря не видно */
  needsLight?: boolean
  /** осмотр; once — после первого раза показывается after и эффект не повторяется */
  look?: SoloEffect & { once?: boolean; after?: string }
  /** использовать предмет */
  use?: { item: string; effect: SoloEffect; once?: boolean }[]
  /** что сказать, если применили не тот предмет */
  wrong?: string
  puzzle?: SoloPuzzle
  /** разговор с персонажем */
  talk?: string
  /** исчезает, когда выполнено */
  hideWhen?: SoloCond
}

export type SoloItemKind = 'key' | 'tool' | 'weapon' | 'ammo' | 'heal' | 'battery' | 'story'

export interface SoloItem {
  id: string
  name: string
  description: string
  kind: SoloItemKind
  /** значок в карманах (flashlight, radio, key, letter, pipe, bandage, pills, battery); без него — по виду предмета */
  icon?: string
  /** расходник: сколько лечит / сколько заряда / сколько патронов */
  amount?: number
  weapon?: { damage: number; accuracy: number; usesAmmo?: boolean; loud?: boolean }
  /** соединить с другим предметом */
  combine?: { with: string; result: string; text: string }[]
}

export interface SoloNote { id: string; title: string; text: string; voice?: string }

export interface SoloMonster {
  id: string
  name: string
  hp: number
  damage: number
  /** сколько миллисекунд у игрока на решение, пока существо не ударит */
  windowMs: number
  /** идёт на свет: с фонарём спрятаться не выйдет */
  seesLight?: boolean
  /** шанс проскочить мимо, 0…1 */
  evade: number
  sfx: { near: string; attack: string; hurt: string; die: string }
  text: { appear: string; attack: string; hit: string; miss: string; die: string; hide: string; flee: string; fleeFail: string }
}

/** Погоня: от этого не отбиться. Несколько шагов подряд, на каждом — секунды, чтобы выбрать, куда бежать.
    Неверный выбор или промедление — удар, шаг повторяется; последний шаг пройден — эффект success. */
export interface SoloChase {
  id: string
  name: string
  /** картинка на весь экран: m_<art> */
  art: string
  windowMs: number
  damage: number
  sfx: { near: string; hit: string; run: string }
  /** что происходит, если игрок медлит */
  late: string
  steps: { text: string; options: { label: string; right?: boolean; text?: string }[] }[]
  success: SoloEffect
}

export interface SoloSpawn {
  id: string
  monster: string
  place: string
  when?: SoloCond
  /** от кого спрятались или убежали, тот уходит и больше не появляется; stays — караулит место и встречает снова */
  stays?: boolean
}

export interface SoloNpc {
  id: string
  name: string
  voiceId?: string
  /** все реплики персонажа звучат через громкоговоритель или с ленты */
  fx?: 'loudspeaker' | 'tape'
  /** сдвиг высоты голоса при озвучке (1.1 — на десятую выше: детский голос из взрослого) */
  pitch?: number
}

export interface SoloDialogueNode {
  lines: SoloLine[]
  effect?: SoloEffect
  choices?: { text: string; to?: string; when?: SoloCond; effect?: SoloEffect }[]
}
export interface SoloDialogue { id: string; npc: string; start: string; nodes: Record<string, SoloDialogueNode> }

export interface SoloEnding { id: string; title: string; scene: SoloLine[] }

export interface SoloStory {
  id: string
  title: string
  start: { place: string; items: string[]; notes?: string[]; health: number; battery: number; ammo: number; flags?: string[]; scene: SoloLine[] }
  areas: SoloArea[]
  places: SoloPlace[]
  hotspots: SoloHotspot[]
  items: SoloItem[]
  notes: SoloNote[]
  monsters: SoloMonster[]
  spawns: SoloSpawn[]
  chases?: SoloChase[]
  npcs: SoloNpc[]
  dialogues: SoloDialogue[]
  endings: SoloEnding[]
  /** концовка 'auto': первое подходящее правило; score — не меньше указанного */
  endingRules: { ending: string; when?: SoloCond; score?: Record<string, number> }[]
  /** что в кадре главное, если кадр режется под узкий экран: имя картинки → object-position («86% 40%») */
  artFocus?: Record<string, string>
  voices: { narrator: string; hero: string }
}

export interface SoloInfo {
  id: string
  settingId: string
  title: string
  subtitle: string
  lede: string
  date: string
  minutes: string
  ready: boolean
  /** имя героя — подпись к его репликам */
  hero: string
  /** экран гибели: строка над заголовком и заголовок */
  death: { note: string; title: string }
}

/* ── публичное состояние ── */

export interface SoloView {
  build: string
  info: SoloInfo
  /** подписи к репликам сцен: id персонажа → имя */
  speakers: Record<string, string>
  /** главная точка кадра для узких экранов: имя картинки → object-position */
  artFocus: Record<string, string>
  /** нет партии — только меню */
  started: boolean
  place: {
    id: string; area: string; name: string; art: string; text: string[]
    dark: boolean; lit: boolean; outdoor: boolean; save: string | null; hide: string | null; ambience: string[]; surface: string
  } | null
  exits: { to: string; label: string; locked: string | null; known: boolean }[]
  hotspots: { id: string; name: string; kind: 'look' | 'puzzle' | 'talk'; done: boolean }[]
  inventory: { id: string; name: string; description: string; kind: SoloItemKind; icon: string; count: number; equipped: boolean; usable: boolean }[]
  notes: SoloNote[]
  health: number
  battery: number
  light: boolean
  ammo: number
  /** шипение радио: 0 — тихо, 1 — где-то рядом, 2 — здесь */
  radio: 0 | 1 | 2
  otherworld: boolean
  weapon: string | null
  map: { areas: SoloArea[]; places: { id: string; area: string; name: string; x: number; y: number; w: number; h: number; visited: boolean; here: boolean; save: boolean; locked: boolean }[]; links: [string, string][] }
  /** последствия последнего действия — показать и озвучить */
  feed: { seq: number; text: string; sfx?: string[]; voice?: string }[]
  scene: { seq: number; lines: SoloLine[] } | null
  encounter: {
    monster: string; name: string; hp: number; maxHp: number; round: number
    startedAt: number; deadline: number; serverNow: number
    text: string
    options: { id: 'fight' | 'shoot' | 'flee' | 'hide' | 'light'; label: string; enabled: boolean }[]
  } | null
  puzzle: { hotspot: string; puzzle: SoloPublicPuzzle } | null
  chase: {
    id: string; name: string; art: string; step: number; total: number; text: string
    startedAt: number; deadline: number; serverNow: number
    options: { index: number; label: string }[]
  } | null
  dialogue: { id: string; npc: string; name: string; lines: SoloLine[]; choices: { index: number; text: string }[] } | null
  dead: boolean
  ending: { id: string; title: string; lines: SoloLine[]; stats: { minutes: number; saves: number; deaths: number; kills: number } } | null
  saves: { slot: number; place: string; at: string; minutes: number }[]
  canSave: boolean
}

export type SoloClientMessage =
  | { type: 'hello'; token: string; story?: string }
  | { type: 'new' }
  | { type: 'load'; slot: number }
  | { type: 'save'; slot: number }
  | { type: 'go'; to: string }
  | { type: 'look'; hotspot: string }
  | { type: 'use'; item: string; hotspot?: string }
  | { type: 'combine'; item: string; with: string }
  | { type: 'solve'; hotspot: string; answer: string[] }
  | { type: 'closePuzzle' }
  | { type: 'choose'; index: number }
  | { type: 'sceneDone'; seq: number }
  | { type: 'light'; on: boolean }
  | { type: 'equip'; item: string }
  | { type: 'heal'; item: string }
  | { type: 'act'; action: 'fight' | 'shoot' | 'flee' | 'hide' }
  | { type: 'run'; index: number }
  /** вкладка ушла в фон или вернулась: часы встречи и погони стоят, пока игрок не смотрит */
  | { type: 'away'; on: boolean }

export type SoloServerMessage =
  | { type: 'view'; view: SoloView }
  | { type: 'error'; reason: string }
