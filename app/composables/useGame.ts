import { setCurrentCase, setCurrentSetting } from '~/utils/case-store'
import type { ClientMessage, PublicState, ServerMessage, YouState } from '#shared/types'
import { useConfig } from './useConfig'

const { config } = useConfig()

const state = shallowRef<PublicState | null>(null)
const you = shallowRef<YouState | null>(null)
const connected = ref(false)
const kicked = ref<string | null>(null)

const hostAuthorized = ref<boolean | null>(null)
const hostPending = ref(false)
/** сервер уже ответил экрану — до этого не показываем ни «Открыть комнату», ни «Начать игру», иначе кнопки мигают */
const hostChecked = ref(false)
/** почему экран не пустили (в сети): комната закрыта, слишком много попыток… */
const hostReason = ref<string | null>(null)
const ready = ref(false)

/** код комнаты (в сети): экран получает его при создании, телефон — из ссылки или ввода */
export const roomCode = ref<string | null>(null)
/** телефон в сети: комнаты нет — показать ввод кода; строка — причина (пустая — код ещё не вводили) */
const noRoom = ref<string | null>(null)

let socket: WebSocket | null = null
let role: 'host' | 'player' = 'player'
let retry = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let queue: ClientMessage[] = []

let pendingPhoto: string | null = null
let photoRetried = false

function uploadPhoto(token: string, dataUrl: string) {
  void $fetch('/api/photo', { method: 'POST', body: { token, dataUrl } }).catch(() => { /* повторим при следующем состоянии */ })
}

let build = ''

const TOKEN_KEY = 'party-token'
const NAME_KEY = 'party-name'
const PHOTO_KEY = 'party-photo'
/** экран в сети: { code, key } своей комнаты */
const HOST_ROOM_KEY = 'rt-host-room'
/** телефон в сети: последний код комнаты */
const PLAYER_ROOM_KEY = 'rt-player-room'
/** ПИН и секрет QR этой комнаты — на экране (показать под кодом) */
export const roomPin = ref<string | null>(null)
export const roomPass = ref<string | null>(null)
/** телефон: комната найдена, но нужен ПИН (строка — причина, '' — просто спросить) */
const needPin = ref<string | null>(null)
const PASS_KEY = (code: string) => `rt-pass:${code}`
const PIN_KEY = (code: string) => `rt-pin:${code}`
function session(): Storage | null { try { return window.sessionStorage } catch { return null } }

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

function savedHostRoom(): { code: string; key: string } | null {
  try {
    const v = JSON.parse(storage()?.getItem(HOST_ROOM_KEY) || 'null')
    return v && typeof v.code === 'string' && typeof v.key === 'string' ? v : null
  } catch { return null }
}
/** жетон игрока — свой в каждой комнате, дома — один, как раньше */
const tokenKey = () => (role === 'player' && roomCode.value ? `${TOKEN_KEY}:${roomCode.value}` : TOKEN_KEY)

function hello(): ClientMessage {
  const s = storage()
  if (role === 'host') {
    const room = savedHostRoom()
    if (room) roomCode.value = room.code
    hostPending.value = true
    return { type: 'hello', role, room: room?.code, key: room?.key }
  }
  const code = roomCode.value
  return {
    type: 'hello',
    role,
    room: code ?? undefined,
    token: s?.getItem(tokenKey()) || undefined,
    name: s?.getItem(NAME_KEY) || undefined,
    pass: code ? session()?.getItem(PASS_KEY(code)) || undefined : undefined,
    pin: code ? session()?.getItem(PIN_KEY(code)) || undefined : undefined
  }
}

function send(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  else queue.push(msg)
}

function open() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(`${proto}//${location.host}/_ws`)

  socket.onopen = () => {
    connected.value = true
    retry = 0
    socket!.send(JSON.stringify(hello()))
    const pending = queue
    queue = []
    for (const m of pending) send(m)
  }

  socket.onmessage = (event) => {
    let msg: ServerMessage
    try { msg = JSON.parse(event.data) } catch { return }

    if (msg.type === 'welcome') {
      storage()?.setItem(tokenKey(), msg.token)
      photoRetried = false
      if (pendingPhoto) {
        const dataUrl = pendingPhoto
        pendingPhoto = null
        uploadPhoto(msg.token, dataUrl)
      }
      return
    }
    if (msg.type === 'hostAuth') {
      const tried = !!savedHostRoom()
      hostAuthorized.value = msg.ok ? true : tried ? false : null
      hostPending.value = false
      hostChecked.value = true
      hostReason.value = msg.ok ? null : msg.reason ?? null
      if (!msg.ok) {
        storage()?.removeItem(HOST_ROOM_KEY)
        roomCode.value = null
      }
      return
    }
    if (msg.type === 'room') {
      storage()?.setItem(HOST_ROOM_KEY, JSON.stringify({ code: msg.code, key: msg.key }))
      roomCode.value = msg.code
      roomPin.value = msg.pin ?? null
      roomPass.value = msg.pass ?? null
      return
    }
    if (msg.type === 'noRoom') {
      noRoom.value = msg.reason
      needPin.value = null
      state.value = null
      you.value = null
      ready.value = true
      return
    }
    if (msg.type === 'needPin') {
      roomCode.value = msg.code
      needPin.value = msg.reason ?? ''
      noRoom.value = null
      state.value = null
      you.value = null
      ready.value = true
      return
    }
    if (msg.type === 'state') {
      if (build && build !== msg.state.build) {
        location.reload()
        return
      }
      build = msg.state.build
      noRoom.value = null
      needPin.value = null
      setCurrentCase(msg.state.caseInfo?.id)
      setCurrentSetting(msg.state.setting?.id)
      state.value = msg.state
      you.value = msg.you
      ready.value = true

      // сервер не знает нашего фото (перезапускался) — досылаем сохранённое на телефоне
      if (msg.you && msg.you.photo == null && !photoRetried) {
        const saved = storage()?.getItem(PHOTO_KEY)
        const token = storage()?.getItem(tokenKey())
        if (saved && token && config.value.photos) {
          photoRetried = true
          uploadPhoto(token, saved)
        }
      }
      return
    }
    if (msg.type === 'kicked') {
      kicked.value = msg.reason
    }
  }

  socket.onclose = () => {
    connected.value = false
    socket = null

    const wait = Math.min(5000, 400 * 2 ** retry++)
    retryTimer = setTimeout(open, wait)
  }

  socket.onerror = () => socket?.close()
}

/** Экран уходит из своей комнаты: ключ забыт, соединение открывается заново без комнаты — ворота предложат открыть новую
    или войти в другую по коду и ПИНу. Сама комната живёт на сервере ещё несколько часов, в неё можно вернуться тем же путём */
export function leaveRoom() {
  storage()?.removeItem(HOST_ROOM_KEY)
  roomCode.value = null
  roomPin.value = null
  roomPass.value = null
  hostAuthorized.value = null
  hostChecked.value = false
  hostPending.value = true
  hostReason.value = null
  retry = 0
  socket?.close()
}

export function useGame(as: 'host' | 'player' = 'player') {
  role = as

  onMounted(open)
  onBeforeUnmount(() => {
    if (retryTimer) clearTimeout(retryTimer)
  })

  return {
    state,
    you,
    connected,
    kicked,
    ready,
    hostAuthorized,
    hostPending,
    hostChecked,
    hostReason,
    noRoom,
    needPin,
    roomCode,
    roomPin,
    roomPass,
    send,

    /** экран: продолжить свою комнату с другого устройства — код и ПИН с прежнего экрана */
    resumeRoom(code: string, pin: string) {
      hostPending.value = true
      hostReason.value = null
      roomCode.value = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
      send({ type: 'hello', role: 'host', room: roomCode.value, pin: pin.replace(/\D/g, '') })
    },

    /** телефон: ПИН с экрана, когда вошли по коду без QR */
    enterPin(pin: string) {
      const code = roomCode.value
      if (!code) return
      session()?.setItem(PIN_KEY(code), pin.replace(/\D/g, ''))
      send(hello())
    },

    /** экран: сменить ПИН своей комнаты */
    setPin(pin: string) { send({ type: 'setPin', pin: pin.replace(/\D/g, '') }) },

    /** экран в сети: открыть новую комнату; pin — четыре цифры, которые ведущий выбрал сам */
    createRoom(pin?: string) {
      hostPending.value = true
      hostReason.value = null
      send({ type: 'hello', role: 'host', create: true, pin: pin?.replace(/\D/g, '') || undefined })
    },

    /** экран в сети: закрыть эту комнату для себя и вернуться к кнопке «Открыть комнату» */
    forgetRoom() {
      storage()?.removeItem(HOST_ROOM_KEY)
      roomCode.value = null
      hostAuthorized.value = null
      state.value = null
      send({ type: 'hello', role: 'host' })
    },

    /** телефон в сети: код комнаты из ссылки (?r=) или из поля ввода; null — взять последний сохранённый.
        pass — секрет из QR-ссылки (?p=): с ним ПИН не нужен */
    enterRoom(code: string | null, reconnect = true, pass?: string | null) {
      const clean = (code ?? storage()?.getItem(PLAYER_ROOM_KEY) ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      roomCode.value = clean || null
      if (clean) storage()?.setItem(PLAYER_ROOM_KEY, clean)
      if (clean && pass) session()?.setItem(PASS_KEY(clean), pass)
      if (reconnect) send(hello())
    },

    joinGame(name: string, ink: number, photo: string | null) {
      const s = storage()
      s?.setItem(NAME_KEY, name)
      if (photo) s?.setItem(PHOTO_KEY, photo)
      pendingPhoto = config.value.photos ? photo : null
      const code = roomCode.value
      send({ type: 'hello', role: 'player', room: code ?? undefined, token: s?.getItem(tokenKey()) || undefined, name, ink, pass: code ? session()?.getItem(PASS_KEY(code)) || undefined : undefined, pin: code ? session()?.getItem(PIN_KEY(code)) || undefined : undefined })
    },

    /** Правка из лобби: имя и краска — сообщением, новое фото — отдельной загрузкой. */
    updateProfile(name: string, ink: number, photo: string | null, photoChanged: boolean) {
      const s = storage()
      s?.setItem(NAME_KEY, name)
      send({ type: 'setName', name, ink })
      const token = s?.getItem(tokenKey())
      if (photoChanged && photo && token && config.value.photos) {
        s?.setItem(PHOTO_KEY, photo)
        uploadPhoto(token, photo)
      }
    },
    savedName: () => storage()?.getItem(NAME_KEY) || '',
    savedPhoto: () => storage()?.getItem(PHOTO_KEY) || null
  }
}

export function useCountdown(deadline: Ref<number | null | undefined>) {
  const now = ref(Date.now())
  let raf = 0

  const loop = () => {
    now.value = Date.now()
    raf = requestAnimationFrame(loop)
  }
  onMounted(() => { raf = requestAnimationFrame(loop) })
  onBeforeUnmount(() => cancelAnimationFrame(raf))

  const left = computed(() => {
    if (!deadline.value) return null
    return Math.max(0, deadline.value - now.value)
  })

  return {
    ms: left,
    seconds: computed(() => (left.value == null ? null : Math.ceil(left.value / 1000)))
  }
}
