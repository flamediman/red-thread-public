// Канал игры в Telegram через бота: посты, голосования, отзывы.
// В .env: TELEGRAM_BOT_TOKEN (от @BotFather), TELEGRAM_CHANNEL (@имя_канала или -100…), бот — админ канала.
// Для отзывов к каналу привязывается группа обсуждения, бот добавляется туда (privacy mode: Disable).
//
//   node tools/telegram.mjs me                               — проверить бота и канал
//   node tools/telegram.mjs post <файл.md>                   — опубликовать пост (разметка HTML Telegram)
//   node tools/telegram.mjs poll "Вопрос" "Вариант 1" "Вариант 2" [...]  — голосование (анонимное, в канале иначе нельзя)
//   node tools/telegram.mjs poll-file <файл.json>            — голосование из файла { question, options, multiple }
//   node tools/telegram.mjs goals <goals.json>               — пост сборов со шкалами; повторный запуск обновляет тот же пост
//   node tools/telegram.mjs pin <номер сообщения>            — закрепить пост в канале без уведомления
//   node tools/telegram.mjs edit <номер> <файл.md>           — заменить текст опубликованного поста (превью ссылки перечитается)
//   node tools/telegram.mjs updates                          — новые комментарии и итоги голосований (только пока бот
//                                                              не слушает на сервере: там входящие — .data/telegram/inbox.jsonl)
//   node tools/telegram.mjs --dry post …                     — показать, что уйдёт, ничего не отправляя
//
// В тексте поста подставляются {{SITE_URL}}, {{DONATE_URL}} и {{BOT_URL}} из .env — ссылки с реквизитами в файлы не пишем.
// Шапка поста до строки «---» (необязательна): «preview: on» — показать превью ссылки, «button: Текст | ссылка» — кнопка под постом.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnv, root } from './paths.mjs'

const env = { ...readEnv(), ...process.env }
const TOKEN = env.TELEGRAM_BOT_TOKEN
const CHANNEL = env.TELEGRAM_CHANNEL
const args = process.argv.slice(2)
const dry = args[0] === '--dry' ? !!args.shift() : false
const [cmd, ...rest] = args

if (!TOKEN || !CHANNEL) {
  console.error('нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL в .env')
  process.exit(1)
}

async function api(method, body = {}) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  const data = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))
  if (!data.ok) throw new Error(`${method}: ${data.description}`)
  return data.result
}

const SITE_URL = (env.SITE_URL || 'https://redthread-game.ru').replace(/\/+$/, '')
const vars = { SITE_URL, DONATE_URL: env.DONATE_URL || '', BOT_URL: env.TELEGRAM_BOT_URL || '' }
/** {{ИМЯ}} → значение из .env; пустое значение — ошибка, чтобы в канал не ушла пустая ссылка */
const fill = (text) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!vars[k]) throw new Error(`в .env нет значения для {{${k}}}`)
  return vars[k]
})
/** шапка поста: превью ссылки и кнопки-ссылки под постом */
function parsePost(raw) {
  const parts = raw.split(/^---$/m)
  const head = parts.length > 1 ? parts.shift() : ''
  const text = fill(parts.join('---').trim())
  const buttons = [...head.matchAll(/^button:\s*(.+?)\s*\|\s*(\S+)\s*$/gm)].map(m => [{ text: m[1], url: fill(m[2]) }])
  return { text, preview: /^preview:\s*on\s*$/m.test(head), buttons }
}
const rub = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
/** пост сборов: у каждой цели шкала из десяти делений */
function renderGoals(g) {
  const lines = [`<b>${g.title}</b>`, '']
  for (const goal of g.goals) {
    const share = Math.max(0, Math.min(1, goal.raised / goal.target))
    const cells = Math.round(share * 10)
    lines.push(`<b>${goal.name}</b> — ${rub(goal.target)}`)
    if (goal.note) lines.push(goal.note)
    lines.push(`${'▰'.repeat(cells)}${'▱'.repeat(10 - cells)}  ${rub(goal.raised)} · ${Math.floor(share * 100)}%`, '')
  }
  if (g.footer) lines.push(g.footer)
  if (g.updated) lines.push('', `<i>Обновлено ${g.updated}</i>`)
  return fill(lines.join('\n').trim())
}

/** где помнить, до какого обновления уже прочитали */
const STATE = resolve(root, '.data/telegram-offset.json')
const offset = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')).offset ?? 0 } catch { return 0 } }
const saveOffset = (n) => { mkdirSync(resolve(root, '.data'), { recursive: true }); writeFileSync(STATE, JSON.stringify({ offset: n })) }

async function sendPoll(question, options, multiple = false) {
  if (options.length < 2 || options.length > 10) throw new Error('вариантов должно быть от 2 до 10')
  const body = { chat_id: CHANNEL, question, options: options.map(text => ({ text })), is_anonymous: true, allows_multiple_answers: multiple }
  if (dry) { console.log(JSON.stringify(body, null, 2)); return }
  const m = await api('sendPoll', body)
  console.log(`голосование опубликовано: сообщение ${m.message_id}`)
}

switch (cmd) {
  case 'me': {
    const me = await api('getMe')
    const chat = await api('getChat', { chat_id: CHANNEL })
    const admins = await api('getChatAdministrators', { chat_id: CHANNEL }).catch(() => [])
    const bot = admins.find(a => a.user.id === me.id)
    console.log(`бот @${me.username} · канал «${chat.title}» · бот ${bot ? 'админ' : 'НЕ админ — добавьте его в администраторы'}`)
    if (chat.linked_chat_id) console.log(`группа обсуждения: ${chat.linked_chat_id}`)
    else console.log('группы обсуждения нет — комментарии к постам не соберутся')
    break
  }
  case 'post': {
    const file = rest[0]
    if (!file || !existsSync(file)) throw new Error('укажите файл поста')
    const { text, preview, buttons } = parsePost(readFileSync(file, 'utf8'))
    const body = { chat_id: CHANNEL, text, parse_mode: 'HTML', link_preview_options: preview ? { prefer_large_media: true } : { is_disabled: true }, ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}) }
    if (dry) { console.log(text); if (buttons.length) console.log('\nкнопки:', buttons.map(b => b[0].text).join(' · ')); console.log(`превью ссылки: ${preview ? 'да' : 'нет'}`); break }
    const m = await api('sendMessage', body)
    console.log(`пост опубликован: сообщение ${m.message_id}`)
    break
  }
  case 'goals': {
    const file = rest[0]
    if (!file || !existsSync(file)) throw new Error('укажите файл сборов')
    const g = JSON.parse(readFileSync(file, 'utf8'))
    g.updated = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    const text = renderGoals(g)
    const reply_markup = g.button ? { inline_keyboard: [[{ text: g.button, url: fill('{{DONATE_URL}}') }]] } : undefined
    if (dry) { console.log(text); if (g.button) console.log(`\nкнопка: ${g.button}`); break }
    if (g.message_id) {
      await api('editMessageText', { chat_id: CHANNEL, message_id: g.message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup })
      console.log(`сборы обновлены: сообщение ${g.message_id}`)
    } else {
      const m = await api('sendMessage', { chat_id: CHANNEL, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup })
      g.message_id = m.message_id
      console.log(`сборы опубликованы: сообщение ${m.message_id}`)
    }
    delete g.updated
    writeFileSync(file, JSON.stringify(g, null, 2) + '\n')
    break
  }
  case 'poll': {
    const [question, ...options] = rest
    await sendPoll(question, options)
    break
  }
  case 'poll-file': {
    const { question, options, multiple } = JSON.parse(readFileSync(rest[0], 'utf8'))
    await sendPoll(question, options, !!multiple)
    break
  }
  case 'edit': {
    const id = Number(rest[0]), file = rest[1]
    if (!id || !file || !existsSync(file)) throw new Error('укажите номер сообщения и файл поста')
    const { text, preview, buttons } = parsePost(readFileSync(file, 'utf8'))
    const link = preview ? (text.match(/https?:\/\/\S+/)?.[0] ?? '') : ''
    const body = { chat_id: CHANNEL, message_id: id, text, parse_mode: 'HTML', link_preview_options: preview ? { url: link, prefer_large_media: true } : { is_disabled: true }, ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}) }
    if (dry) { console.log(JSON.stringify(body, null, 2)); break }
    await api('editMessageText', body)
    console.log(`пост обновлён: сообщение ${id}`)
    break
  }
  case 'pin': {
    const id = Number(rest[0])
    if (!id) throw new Error('укажите номер сообщения')
    if (dry) { console.log(`закрепить сообщение ${id}`); break }
    await api('pinChatMessage', { chat_id: CHANNEL, message_id: id, disable_notification: true })
    console.log(`закреплено сообщение ${id}`)
    break
  }
  case 'updates': {
    const updates = await api('getUpdates', { offset: offset(), timeout: 0, allowed_updates: ['message', 'channel_post', 'poll', 'edited_message'] })
    for (const u of updates) {
      if (u.poll) {
        const total = u.poll.total_voter_count
        console.log(`\nголосование «${u.poll.question}» — проголосовало ${total}${u.poll.is_closed ? ', закрыто' : ''}`)
        for (const o of u.poll.options) console.log(`  ${String(o.voter_count).padStart(4)}  ${o.text}`)
      }
      const m = u.message
      if (m?.text && !m.from?.is_bot) {
        const who = m.from?.username ? `@${m.from.username}` : m.from?.first_name ?? 'кто-то'
        const when = new Date(m.date * 1000).toLocaleString('ru-RU')
        const reply = m.reply_to_message?.text ? ` (к посту: «${m.reply_to_message.text.slice(0, 40)}…»)` : ''
        console.log(`\n${when} · ${who}${reply}\n  ${m.text.replace(/\n/g, '\n  ')}`)
      }
    }
    if (updates.length) saveOffset(updates.at(-1).update_id + 1)
    console.log(updates.length ? `\nобновлений: ${updates.length}` : 'новых обновлений нет')
    break
  }
  default:
    console.log('команды: me, post <файл>, goals <файл.json>, pin <номер>, edit <номер> <файл>, poll "вопрос" "вариант"…, poll-file <файл.json>, updates')
}
