/* Одиночная игра на клиенте: свой сокет /_solo, жетон партии в localStorage.
   Всё состояние приходит с сервера целиком (view); клиент только показывает и шлёт намерения. */
import type { SoloClientMessage, SoloServerMessage, SoloView } from '#shared/types'
import { cookieValue, keep } from '~/utils/keep'
import { setCurrentCase, setCurrentSetting } from '~/utils/case-store'

const view = shallowRef<SoloView | null>(null)
const connected = ref(false)
const error = ref<string | null>(null)
/** разница часов сервера и браузера — для таймера встречи */
const clockOffset = ref(0)

let socket: WebSocket | null = null
let retry = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let queue: SoloClientMessage[] = []
let build = ''
let story = ''

const TOKEN_KEY = 'solo-token'
/** перенос партии: код для другого устройства и ответ на введённый код */
const transferCode = ref<{ code: string; minutes: number } | null>(null)
const adoptError = ref<string | null>(null)

function token() {
  let t = ''
  try { t = localStorage.getItem(TOKEN_KEY) || '' } catch { /* приватный режим */ }
  // localStorage пуст (Safari чистит его через неделю без захода) — жетон ждёт в cookie сервера
  if (!/^[a-z0-9]{12,40}$/.test(t)) t = cookieValue('solo')
  if (!/^[a-z0-9]{12,40}$/.test(t)) {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789'
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    t = [...bytes].map(b => abc[b % abc.length]).join('')
  }
  try { localStorage.setItem(TOKEN_KEY, t) } catch { /* без сохранения — партия проживёт до закрытия вкладки */ }
  keep('solo', t)
  return t
}

function send(msg: SoloClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  else queue.push(msg)
}

function open() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(`${proto}//${location.host}/_solo`)
  socket.onopen = () => {
    connected.value = true
    retry = 0
    socket!.send(JSON.stringify({ type: 'hello', token: token(), story: story || undefined }))
    const pending = queue
    queue = []
    for (const m of pending) send(m)
  }
  socket.onmessage = (event) => {
    let msg: SoloServerMessage
    try { msg = JSON.parse(event.data) } catch { return }
    if (msg.type === 'error') { error.value = msg.reason; return }
    if (msg.type === 'transfer') { transferCode.value = { code: msg.code, minutes: msg.minutes }; return }
    if (msg.type === 'adopt') {
      if (!msg.token) { adoptError.value = msg.reason ?? 'Код не подошёл.'; return }
      // партия с другого устройства: берём её жетон и заново здороваемся с сервером
      try { localStorage.setItem(TOKEN_KEY, msg.token) } catch { /* приватный режим */ }
      keep('solo', msg.token)
      adoptError.value = null
      transferCode.value = null
      socket?.close()
      socket = null
      open()
      return
    }
    if (msg.type === 'view') {
      if (build && build !== msg.view.build) { location.reload(); return }
      build = msg.view.build
      error.value = null
      setCurrentCase(msg.view.info.id)
      setCurrentSetting(msg.view.info.settingId)
      // сдвиг часов — по любому экрану со временем сервера: погоня, встреча, босс
      const timed = msg.view.chase ?? msg.view.encounter ?? msg.view.boss
      if (timed) clockOffset.value = timed.serverNow - Date.now()
      view.value = msg.view
    }
  }
  socket.onclose = () => {
    connected.value = false
    socket = null
    retryTimer = setTimeout(open, Math.min(5000, 400 * 2 ** retry++))
  }
  socket.onerror = () => socket?.close()
}

function onVisibility() { send({ type: 'away', on: document.visibilityState === 'hidden' }) }

export function useSolo(storyId?: string) {
  if (storyId) story = storyId
  onMounted(() => { open(); document.addEventListener('visibilitychange', onVisibility) })
  // уход со страницы закрывает сокет без переподключения: сервер видит, что игрока нет, и останавливает часы встречи
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    const s = socket
    socket = null
    queue = []
    if (s) { s.onclose = null; s.onerror = null; try { s.close() } catch { /* уже закрыт */ } }
    connected.value = false
    view.value = null
  })
  return {
    view, connected, error, clockOffset, send, transferCode, adoptError,
    /** код переноса на другое устройство */
    transfer() { transferCode.value = null; send({ type: 'transfer' }) },
    /** забрать партию с другого устройства по коду */
    adopt(code: string) { adoptError.value = null; send({ type: 'adopt', code: code.toUpperCase().replace(/[^A-Z0-9]/g, '') }) }
  }
}
