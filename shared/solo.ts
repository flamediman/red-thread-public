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
  /** крупный план: пока это последнее, что игрок узнал, большой кадр места сменяется этой картинкой */
  art?: string
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

export type SoloQteKey = 'up' | 'down' | 'left' | 'right'
/** точка быстрого нажатия: стрелка, место на арене в процентах, окно по часам сервера, итог */
export interface SoloQtePrompt { id: number; key: SoloQteKey; x: number; y: number; from: number; to: number; result: 'hit' | 'miss' | null }

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
  /** местность для карты: вода, лес, улицы, дома без входа, подписи; места рисуются сами по своим прямоугольникам */
  map?: SoloAreaMap
}

/** Схема района в духе городского навигатора. Координаты — проценты плана (0–100 по ширине и по высоте), как у мест. */
export interface SoloAreaMap {
  /** вода, лес, газоны: контуры в синтаксисе SVG path */
  water?: string[]
  forest?: string[]
  grass?: string[]
  /** улицы и дороги: ломаные «x,y x,y …» */
  roads?: string[]
  /** тропы и дорожки */
  paths?: string[]
  /** дома, куда не зайти, — чтобы посёлок выглядел посёлком: [x, y, ширина, высота] */
  blocks?: [number, number, number, number][]
  /** этажи здания: подложка с подписью */
  floors?: { x: number; y: number; w: number; h: number; label: string }[]
  /** подписи местности; rotate — в градусах */
  labels?: { x: number; y: number; text: string; kind?: 'water' | 'street' | 'area'; rotate?: number }[]
  /** мелочи для духа места: tree, bush, lamp, bench, statue, busstop, barrier, boat, pier, flagpole, sign, mast, truck; size — в процентах высоты */
  props?: { kind: string; x: number; y: number; rotate?: number; size?: number }[]
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
  /** значок места на карте: post, shop, food, culture, radio, phone, road, barrier, bridge, monument, yard, anchor, gate, door, book, stairs, medical, office, bed, water, tunnel, boat, flag */
  poi?: string
}

export type SoloPuzzle =
  | { kind: 'code'; prompt: string; length: number; alphabet: 'digits' | 'letters'; answer: string; success: SoloEffect; fail: string; art?: string }
  | { kind: 'dials'; prompt: string; dials: { label: string; values: string[] }[]; answer: string[]; success: SoloEffect; fail: string; art?: string }
  | { kind: 'sequence'; prompt: string; buttons: { id: string; label: string }[]; answer: string[]; success: SoloEffect; fail: string; art?: string }
  | { kind: 'word'; prompt: string; answers: string[]; success: SoloEffect; fail: string; art?: string }
/* art у головоломки — крупный план того, что открываем; без цифр и букв, чтобы картинка не подсказывала ответ */

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

/** luck — оберег: одноразовый второй бросок, если укрытие подвело */
export type SoloItemKind = 'key' | 'tool' | 'weapon' | 'ammo' | 'heal' | 'battery' | 'story' | 'luck'

export interface SoloItem {
  id: string
  name: string
  description: string
  kind: SoloItemKind
  /** значок в карманах (flashlight, radio, key, letter, pipe, bandage, pills, battery); без него — по виду предмета */
  icon?: string
  /** картинка предмета для карточки находки и карманов; без неё — i_<id> */
  art?: string
  /** расходник: сколько лечит / сколько заряда / сколько патронов */
  amount?: number
  /** оружие: accuracy — ширина окон удара (0…1), zones — сколько окон за раунд (по умолчанию 1), tempo — замедление
      времени раунда (1.3 — раунд на треть длиннее); usesAmmo — стреляет патронами */
  weapon?: { damage: number; accuracy: number; usesAmmo?: boolean; loud?: boolean; zones?: number; tempo?: number }
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
  /** ширина окна побега, 0…1 */
  evade: number
  /** насколько существо сужает окна удара, 0…1 (вёрткое — 0.3, неповоротливое — 0) */
  guard?: number
  /** шанс ответить ударом на ваш удачный удар, 0…1: крепкие существа выматывают, если бить голыми руками */
  riposte?: number
  /** от него не спрятаться (укрытие закрыто) */
  noHide?: boolean
  /** приёмник его не ловит: появляется без предупреждения */
  silent?: boolean
  /** с каждым раундом торопится: длина раунда умножается на hurry (0.85 — на 15 % короче каждый раунд), не короче 3,5 с */
  hurry?: number
  /** уворот от удара: через случайную паузу вспыхивает точка со стрелкой (points — сколько подряд), окно каждой ms;
      поймали все — урона нет. Без поля — одна точка на секунду */
  dodge?: { ms: number; points?: number }
  /** его удар оглушает героя на раунд: окна уже, бежать нельзя (горн в ухо, свисток) */
  stuns?: boolean
  /** иногда (chance) вместо удара — захват: presses быстрых нажатий за ms, чтобы вырваться. Вырвались — четверть урона,
      нет — полтора. text — захват, free — вырвались, held — не вырвались */
  grapple?: { chance: number; ms: number; presses: number; text: string; free: string; held: string }
  /** его нельзя оглушить точным ударом (толпа, вода) */
  unstunnable?: boolean
  sfx: { near: string; attack: string; hurt: string; die: string }
  /** strike — замах перед ударом (виден, пока идёт уворот); dodge — удар прошёл мимо; stagger — оглушено точным ударом;
      recover — приходит в себя; daze — герой оглушён его ударом; guard/press/circle — как оно ведёт себя в раунде
      (прикрывается после ваших попаданий, торопится, когда вы слабы, кружит и выжидает) */
  text: { appear: string; attack: string; hit: string; miss: string; die: string; hide: string; flee: string; fleeFail: string; hideFail?: string; strike?: string; dodge?: string; stagger?: string; recover?: string; daze?: string; guard?: string; press?: string; circle?: string }
}

/** Босс: серии быстрых нажатий. На экране одна за другой вспыхивают точки со стрелкой: на компьютере — нажать эту
    стрелку, на планшете — коснуться точки, пока кольцо вокруг неё не сомкнулось. Поймали need из series — босс теряет hit;
    нет — бьёт он. Фазы по здоровью меняют текст и темп. */
export interface SoloBoss {
  id: string
  name: string
  /** картинка на весь экран: m_<art>; без неё — m_<id> */
  art?: string
  hp: number
  damage: number
  /** точек в серии, сколько нужно поймать, окно каждой точки в мс */
  series: number
  need: number
  promptMs: number
  /** урон боссу за удачную серию */
  hit: number
  phases?: { below: number; text: string; series?: number; need?: number; promptMs?: number }[]
  sfx: { near: string; attack: string; hurt: string; die: string }
  text: { appear: string; hit: string; miss: string; die: string }
  /** после победы */
  success?: SoloEffect
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
  /** существо или босс (одно из двух) */
  monster?: string
  boss?: string
  place: string
  when?: SoloCond
  /** от кого спрятались, тот уходит и больше не появляется (убежали — вернётся при следующем входе); stays — караулит место и встречает снова */
  stays?: boolean
  /** когда выходит: enter — сразу при входе (по умолчанию); act — после осмотра или действия здесь (after — именно этой
      точки; с afterMs — через паузу, но не позже, чем игрок соберётся уходить); linger — через afterMs миллисекунд,
      если игрок всё ещё здесь и ничем не занят (ушёл раньше — не выйдет) */
  trigger?: 'enter' | 'act' | 'linger'
  after?: string
  afterMs?: number
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
/** again — узел, с которого разговор начинается во второй раз и куда ведёт «Дальше» из веток: без него персонаж
    здоровался бы заново при каждом возврате к вопросам */
export interface SoloDialogue { id: string; npc: string; start: string; again?: string; nodes: Record<string, SoloDialogueNode> }

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
  bosses?: SoloBoss[]
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
  inventory: { id: string; name: string; description: string; kind: SoloItemKind; icon: string; art: string; count: number; equipped: boolean; usable: boolean }[]
  notes: SoloNote[]
  health: number
  battery: number
  light: boolean
  ammo: number
  /** шипение радио: 0 — тихо, 1 — где-то рядом, 2 — здесь */
  radio: 0 | 1 | 2
  /** приёмник включён (выключенный молчит) */
  radioOn: boolean
  otherworld: boolean
  weapon: string | null
  map: { areas: SoloArea[]; places: { id: string; area: string; name: string; x: number; y: number; w: number; h: number; outdoor: boolean; surface: string; poi: string; visited: boolean; here: boolean; save: boolean; locked: boolean }[]; links: [string, string][] }
  /** последствия последнего действия — показать и озвучить; art — крупный план осмотра, found — предмет попал в карманы */
  feed: { seq: number; text: string; sfx?: string[]; voice?: string; art?: string; found?: { id: string; name: string; description: string; art: string } }[]
  scene: { seq: number; lines: SoloLine[] } | null
  encounter: {
    monster: string; name: string; hp: number; maxHp: number; round: number
    startedAt: number; deadline: number; serverNow: number
    /** длина раунда и окна на его полосе (время по часам сервера): в hit — удар попадает, в flee — уходишь без урона */
    windowMs: number
    zones: { hit: [number, number][]; flee: [number, number] | null }
    text: string
    /** hint — что делает действие и почему может не сработать; показывается под кнопкой */
    options: { id: 'fight' | 'shoot' | 'flee' | 'hide' | 'light'; label: string; enabled: boolean; hint?: string }[]
    /** существо бьёт: точки уворота (как у босса); пока они есть, полоса раунда стоит */
    dodge: { prompts: SoloQtePrompt[]; deadline: number } | null
    /** существо оглушено точным ударом (окна шире, ответа не будет) / герой оглушён (окна уже, бежать нельзя) */
    stunned: boolean
    dazed: boolean
    /** захват: жать быстро — presses из need до deadline */
    grapple: { deadline: number; presses: number; need: number } | null
    /** как существо ведёт себя в этом раунде */
    mode: 'normal' | 'guard' | 'press' | 'circle'
  } | null
  puzzle: { hotspot: string; puzzle: SoloPublicPuzzle } | null
  boss: {
    id: string; name: string; art: string; hp: number; maxHp: number; round: number; text: string
    startedAt: number; deadline: number; serverNow: number
    /** точки серии по часам сервера: key — стрелка, x/y — место на арене в процентах, result — как сыграна */
    prompts: SoloQtePrompt[]
    need: number
    /** итог прошлой серии */
    last: 'hit' | 'miss' | null
  } | null
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
  /** приёмник: выключить, чтобы не шипел (и не подсказывал) */
  | { type: 'radio'; on: boolean }
  | { type: 'equip'; item: string }
  | { type: 'heal'; item: string }
  /** at — время нажатия по часам сервера (клиент знает сдвиг): так пинг не съедает окно */
  | { type: 'act'; action: 'fight' | 'shoot' | 'flee' | 'hide'; at?: number }
  | { type: 'run'; index: number }
  /** босс: нажата стрелка (или точка) с номером id */
  | { type: 'qte'; id: number; key: SoloQteKey; at?: number }
  /** захват: одно быстрое нажатие */
  | { type: 'mash' }
  /** вкладка ушла в фон или вернулась: часы встречи и погони стоят, пока игрок не смотрит */
  | { type: 'away'; on: boolean }

export type SoloServerMessage =
  | { type: 'view'; view: SoloView }
  | { type: 'error'; reason: string }
