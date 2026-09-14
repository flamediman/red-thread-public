/* Одиночная игра: свой сокет. Один жетон — одна партия (и её три сохранения) на диске.
   Несколько вкладок с одним жетоном видят одно и то же; партия выгружается из памяти, когда закрыта последняя. */
import { SoloGame, SOLO_TOKEN } from '../game/solo'
import { SOLO_STORIES } from '../scenario'
import { clientIp, IS_PUBLIC } from '../utils/mode'
import { Bucket, WindowLimiter } from '../utils/limits'
import type { SoloClientMessage, SoloServerMessage } from '../../shared/types'

type Peer = { id: string; send: (data: string) => void; close: (code?: number, reason?: string) => void }
interface Session { ip: string; bucket: Bucket; dropped: number; key?: string }

const peers = new Map<string, { peer: Peer; session: Session }>()
const games = new Map<string, { game: SoloGame; peers: Set<string>; idle: ReturnType<typeof setTimeout> | null }>()
const perIp = new Map<string, number>()
const MAX_SOCKETS_PER_IP = Number(process.env.MAX_SOCKETS_PER_IP) || (IS_PUBLIC ? 150 : 1000)
/** новые партии с одного адреса: жетон придумывает клиент, перебором диск не забить */
const newRuns = new WindowLimiter(Number(process.env.MAX_NEW_SOLO_PER_IP) || 30, 10 * 60_000)

function send(peer: Peer, msg: SoloServerMessage) {
  try { peer.send(JSON.stringify(msg)) } catch { /* сокет закрыт */ }
}

function broadcast(key: string) {
  const g = games.get(key)
  if (!g) return
  const json = JSON.stringify({ type: 'view', view: g.game.view() })
  for (const id of g.peers) { try { peers.get(id)?.peer.send(json) } catch { /* закрыт */ } }
}

function detach(id: string, session: Session) {
  const key = session.key
  session.key = undefined
  const g = key ? games.get(key) : null
  if (!g || !key) return
  g.peers.delete(id)
  if (g.peers.size) return
  g.game.detached()
  // последняя вкладка закрыта: минуту держим в памяти (перезагрузка страницы), потом пишем на диск и выгружаем
  g.idle = setTimeout(() => { g.game.dispose(); games.delete(key) }, 60_000)
  g.idle.unref?.()
}

export default defineWebSocketHandler({
  open(peer) {
    const ip = clientIp(peer.request?.headers as Headers | undefined, peer.remoteAddress)
    const count = (perIp.get(ip) ?? 0) + 1
    perIp.set(ip, count)
    peers.set(peer.id, { peer: peer as unknown as Peer, session: { ip, bucket: new Bucket(12, 30), dropped: 0 } })
    if (count > MAX_SOCKETS_PER_IP) peer.close(1008, 'too many connections')
  },

  message(peer, message) {
    const entry = peers.get(peer.id)
    if (!entry) return
    const { session } = entry
    if (!session.bucket.take()) {
      if (++session.dropped > 200) peer.close(1008, 'rate limit')
      return
    }
    const text = message.text()
    if (text.length > 2000) return
    let msg: SoloClientMessage
    try { msg = JSON.parse(text) } catch { return }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return

    if (msg.type === 'hello') {
      const storyId = typeof msg.story === 'string' && SOLO_STORIES[msg.story] ? msg.story : Object.keys(SOLO_STORIES)[0]
      const entryStory = storyId ? SOLO_STORIES[storyId] : null
      if (!entryStory) return send(entry.peer, { type: 'error', reason: 'Одиночных историй пока нет.' })
      if (typeof msg.token !== 'string' || !SOLO_TOKEN.test(msg.token)) return send(entry.peer, { type: 'error', reason: 'bad token' })
      const key = `${storyId}:${msg.token}`
      detach(peer.id, session)
      let g = games.get(key)
      if (!g) {
        if (!newRuns.take(session.ip)) return send(entry.peer, { type: 'error', reason: 'Слишком много новых партий с этого адреса. Подождите.' })
        const game = new SoloGame(entryStory.info, entryStory.story, msg.token, () => broadcast(key))
        g = { game, peers: new Set(), idle: null }
        games.set(key, g)
      }
      if (g.idle) { clearTimeout(g.idle); g.idle = null }
      if (!g.peers.size) g.game.attached()
      g.peers.add(peer.id)
      session.key = key
      send(entry.peer, { type: 'view', view: g.game.view() })
      return
    }

    const g = session.key ? games.get(session.key) : null
    if (!g) return
    g.game.handle(msg)
  },

  close(peer) {
    const entry = peers.get(peer.id)
    peers.delete(peer.id)
    if (!entry) return
    const left = (perIp.get(entry.session.ip) ?? 1) - 1
    if (left > 0) perIp.set(entry.session.ip, left)
    else perIp.delete(entry.session.ip)
    detach(peer.id, entry.session)
  }
})
