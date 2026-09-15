/* Бот обратной связи в Telegram. Игрок пишет боту баг, идею или отзыв — бот пересылает сообщение владельцу канала
   в личку; владелец отвечает на пересланное (свайп → «Ответить») — ответ уходит игроку от имени бота.
   Работает только на сервере «в сети» с TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL: длинный опрос getUpdates, без вебхука.
   Владелец — создатель канала (или TELEGRAM_OWNER_ID); чтобы бот мог ему писать, владелец один раз жмёт «Старт» у бота.
   Всё входящее и комментарии под постами — в .data/telegram/inbox.jsonl (сводка отзывов читается оттуда).
   Пока бот слушает здесь, getUpdates с другой машины (tools/telegram.mjs updates) конфликтует с опросом. */
import { setDefaultResultOrder } from 'node:dns'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../utils/data-dir'
import { IS_PUBLIC } from '../utils/mode'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim()
const CHANNEL = process.env.TELEGRAM_CHANNEL?.trim()
const DIR = join(DATA_DIR, 'telegram')
const STATE_FILE = join(DIR, 'state.json')
const INBOX = join(DIR, 'inbox.jsonl')

type Topic = 'bug' | 'idea' | 'review'
const TOPICS: Record<Topic, { label: string; icon: string; prompt: string }> = {
  bug: {
    label: 'Баг', icon: '🐞',
    prompt: 'Расскажите, что случилось и где: на телефоне или на большом экране, в каком деле. Скриншот или видео очень помогут — присылайте следующими сообщениями.'
  },
  idea: {
    label: 'Идея', icon: '💡',
    prompt: 'Какой мир, какое дело, какая механика? Пишите как есть — даже одна фраза может стать новой ночью.'
  },
  review: {
    label: 'Впечатления', icon: '💬',
    prompt: 'Как прошла ваша ночь? Что зацепило, что показалось скучным или непонятным, чего не хватило. Нам важны даже мелочи.'
  }
}
const HELLO = 'Здравствуйте! Это бот «Красной нити». Сообщения отсюда читает разработчик игры, ответ придёт в этот же чат.'
const THANKS = 'Спасибо! Передали разработчику. Если понадобится что-то уточнить, ответим здесь.'
/** сколько сообщений от одного человека пересылать за час — дальше только в журнал */
const PER_HOUR = 30
/** «спасибо» не чаще раза в 10 минут: альбом из пяти скриншотов — одно спасибо */
const THANKS_GAP = 10 * 60_000

interface TgUser { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }
interface TgMessage {
  message_id: number; date: number; chat: { id: number; type: string }; from?: TgUser
  text?: string; caption?: string; photo?: unknown; video?: unknown; document?: unknown; voice?: unknown
  reply_to_message?: TgMessage; is_automatic_forward?: boolean
}
interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage } }

interface State { offset: number; links: [number, number][] }
function loadState(): State {
  try { const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')); return { offset: s.offset ?? 0, links: s.links ?? [] } } catch { return { offset: 0, links: [] } }
}

export default defineNitroPlugin((nitroApp) => {
  if (!IS_PUBLIC || !TOKEN || !CHANNEL) return
  // api.telegram.org отдаёт и IPv6-адрес; на сервере без рабочего IPv6 fetch ждёт его до таймаута и не пробует IPv4
  setDefaultResultOrder('ipv4first')
  mkdirSync(DIR, { recursive: true })
  const state = loadState()
  /** сообщение у владельца → чат игрока: по нему ответ находит адресата */
  const links = new Map<number, number>(state.links)
  const topics = new Map<number, Topic>()
  const recent = new Map<number, number[]>()
  const thanked = new Map<number, number>()
  let owner = Number(process.env.TELEGRAM_OWNER_ID) || 0
  let stopped = false
  let abort: AbortController | null = null

  const save = () => {
    const tail = [...links].slice(-3000)
    writeFileSync(STATE_FILE, JSON.stringify({ offset: state.offset, links: tail }))
  }
  const log = (entry: Record<string, unknown>) => appendFileSync(INBOX, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  async function api<T = unknown>(method: string, body: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    abort = new AbortController()
    const timer = setTimeout(() => abort?.abort(), timeoutMs)
    try {
      const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal
      })
      const data = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` })) as { ok: boolean; result: T; description?: string }
      if (!data.ok) throw new Error(`${method}: ${data.description}`)
      return data.result
    } finally { clearTimeout(timer) }
  }
  const send = (chat: number, text: string, extra: Record<string, unknown> = {}) => api<TgMessage>('sendMessage', { chat_id: chat, text, link_preview_options: { is_disabled: true }, ...extra })

  async function findOwner() {
    if (owner) return owner
    const admins = await api<{ status: string; user: TgUser }[]>('getChatAdministrators', { chat_id: CHANNEL })
    owner = admins.find(a => a.status === 'creator')?.user.id ?? 0
    return owner
  }

  const nameOf = (u?: TgUser) => u ? [[u.first_name, u.last_name].filter(Boolean).join(' '), u.username ? `@${u.username}` : ''].filter(Boolean).join(' ') || `id ${u.id}` : 'кто-то'
  const kindOf = (m: TgMessage) => m.photo ? 'фото' : m.video ? 'видео' : m.voice ? 'голосовое' : m.document ? 'файл' : 'текст'
  const topicKeyboard = { inline_keyboard: (Object.keys(TOPICS) as Topic[]).map(t => [{ text: `${TOPICS[t].icon} ${TOPICS[t].label}`, callback_data: `topic:${t}` }]) }

  async function fromPlayer(m: TgMessage) {
    const user = m.from!
    const text = m.text?.trim() ?? ''
    if (text.startsWith('/start') || text === '/help') {
      const payload = text.split(/\s+/)[1] as Topic | undefined
      if (payload && TOPICS[payload]) {
        topics.set(user.id, payload)
        await send(m.chat.id, `${HELLO}\n\n${TOPICS[payload].icon} ${TOPICS[payload].label}. ${TOPICS[payload].prompt}`)
      } else {
        await send(m.chat.id, `${HELLO}\n\nО чём хотите написать?`, { reply_markup: topicKeyboard })
      }
      return
    }
    const now = Date.now()
    const times = (recent.get(user.id) ?? []).filter(t => now - t < 3_600_000)
    times.push(now)
    recent.set(user.id, times)
    const topic = topics.get(user.id)
    log({ kind: 'message', topic: topic ?? null, from: { id: user.id, name: nameOf(user) }, type: kindOf(m), text: m.text ?? m.caption ?? '' })
    if (times.length > PER_HOUR) return

    const to = await findOwner().catch(() => 0)
    if (to) {
      try {
        const head = await send(to, `${topic ? `${TOPICS[topic].icon} ${TOPICS[topic].label}` : '✉️ Сообщение'} · ${nameOf(user)}`)
        const fwd = await api<TgMessage>('forwardMessage', { chat_id: to, from_chat_id: m.chat.id, message_id: m.message_id })
        links.set(head.message_id, m.chat.id)
        links.set(fwd.message_id, m.chat.id)
        save()
      } catch (e) {
        // владелец ещё не нажал «Старт» у бота — сообщение осталось в журнале
        console.warn('бот: не переслать владельцу —', (e as Error).message)
      }
    }
    if (now - (thanked.get(user.id) ?? 0) > THANKS_GAP) {
      thanked.set(user.id, now)
      await send(m.chat.id, THANKS)
    }
  }

  async function fromOwner(m: TgMessage) {
    const target = m.reply_to_message ? links.get(m.reply_to_message.message_id) : undefined
    if (target) {
      await api('copyMessage', { chat_id: target, from_chat_id: m.chat.id, message_id: m.message_id })
      log({ kind: 'reply', to: target, type: kindOf(m), text: m.text ?? m.caption ?? '' })
      await send(m.chat.id, '✓ Ответ отправлен', { reply_parameters: { message_id: m.message_id } })
      return
    }
    await send(m.chat.id, 'Сюда приходят сообщения игроков. Чтобы ответить, ответьте на пересланное сообщение или на строку над ним — бот передаст ответ игроку.')
  }

  async function handle(u: TgUpdate) {
    const q = u.callback_query
    if (q?.data?.startsWith('topic:')) {
      const t = q.data.slice(6) as Topic
      await api('answerCallbackQuery', { callback_query_id: q.id })
      if (TOPICS[t] && q.message) {
        topics.set(q.from.id, t)
        await send(q.message.chat.id, `${TOPICS[t].icon} ${TOPICS[t].label}. ${TOPICS[t].prompt}`)
      }
      return
    }
    const m = u.message
    if (!m?.from || m.from.is_bot) return
    if (m.chat.type === 'private') {
      if (m.from.id === await findOwner().catch(() => 0)) await fromOwner(m)
      else await fromPlayer(m)
      return
    }
    // комментарии под постами канала (группа обсуждения) — в журнал для сводки
    if (!m.is_automatic_forward && (m.text || m.caption)) {
      log({ kind: 'comment', from: { id: m.from.id, name: nameOf(m.from) }, post: (m.reply_to_message?.text ?? m.reply_to_message?.caption ?? '').slice(0, 60), text: m.text ?? m.caption })
    }
  }

  async function loop() {
    let backoff = 2000
    while (!stopped) {
      try {
        const updates = await api<TgUpdate[]>('getUpdates', { offset: state.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 65_000)
        backoff = 2000
        for (const u of updates) {
          state.offset = u.update_id + 1
          await handle(u).catch(e => console.warn('бот:', (e as Error).message))
        }
        if (updates.length) save()
      } catch (e) {
        if (stopped) break
        console.warn('бот: опрос —', (e as Error).message)
        await sleep(backoff)
        backoff = Math.min(60_000, backoff * 2)
      }
    }
  }

  void loop()
  nitroApp.hooks.hook('close', () => { stopped = true; abort?.abort() })
})
