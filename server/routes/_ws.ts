import { dropPhoto, restorePhoto } from '../utils/photos'
import { IS_PUBLIC, clientIp } from '../utils/mode'
import { LOCAL_ROOM, createRoom, getRoom, normalizeCode, onRoomChange, touch, verifyHost, verifyPass, verifyPin, type Room } from '../utils/rooms'
import { Bucket, WindowLimiter } from '../utils/limits'
import type { ClientMessage, ServerMessage } from '../../shared/types'

interface Session {
  role: 'host' | 'player' | 'guest'
  playerId?: string
  /** код комнаты, в которую смотрит сокет */
  room?: string
  ip: string
  bucket: Bucket
  /** сколько сообщений отброшено за флуд */
  dropped: number
}

type Peer = { id: string; send: (data: string) => void; close: (code?: number, reason?: string) => void }

const peers = new Map<string, { peer: Peer; session: Session }>()
const perIp = new Map<string, number>()

/** крупнее этого клиенту слать нечего: фото идут отдельным запросом */
const MAX_MESSAGE = 8_000
/* мобильные операторы сажают тысячи абонентов на один адрес — пределы с запасом, грубый флуд режет CDN */
const MAX_SOCKETS_PER_IP = Number(process.env.MAX_SOCKETS_PER_IP) || (IS_PUBLIC ? 150 : 1000)
/** неверный код ведущего или ключ комнаты: 10 попыток за 10 минут */
const hostFails = new WindowLimiter(10, 10 * 60_000)
/** несуществующие комнаты: 60 за минуту — перебор 30⁶ кодов не окупается */
const roomMisses = new WindowLimiter(60, 60_000)
/** новые комнаты с одного адреса за 10 минут */
const roomCreates = new WindowLimiter(Number(process.env.MAX_NEW_ROOMS_PER_IP) || 20, 10 * 60_000)

let unsubscribe: (() => void) | null = null
function ensureSubscribed() {
  if (!unsubscribe) unsubscribe = onRoomChange(broadcast)
}

function send(peer: Peer, msg: ServerMessage) {
  try { peer.send(JSON.stringify(msg)) } catch { /* сокет уже закрыт */ }
}

/** публичный срез комнаты сериализуется один раз на рассылку, личный — на каждого */
function pushState(entry: { peer: Peer; session: Session }, room: Room, publicJson?: string) {
  if (entry.session.role === 'guest') return
  const json = publicJson ?? JSON.stringify(room.game.publicState())
  const you = entry.session.playerId ? room.game.youState(entry.session.playerId) : null
  try { entry.peer.send(`{"type":"state","state":${json},"you":${JSON.stringify(you)}}`) } catch { /* сокет уже закрыт */ }
}

function broadcast(room: Room) {
  if (!room.peers.size) return
  const json = JSON.stringify(room.game.publicState())
  for (const id of room.peers) {
    const entry = peers.get(id)
    if (entry) pushState(entry, room, json)
  }
}

/** сокет уходит из своей комнаты: если это был последний сокет игрока — игрок «не на связи» */
function detach(id: string, entry: { session: Session }) {
  const room = getRoom(entry.session.room)
  entry.session.room = undefined
  if (!room) return
  room.peers.delete(id)
  const pid = entry.session.playerId
  if (!pid) return
  const stillHere = [...room.peers].some(other => peers.get(other)?.session.playerId === pid)
  if (!stillHere) room.game.setConnected(pid, false)
}

function attach(id: string, entry: { session: Session }, room: Room) {
  if (entry.session.room === room.code) return
  detach(id, entry)
  entry.session.room = room.code
  room.peers.add(id)
  touch(room)
}

const HOST_ONLY = new Set(['start', 'pause', 'skip', 'restart', 'kick', 'settings', 'beatsDone', 'beatAt', 'selectCase', 'toMenu', 'tutorial'])

export default defineWebSocketHandler({
  open(peer) {
    ensureSubscribed()
    const ip = clientIp(peer.request?.headers as Headers | undefined, peer.remoteAddress)
    const count = (perIp.get(ip) ?? 0) + 1
    perIp.set(ip, count)
    peers.set(peer.id, { peer: peer as unknown as Peer, session: { role: 'guest', ip, bucket: new Bucket(15, 40), dropped: 0 } })
    if (count > MAX_SOCKETS_PER_IP) peer.close(1008, 'too many connections')
  },

  message(peer, message) {
    const entry = peers.get(peer.id)
    if (!entry) return
    const { session } = entry

    // флуд: лишнее отбрасываем, упорный флуд — закрываем сокет
    if (!session.bucket.take()) {
      if (++session.dropped > 200) peer.close(1008, 'rate limit')
      return
    }
    const text = message.text()
    if (text.length > MAX_MESSAGE) return

    let msg: ClientMessage
    try { msg = JSON.parse(text) } catch { return }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return

    if (msg.type === 'hello') {
      if (msg.role === 'host') return helloHost(peer.id, entry, msg)
      return helloPlayer(peer.id, entry, msg)
    }

    const room = getRoom(session.room)
    if (!room || session.role === 'guest') return
    touch(room)
    const g = room.game

    if (session.role === 'host') {
      if (!HOST_ONLY.has(msg.type)) return
      if (msg.type === 'kick') dropPhoto(msg.playerId, g.tokenOf(msg.playerId))
      g.handleHost(msg)
      return
    }

    const pid = session.playerId
    if (!pid || HOST_ONLY.has(msg.type)) return

    if (msg.type === 'leave') {
      dropPhoto(pid, g.remove(pid))
      session.playerId = undefined
      return
    }
    g.handlePlayer(pid, msg)
  },

  close(peer) {
    const entry = peers.get(peer.id)
    peers.delete(peer.id)
    if (!entry) return
    const left = (perIp.get(entry.session.ip) ?? 1) - 1
    if (left > 0) perIp.set(entry.session.ip, left)
    else perIp.delete(entry.session.ip)
    detach(peer.id, entry)
  }
})

type Entry = { peer: Peer; session: Session }
type Hello = Extract<ClientMessage, { type: 'hello' }>

function helloHost(id: string, entry: Entry, msg: Hello) {
  const { session } = entry
  const deny = (reason?: string) => {
    detach(id, entry)
    session.role = 'guest'
    session.playerId = undefined
    send(entry.peer, { type: 'hostAuth', ok: false, reason })
  }
  if (hostFails.blocked(session.ip)) return deny('Слишком много неверных попыток. Подождите десять минут.')

  let room: Room | undefined
  // дома экран — любой, кто открыл главную страницу: кода ведущего больше нет
  if (!IS_PUBLIC) room = getRoom(LOCAL_ROOM)
  else if (msg.create) {
    if (!roomCreates.take(session.ip)) return deny('С этого адреса уже открыто много комнат. Попробуйте позже.')
    room = createRoom() ?? undefined
    if (!room) return deny('Сейчас играет слишком много компаний. Попробуйте через несколько минут.')
  } else if (msg.room && msg.pin && !msg.key) {
    // другой экран продолжает комнату: код и ПИН с прежнего экрана — получает ключ, как если бы открыл её сам
    const found = getRoom(normalizeCode(msg.room))
    if (found && found.hostKey && verifyPin(found, msg.pin)) room = found
    else {
      hostFails.take(session.ip)
      return deny(found ? 'Неверный ПИН.' : 'Комнаты с таким кодом нет.')
    }
  } else if (msg.room || msg.key) {
    const found = getRoom(normalizeCode(msg.room))
    if (found && verifyHost(found, msg.key)) room = found
    else {
      hostFails.take(session.ip)
      return deny('Комната закрыта: в ней долго никого не было. Откройте новую.')
    }
  }
  if (!room) return deny()
  if (room.hostKey) send(entry.peer, { type: 'room', code: room.code, key: room.hostKey, pin: room.pin ?? undefined, pass: room.pass ?? undefined })

  session.role = 'host'
  session.playerId = undefined
  attach(id, entry, room)
  send(entry.peer, { type: 'hostAuth', ok: true })
  pushState(entry, room)
}

function helloPlayer(id: string, entry: Entry, msg: Hello) {
  const { session } = entry
  let room: Room | undefined
  if (!IS_PUBLIC) room = getRoom(LOCAL_ROOM)
  else {
    const code = normalizeCode(msg.room)
    if (code && roomMisses.blocked(session.ip)) {
      send(entry.peer, { type: 'noRoom', reason: 'Слишком много попыток. Подождите минуту.' })
      return
    }
    room = getRoom(code)
    if (!room) {
      if (code) roomMisses.take(session.ip)
      detach(id, entry)
      session.role = 'guest'
      session.playerId = undefined
      send(entry.peer, { type: 'noRoom', reason: code ? 'Комнаты с таким кодом нет. Проверьте код на экране.' : '' })
      return
    }
  }
  if (!room) return

  // в сети без QR нужен ПИН с экрана: секрет из ссылки или ПИН; тот, кто уже в бригаде (жетон известен), входит так
  if (IS_PUBLIC && room.pin) {
    const known = typeof msg.token === 'string' && !!room.game.byToken(msg.token)
    if (!known && !verifyPass(room, msg.pass) && !verifyPin(room, msg.pin)) {
      if (msg.pin) roomMisses.take(session.ip)
      detach(id, entry)
      session.role = 'guest'
      session.playerId = undefined
      send(entry.peer, { type: 'needPin', code: room.code, reason: msg.pin ? 'Неверный ПИН. Он на экране, под кодом комнаты.' : '' })
      return
    }
  }

  // сменил комнату — уходит из старой (там он «не на связи»), в новой пока никто
  if (session.room !== room.code) {
    detach(id, entry)
    session.playerId = undefined
  }
  session.role = 'player'
  const g = room.game
  const named = !!(typeof msg.name === 'string' && msg.name.trim())
  // незнакомый жетон без имени (например, от прошлой комнаты) — показываем форму входа, а не заводим «Сыщика»
  if (!named && !(typeof msg.token === 'string' && g.byToken(msg.token))) {
    session.playerId = undefined
    attach(id, entry, room)
    pushState(entry, room)
    return
  }
  // сокет подписывается на комнату только после входа: иначе рассылка о самом входе придёт ему
  // раньше «welcome» без личного состояния, и телефон на миг покажет форму входа
  const player = g.join(typeof msg.token === 'string' ? msg.token : undefined, (typeof msg.name === 'string' ? msg.name : '').trim().slice(0, 14), typeof msg.ink === 'number' ? msg.ink : -1)
  if (!player) {
    attach(id, entry, room)
    send(entry.peer, { type: 'kicked', reason: 'Бригада укомплектована — десять сыщиков, больше не берём' })
    return
  }
  // вернувшийся после перезапуска — поднимаем фото с диска (только дома: в сети фото не храним)
  if (!IS_PUBLIC && player.photo == null && restorePhoto(player.token, player.id)) player.photo = 1
  session.playerId = player.id
  attach(id, entry, room)
  send(entry.peer, { type: 'welcome', playerId: player.id, token: player.token })
  pushState(entry, room)
}
