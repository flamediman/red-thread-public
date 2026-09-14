/* ──────────────────────────────────────────────────────────────
   Общие типы «Красной нити».
   Сценарий целиком (с разгадкой) живёт только на сервере;
   клиенту уходят публичные срезы без спойлеров.
   ────────────────────────────────────────────────────────────── */

export type Mood = 'calm' | 'nervous' | 'evasive' | 'grief' | 'angry' | 'drunk' | 'warm'

/** Реплика, которую произносит экран: рассказчик, инспектор по телефону или свидетель. */
export interface Beat {
  id: string
  /** 'narrator' | 'inspector' | id свидетеля */
  speaker: string
  /** чистый текст для экрана */
  text: string
  /** текст для озвучки с эмоциональными пометками; если нет — берётся text */
  voice?: string
  mood?: Mood
  /** звуки, которые играют вместе с репликой */
  sfx?: string[]
  /** пауза после реплики, мс */
  pauseAfter?: number
  /** где это происходит — экран показывает фото локации */
  locationId?: string
  /** предмет, который в этот момент ложится в улики — экран показывает фото */
  itemId?: string
  itemName?: string
  /** чей это ход */
  playerId?: string
  /** карточки доски, которые ложатся вместе с этой репликой: до неё экран и телефоны их не показывают */
  facts?: string[]
  /** противоречия, которые натягиваются этой репликой */
  links?: string[]
}

/* ── Сыщики ─────────────────────────────────────────────────── */

export type AbilityKind =
  | 'forensic'      // криминалист: видит второй слой при осмотре
  | 'psychologist'  // психолог: видит, врёт ли свидетель на его вопрос
  | 'investigator'  // следователь: два вопроса за ход
  | 'coroner'       // судмедэксперт: точное время смерти при осмотре тела
  | 'reporter'      // репортёр: факт из прошлого свидетеля
  | 'inspector'     // инспектор в отставке: открыть запертый вопрос
  | 'intern'        // стажёр: подслушать разговор
  | 'archivist'     // архивариус: где искать то, что противоречит карточке
  | 'burglar'       // взломщик: открыть запертое место осмотра
  | 'patrol'        // патрульный: вызвать на допрос свидетеля из любой комнаты
  /* неон */
  | 'netrunner'     // нетраннер: вскрывает цифровые замки
  | 'braindance'    // брейнданс-техник: читает запись памяти на месте осмотра
  | 'drone'         // оператор дрона: осматривает место в другой локации, не уходя
  | 'tracker'       // аналитик трафика: проверяет показание на доске по камерам — правда или ложь
  | 'fixer'         // фиксер: достаёт улику через чёрный рынок

export interface DetectiveRole {
  id: string
  name: string
  title: string
  bio: string
  ability: {
    kind: AbilityKind
    /** число использований за партию; null — пассивная */
    uses: number | null
    text: string
    /** пример использования — на телефоне и в выборе роли */
    example: string
    /** как это звучит в разборе: {name} — сыщик, {w} — свидетель; ответ архива: {yes}/{no} через «|» */
    act?: string
  }
}

/* ── Мир ────────────────────────────────────────────────────── */

export interface Location {
  id: string
  name: string
  floor: number
  /** прямоугольник на карте этажа, в процентах */
  x: number
  y: number
  w: number
  h: number
  /** соседи для патрульного и шагов */
  adjacent: string[]
  /** пол — для звука шагов */
  surface: 'wood' | 'marble' | 'stairs' | 'outside'
}

export interface Witness {
  id: string
  name: string
  role: string
  age: number
  /** биография, которую видят игроки */
  bio: string
  /** где свидетель в каждом раунде (индекс = раунд) */
  schedule: string[]
  /** голос ElevenLabs */
  voiceId: string
  /** первая фраза при встрече (играет один раз) */
  greeting: Beat
  /** если спросить больше нечего */
  idle: Beat
}

/* ── Осмотр ─────────────────────────────────────────────────── */

export interface Requirement {
  /** нужны все перечисленные предметы */
  items?: string[]
  /** нужны все перечисленные факты на доске */
  facts?: string[]
}

export interface Find {
  /** предмет, который попадает в улики (может не быть — только факт) */
  itemId?: string
  factId?: string
  /** что видит бригада на экране */
  text: string
  sfx?: string[]
}

export interface Spot {
  id: string
  locationId: string
  name: string
  /** что видно с порога — до осмотра */
  glance: string
  /** первый слой — находит любой */
  primary: Find
  /** второй слой — только криминалист (или повторный осмотр после подсказки) */
  hidden?: Find
  /** заперто: нужен предмет-ключ; физический замок вскрывает взломщик, цифровой — нетраннер */
  locked?: { keyItemId?: string; text: string; kind?: 'physical' | 'digital' }
  /** запись памяти: брейнданс-техник читает сразу, остальные — когда найден проигрыватель (scenario.memoryItemId) */
  memory?: Find
}

export interface Item {
  id: string
  name: string
  description: string
  /** можно предъявить свидетелю */
  presentable: boolean
}

/* ── Разговоры ──────────────────────────────────────────────── */

export interface Answer {
  text: string
  voice?: string
  mood: Mood
  /** правда ли это; видит только психолог */
  lie: boolean
  sfx?: string[]
}

/** Ответ вместо лжи, которую бригада уже раскрыла: свидетель не повторяет то, в чём его уличили или в чём он сам признался.
    Лживую карточку такой ответ не кладёт. Варианты проверяются по порядку. */
export interface HonestAnswer {
  /** достаточно любой из этих карточек на доске */
  when: string[]
  text: string
  voice?: string
  mood: Mood
  sfx?: string[]
  /** карточки, которые ложатся с ответом, — выводы из противоречий лживой карточки, чтобы они не потерялись */
  facts?: string[]
}

/** id реплики честного ответа: первый вариант — `<id>_h`, дальше `<id>_h2`, `<id>_h3` */
export const honestBeatId = (id: string, index: number) => index ? `${id}_h${index + 1}` : `${id}_h`

export interface Question {
  id: string
  witnessId: string
  /** формулировка, которую выбирает сыщик */
  text: string
  answer: Answer
  /** если answer — ложь, которую уже раскрыли */
  honest?: HonestAnswer[]
  /** без этого вопрос заперт */
  requires?: Requirement
  /** какой факт ложится на доску */
  factId?: string
  /** дополнительные вопросы, которые появляются после ответа */
  unlocks?: string[]
  /** вопрос виден с самого начала (иначе — только после unlocks) */
  initial: boolean
}

export interface Presentation {
  id: string
  witnessId: string
  itemId: string
  answer: Answer
  honest?: HonestAnswer[]
  factId?: string
  requires?: Requirement
  unlocks?: string[]
}

/* ── Доска ──────────────────────────────────────────────────── */

export type FactKind = 'physical' | 'testimony' | 'timeline' | 'background'

export interface Fact {
  id: string
  /** заголовок карточки */
  title: string
  /** подробность на карточке */
  detail: string
  kind: FactKind
  /** входит ли в цепочку, нужную для верного обвинения */
  key: boolean
  /** нить: факты одной темы считаются связанными для архивариуса */
  thread: string
}

export interface Contradiction {
  id: string
  facts: [string, string]
  /** что пишет доска, когда оба факта известны */
  text: string
  /** факт, который рождается из противоречия */
  yieldsFactId?: string
}

/* ── Подсказки, обвинение, финал ────────────────────────────── */

export interface Hint {
  round: number
  /** подсказка звучит, если на доске нет ни одного из этих фактов */
  missingAll: string[]
  beat: Beat
}

export interface AccusationOption {
  id: string
  text: string
}

export interface AccusationSpec {
  methods: AccusationOption[]
  motives: AccusationOption[]
  solution: { culprit: string; method: string; motive: string }
  /** укрыватели: верный мотив, но не убийца — частичный зачёт */
  accomplices: string[]
  /** что говорит невиновный, когда его обвиняют; выдаёт факт */
  defenses: Record<string, { beat: Beat; factId?: string }>
}

export interface Epilogue {
  /** правда о ночи — флешбэк */
  truth: Beat[]
  /** развилка: предмет найден / не найден */
  branch: { itemId: string; found: Beat[]; lost: Beat[] }
  /** последняя фраза */
  closing: Beat
}

export interface Scenario {
  id: string
  title: string
  /** длина расписаний свидетелей; на любое число раундов растягивается пропорционально */
  scheduleLength: number
  clock: { start: string; dawn: string }
  prologue: Beat[]
  detectives: DetectiveRole[]
  locations: Location[]
  witnesses: Witness[]
  spots: Spot[]
  items: Item[]
  questions: Question[]
  presentations: Presentation[]
  facts: Fact[]
  contradictions: Contradiction[]
  /** что слышит стажёр, если подслушивает в этом раунде */
  overheard: { rounds: [number, number]; beat: Beat; factId?: string }[]
  /** факт из прошлого для репортёра — по свидетелю */
  backgrounds: Record<string, { beat: Beat; factId: string }>
  hints: Hint[]
  accusation: AccusationSpec
  epilogue: Epilogue
  /** голоса ElevenLabs рассказчика и помощника (у свидетелей — свои voiceId) */
  voices: { narrator: string; inspector: string }
  /** этажи/уровни карты: подписи */
  floors: { id: number; label: string }[]
  /** предмет, которым любой может прочитать слой памяти */
  memoryItemId?: string
  /** события ночи: в раунд (из расчёта на 12 раундов, масштабируется) звучит реплика и ложатся факт/предмет */
  events?: { round: number; beat: Beat; factId?: string; itemId?: string }[]
  /** цели проверки сценария: итоговый факт (признание) и цепочка обвинения */
  checks?: { goal: string; chain: string[] }
  /** осмотр тела судмедэкспертом: место, факт и что звучит */
  coroner?: { spotId: string; factId: string; text: string }
  /** чёрный рынок фиксера: что можно достать (всё это находится и обычным путём) */
  market?: { itemId: string; text: string }[]
}

/** Что сервер сообщает клиенту о себе (/api/config) */
export interface ClientConfig {
  /** local — дома, одна партия; public — в сети, комнаты */
  mode: 'local' | 'public'
  /** можно ли фотографироваться при входе */
  photos: boolean
  /** ссылка на канал игры в Telegram, пусто — не показывать */
  telegram: string
  /** ссылка на страницу доната, пусто — не показывать */
  donate: string
}

/** Сценарий в файле дела: бригаду подставляет движок — она своя у каждого мира */
export type CaseScenario = Omit<Scenario, 'detectives'>

/* ── Дела и история ─────────────────────────────────────────── */

/** Сеттинг: мир со своей бригадой сыщиков, своими способностями и своим оформлением. */
export interface SettingInfo {
  id: string
  title: string
  subtitle: string
  /** визуальная тема: атрибут data-setting на <html> */
  theme: string
  /** как называется команда игроков: «бригада», «группа» */
  crew: string
  /** главное меню, пока этот мир на экране: музыка и атмосфера */
  menu: { music: string; ambience: AmbienceCue }
}

/** Звуковая атмосфера фазы: петли и их громкости (файлы в /sfx/). */
export interface AmbienceCue { names: string[]; levels?: Record<string, number> }

/** Всё, что экран и телефон показывают об этом деле, кроме самой истории. */
export interface CaseInfo {
  id: string
  settingId: string
  title: string
  subtitle: string
  /** «2–10» */
  players: string
  /** «75–90» */
  minutes: string
  /** дело готово к игре (иначе в меню — «скоро») */
  ready: boolean
  /** номер в сеттинге: «Дело № 1» */
  stamp: string
  /** подпись на титрах: «Октябрь 1959» */
  date: string
  /** абзац на обложке и в лобби */
  lede: string
  /** часы: начало ночи и момент, когда время кончается */
  clock: { start: string; end: string }
  /** «до катера», «до рассвета» — перед оставшимся временем */
  countdown: string
  /** когда время вышло: «катер у пристани» */
  timeUp: string
  /** кто звонит с подсказками */
  helper: { name: string; role: string; hints: string }
  /** где собираются на совещание и обвинение, какие кадры уличные (там идёт дождь) */
  stage: { discuss: string; accuse: string; outdoors: string[]; gather: string }
  /** погода поверх уличных кадров */
  weather: 'rain' | 'none'
  lightning: boolean
  /** атмосфера по фазам */
  ambience: { lobby: AmbienceCue; early: AmbienceCue; mid: AmbienceCue; late: AmbienceCue; accuse: AmbienceCue; ending: AmbienceCue }
  /** тексты итога */
  outcomes: {
    short: { solved: string; partial: string; failed: string }
    failedTitle: string; failedSub: string
    partialSub: string
    solvedSub: { gold: string; silver: string; bronze: string }
    dawnAccuse: string
    phoneFailed: string
  }
  /** фразы движка, зависящие от места и времени дела */
  lines: {
    /** раунд без единого действия */
    idle: string
    /** время вышло, имя не названо */
    noName: string
    /** первое обвинение мимо */
    wrong: string
    /** второе обвинение мимо — конец */
    lost: string
  }
}

/** Запись о сыгранной партии — .data/history.json */
export interface GameRecord {
  id: string
  caseId: string
  /** ISO-дата окончания */
  finishedAt: string
  players: string[]
  outcome: 'solved' | 'partial' | 'failed'
  rounds: number
  hints: number
  wrong: number
  minutes: number
}

/* ── Публичное состояние (без разгадки) ─────────────────────── */

export type Screen =
  | 'menu' | 'lobby' | 'tutorial' | 'prologue' | 'plan' | 'resolve' | 'discuss'
  | 'accuse' | 'verdict' | 'epilogue' | 'final'

export interface Player {
  id: string
  name: string
  ink: number
  photo: number | null
  connected: boolean
  ready: boolean
  detectiveId: string | null
  locationId: string
  /** ход на этот раунд уже выбран */
  planned: boolean
  /** остаток использований способности; null — пассивная */
  usesLeft: number | null
}

export interface BoardCard {
  id: string
  title: string
  detail: string
  kind: FactKind
  /** кто и в каком раунде добыл */
  by: string
  round: number
  /** откуда карточка: чьи слова и где найдено — для фильтров доски */
  witnessId?: string
  locationId?: string
  /** команда отметила карточку как важную */
  pinned: boolean
  /** проверено: психолог или камеры сказали, правда это или ложь */
  verdict?: { lie: boolean; by: string }
}

export interface BoardLink {
  id: string
  facts: [string, string]
  text: string
}

export interface PublicWitness {
  id: string
  name: string
  role: string
  age: number
  bio: string
  locationId: string
}

export interface PublicLocation extends Location {
  /** сколько мест осмотра ещё не тронуто */
  unsearched: number
}

export interface PlanSummary {
  playerId: string
  locationId: string
  kind: 'search' | 'ask' | 'present' | 'confront' | 'ability' | 'wait'
  label: string
  /** способность сверх хода */
  bonus?: string
}

export interface AccusationState {
  calledBy: string
  /** null — без таймера: ждём, пока проголосуют все или ведущий нажмёт «Дальше» */
  deadline: number | null
  votes: Record<string, { culprit?: string; method?: string; motive?: string }>
}

export interface Verdict {
  correct: boolean
  culpritRight: boolean
  motiveRight: boolean
  methodRight: boolean
  accused: string
  /** текст, который читает экран */
  beats: Beat[]
  /** сколько попыток осталось */
  attemptsLeft: number
}

export interface PublicState {
  build: string
  screen: Screen
  round: number
  /** в лобби — сколько будет раундов при текущем составе */
  roundsTotal: number
  /** полная длительность текущей фазы с таймером, мс (для полосы прогресса); null — фаза без таймера */
  phaseMs: number | null
  /** до трёх сыщиков: осмотр сразу видит второй слой, совещания короче */
  smallBrigade: boolean
  clock: string
  /** конец текущей фазы, epoch ms; null — ждём ведущего */
  deadline: number | null
  paused: boolean
  settings: {
    hints: 'soft' | 'off'
    /** разбор ходов: по кнопке «Дальше» или сам */
    stepping: 'manual' | 'auto'
    /** роли выбирают сами или раздаёт случай */
    roles: 'pick' | 'random'
    /** с таймерами фаз или только ограничение ходами */
    timers: 'on' | 'off'
    /** перед прологом — короткое обучение на экране */
    tutorial: 'on' | 'off'
  }
  players: Player[]
  detectives: DetectiveRole[]
  locations: PublicLocation[]
  witnesses: PublicWitness[]
  board: { cards: BoardCard[]; links: BoardLink[] }
  /** реплики, которые сейчас проигрывает экран */
  beats: Beat[]
  /** реплика, на которой остановился экран (см. beatAt) */
  beatIndex: number
  /** ходы текущего раунда (на экране планирования) */
  plans: PlanSummary[]
  /** голоса «дальше» на совещании */
  proceedVotes: number
  /** шаг обучения на экране (screen === 'tutorial') */
  tutorialStep: number
  accusation: AccusationState | null
  verdict: Verdict | null
  attemptsLeft: number
  hintsUsed: number
  /** подписи этажей/уровней карты (сверху вниз) */
  floors: { id: number; label: string }[]
  /** активное дело и его сеттинг */
  caseInfo: CaseInfo
  setting: SettingInfo
  /** каталог для меню: сеттинги и их дела (готовые и «скоро») */
  catalog: { setting: SettingInfo; cases: CaseInfo[]; detectives: string[] }[]
  /** история сыгранных партий этого дела (только в лобби, последние записи) */
  history: GameRecord[]
  /** варианты для голосования — списки без ответа */
  accusationOptions: { methods: AccusationOption[]; motives: AccusationOption[] }
  /** чем закончилось; null — партия идёт */
  outcome: 'solved' | 'partial' | 'failed' | null
  standings: null
}

/** Что видит конкретный сыщик на телефоне */
export interface YouState {
  id: string
  name: string
  ink: number
  photo: number | null
  ready: boolean
  detectiveId: string | null
  ability: DetectiveRole['ability'] | null
  usesLeft: number | null
  locationId: string
  planned: PlanSummary | null
  /** способность, выбранная сверх хода в этом раунде */
  bonus: PlanSummary | null
  /** проголосовал за «дальше» на совещании */
  proceeded: boolean
  /** что доступно в каждой локации */
  options: LocationOptions[]
  /** предметы в общем распоряжении бригады */
  items: Item[]
  /** ответы на его собственные вопросы с пометкой лжи — только психолог */
  lieMarks: Record<string, boolean>
  /** для патрульного: кто в соседних локациях */
  peeks: { locationId: string; witnesses: string[]; unsearched: number }[]
  /** для аналитика трафика: где свидетели будут в следующем раунде */
  forecast: { witnessId: string; name: string; locationId: string }[]
  /** для фиксера: что ещё можно достать */
  market: { itemId: string; name: string }[]
}

export interface LocationOptions {
  locationId: string
  spots: { id: string; name: string; glance: string; searched: boolean; locked: string | null; canUnlock: boolean; memory: boolean
    /** что даст осмотр сейчас: первый взгляд, второй слой, запись памяти или ничего */
    stage: 'new' | 'second' | 'memory' | 'done' }[]
  witnesses: {
    id: string
    name: string
    /** у закрытого вопроса текст не приходит (в нём подсказка) — только что нужно, чтобы его открыть */
    questions: { id: string; text: string; asked: boolean; locked: string | null; canForce: boolean }[]
    /** любая улика бригады: locked — чего не хватает, чтобы свидетелю было что сказать */
    presents: { itemId: string; name: string; done: boolean; locked: string | null }[]
    /** найденные противоречия, в которых замешаны слова этого свидетеля */
    confronts: { linkId: string; text: string; done: boolean }[]
  }[]
}

/* ── Сообщения ──────────────────────────────────────────────── */

export type PlanAction =
  | { type: 'search'; spotId: string; force?: boolean }
  | { type: 'ask'; witnessId: string; questionId: string; second?: string; force?: boolean; remote?: boolean }
  | { type: 'present'; witnessId: string; itemId: string; remote?: boolean }
  | { type: 'reporter'; witnessId: string }
  | { type: 'intern' }
  | { type: 'archivist'; factId: string }
  | { type: 'verify'; factId: string }
  | { type: 'coroner' }
  | { type: 'drone'; spotId: string }
  | { type: 'fixer' }
  /** уличить свидетеля во лжи найденным противоречием */
  | { type: 'confront'; witnessId: string; linkId: string }
  | { type: 'wait' }

export type ClientMessage =
  /** дома экран просто здоровается; в сети — create (новая комната) или room + key (своя комната);
      телефон в сети — room (код комнаты) */
  | { type: 'hello'; role: 'host' | 'player'; token?: string; name?: string; ink?: number; room?: string; key?: string; create?: boolean }
  | { type: 'setName'; name: string; ink: number }
  | { type: 'ready'; ready: boolean }
  | { type: 'leave' }
  | { type: 'pickDetective'; detectiveId: string | null }
  | { type: 'plan'; locationId: string; action: PlanAction }
  | { type: 'unplan' }
  /** способность со счётчиком — действие сверх хода в этом раунде */
  | { type: 'bonus'; action: PlanAction }
  | { type: 'unbonus' }
  | { type: 'proceed' }
  | { type: 'callAccuse' }
  | { type: 'vote'; culprit?: string; method?: string; motive?: string }
  | { type: 'beatsDone' }
  /** игрок: отметить карточку доски как важную (или снять отметку) */
  | { type: 'pin'; factId: string }
  /** ведущий: какая реплика сейчас на экране — чтобы после перезагрузки продолжить с неё */
  | { type: 'beatAt'; index: number; beatId: string }
  // ведущий
  | { type: 'start' }
  | { type: 'pause'; paused: boolean }
  | { type: 'skip' }
  | { type: 'restart' }
  | { type: 'kick'; playerId: string }
  | { type: 'settings'; settings: Partial<PublicState['settings']> }
  | { type: 'selectCase'; caseId: string }
  /** ведущий: шаг обучения (число шагов и больше — к прологу) */
  | { type: 'tutorial'; step: number }
  | { type: 'toMenu' }

export type ServerMessage =
  | { type: 'state'; state: PublicState; you: YouState | null }
  | { type: 'welcome'; playerId: string; token: string }
  | { type: 'hostAuth'; ok: boolean; reason?: string }
  /** экран в сети создал комнату: код для телефонов и ключ, по которому экран вернётся в неё */
  | { type: 'room'; code: string; key: string }
  /** телефон в сети: комнаты нет (или код не указан) */
  | { type: 'noRoom'; reason: string }
  | { type: 'kicked'; reason: string }
