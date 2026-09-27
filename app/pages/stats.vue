<script setup lang="ts">
/* Статистика для владельца: вход по паролю, дальше — сводка по комнатам, партиям детективов и «Туману». Данные — только
   то, что и так лежит на сервере (см. server/utils/stats.ts); ссылки на страницу нигде нет, поиск её не видит */
import type { Stats } from '../../server/utils/stats'

useHead({ title: 'Статистика · Красная нить', htmlAttrs: { 'data-setting': 'brand' }, meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const stats = ref<Stats | null>(null)
const state = ref<'loading' | 'login' | 'ready' | 'off'>('loading')
const password = ref('')
const reveal = ref(false)
const error = ref('')
const busy = ref(false)
const input = ref<HTMLInputElement | null>(null)

async function load() {
  try {
    stats.value = await $fetch<Stats>('/api/stats')
    state.value = 'ready'
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode
    state.value = code === 404 ? 'off' : 'login'
    if (state.value === 'login') nextTick(() => input.value?.focus())
  }
}
async function login() {
  if (!password.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/stats/login', { method: 'POST', body: { password: password.value } })
    password.value = ''
    await load()
  } catch (e) {
    error.value = (e as { statusMessage?: string; data?: { statusMessage?: string } }).data?.statusMessage ?? 'Не получилось войти'
  } finally { busy.value = false }
}
async function logout() {
  await $fetch('/api/stats/logout', { method: 'POST' }).catch(() => {})
  stats.value = null
  state.value = 'login'
}
onMounted(load)

/* «5 мин назад», «сегодня 21:30», «вчера 09:12», «24.09 14:05» */
function when(t: number | null | undefined) {
  if (!t) return '—'
  const d = new Date(t), now = new Date()
  const min = Math.round((now.getTime() - t) / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (days === 0) return `сегодня ${hm}`
  if (days === 1) return `вчера ${hm}`
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${hm}`
}
const OUTCOME: Record<string, string> = { solved: 'раскрыто', partial: 'частично', failed: 'провал' }
const size = (b: number) => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} КБ` : `${(b / 1024 / 1024).toFixed(1)} МБ`
const pct = (a: number, b: number) => b ? `${Math.round((a / b) * 100)} %` : '—'
</script>

<template>
  <main class="stats">
    <!-- вход -->
    <form v-if="state === 'login'" class="stats__login" @submit.prevent="login">
      <h1 class="display">Статистика</h1>
      <p class="stats__muted">Только для владельца «Красной нити».</p>
      <label class="stats__field">
        <span>Пароль</span>
        <span class="stats__pass">
          <input ref="input" v-model="password" :type="reveal ? 'text' : 'password'" autocomplete="current-password" spellcheck="false" autocapitalize="off" required>
          <button type="button" class="stats__eye" :aria-label="reveal ? 'Скрыть пароль' : 'Показать пароль'" @click="reveal = !reveal">{{ reveal ? 'скрыть' : 'показать' }}</button>
        </span>
      </label>
      <p v-if="error" class="stats__error" role="alert">{{ error }}</p>
      <button class="btn btn--stamp" type="submit" :disabled="busy || !password">{{ busy ? 'Проверяю…' : 'Войти' }}</button>
    </form>

    <p v-else-if="state === 'off'" class="stats__muted stats__center">Нет такой страницы.</p>
    <p v-else-if="state === 'loading'" class="stats__muted stats__center">Загружаю…</p>

    <template v-else-if="stats">
      <header class="stats__head">
        <div>
          <h1 class="display">Статистика</h1>
          <p class="stats__muted">Обновлено {{ when(stats.now) }} · данные за срок хранения на сервере</p>
        </div>
        <div class="stats__actions">
          <button type="button" class="stats__btn" @click="load">Обновить</button>
          <button type="button" class="stats__btn" @click="logout">Выйти</button>
        </div>
      </header>

      <!-- сводка -->
      <section class="stats__cards">
        <article class="stats__card">
          <h2 class="label">Комнаты</h2>
          <p class="stats__big tabnum">{{ stats.rooms.created.week }}<small>за неделю</small></p>
          <p class="stats__muted tabnum">сегодня {{ stats.rooms.created.day }} · за месяц {{ stats.rooms.created.month }} · на сервере {{ stats.rooms.total }}</p>
          <p v-if="stats.rooms.live" class="stats__live">● сейчас играют: {{ stats.rooms.live }}</p>
        </article>
        <article class="stats__card">
          <h2 class="label">Партии детективов</h2>
          <p class="stats__big tabnum">{{ stats.games.week }}<small>за неделю</small></p>
          <p class="stats__muted tabnum">за месяц {{ stats.games.month }} · всего {{ stats.games.total }} · раскрыто {{ pct(stats.games.solved, stats.games.total) }}</p>
        </article>
        <article v-for="s in stats.solo" :key="s.id" class="stats__card">
          <h2 class="label">«{{ s.title }}»</h2>
          <p class="stats__big tabnum">{{ s.week }}<small>играли за неделю</small></p>
          <p class="stats__muted tabnum">сегодня {{ s.day }} · начато {{ s.started }} · до концовки {{ s.ended }} · в среднем {{ s.avgMinutes }} мин</p>
        </article>
        <article v-if="stats.feedback !== null" class="stats__card">
          <h2 class="label">Бот отзывов</h2>
          <p class="stats__big tabnum">{{ stats.feedback }}<small>сообщений</small></p>
        </article>
      </section>

      <!-- по делам -->
      <section v-if="stats.games.byCase.length" class="stats__block">
        <h2 class="label">По делам</h2>
        <div class="stats__scroll">
          <table class="stats__table">
            <thead><tr><th>Дело</th><th>Партий</th><th>Раскрыто</th><th>Частично</th><th>Провал</th><th>В среднем</th><th>Игроков</th></tr></thead>
            <tbody>
              <tr v-for="c in stats.games.byCase" :key="c.title">
                <td>{{ c.title }}</td><td class="tabnum">{{ c.games }}</td><td class="tabnum">{{ c.solved }}</td><td class="tabnum">{{ c.partial }}</td><td class="tabnum">{{ c.failed }}</td>
                <td class="tabnum">{{ Math.round(c.minutes / c.games) }} мин</td><td class="tabnum">{{ (c.players / c.games).toFixed(1) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- комнаты -->
      <section class="stats__block">
        <h2 class="label">Комнаты · последние {{ stats.rooms.rows.length }}</h2>
        <div class="stats__scroll">
          <table class="stats__table">
            <thead><tr><th>Код</th><th>Последнее действие</th><th>Создана</th><th>Что на экране</th><th>Игроки</th><th>Партий</th></tr></thead>
            <tbody>
              <tr v-for="r in stats.rooms.rows" :key="r.code" :class="{ 'stats__row--live': r.live }">
                <td class="tabnum">{{ r.code }}</td>
                <td>{{ when(r.touchedAt) }}</td>
                <td>{{ when(r.createdAt) }}</td>
                <td><span v-if="r.live" class="stats__dot" aria-label="идёт" />{{ r.screen }}<template v-if="r.case"> · {{ r.case }}</template><template v-if="r.round"> · ход {{ r.round }}</template></td>
                <td>{{ r.players.length ? r.players.join(', ') : '—' }}</td>
                <td class="tabnum">{{ r.finished || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- завершённые партии -->
      <section v-if="stats.games.recent.length" class="stats__block">
        <h2 class="label">Завершённые партии</h2>
        <div class="stats__scroll">
          <table class="stats__table">
            <thead><tr><th>Когда</th><th>Дело</th><th>Итог</th><th>Игроков</th><th>Длилась</th><th>Комната</th></tr></thead>
            <tbody>
              <tr v-for="g in stats.games.recent" :key="`${g.room}-${g.at}`">
                <td>{{ when(g.at) }}</td><td>{{ g.case }}</td><td>{{ OUTCOME[g.outcome] ?? g.outcome }}</td><td class="tabnum">{{ g.players }}</td><td class="tabnum">{{ g.minutes }} мин</td><td class="tabnum">{{ g.room }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- «Туман»: без мест и концовок — только доля пройденного -->
      <section v-for="s in stats.solo.filter(x => x.recent.length)" :key="`r-${s.id}`" class="stats__block">
        <h2 class="label">«{{ s.title }}» · последние партии</h2>
        <div class="stats__scroll">
          <table class="stats__table">
            <thead><tr><th>Последний заход</th><th>В игре</th><th>Пройдено мест</th><th>Смертей</th><th>Упокоено</th><th>Концовка</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in s.recent" :key="i">
                <td>{{ when(r.at) }}</td><td class="tabnum">{{ r.minutes }} мин</td><td class="tabnum">{{ r.progress }} %</td><td class="tabnum">{{ r.deaths }}</td><td class="tabnum">{{ r.kills }}</td><td>{{ r.ended ? 'да' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <footer class="stats__muted stats__foot">
        Данные игры на сервере занимают {{ size(stats.storage.bytes) }}. Хранятся: комнаты — {{ stats.storage.keep.rooms }} дней с последнего
        действия (где партию не начали — {{ stats.storage.keep.emptyRooms }} дня), в комнате — последние {{ stats.storage.keep.roomHistory }} партий;
        «Туман» — {{ stats.storage.keep.solo }} дней с последнего захода. Отдельно статистика не копится.
      </footer>
    </template>
  </main>
</template>

<style scoped lang="scss">
.stats { min-height: 100dvh; padding: clamp(1rem, 4vw, 3rem) clamp(1rem, 4vw, 3rem) 3rem; background: var(--desk, #0e1116); color: var(--paper); font-family: var(--font-ui);
  &__center { display: grid; place-items: center; min-height: 60dvh; }
  &__muted { color: var(--paper-faint); font-size: 0.85rem; line-height: 1.5; }
  &__login { display: flex; flex-direction: column; gap: 1rem; width: min(24rem, 100%); margin: 12vh auto 0; padding: 1.6rem; border-radius: var(--radius-lg, 14px);
    background: rgba(18, 22, 29, 0.9); box-shadow: inset 0 0 0 1px var(--glass-line, rgba(255, 255, 255, 0.08));
    h1 { font-size: 2rem; } .btn { align-self: flex-start; } }
  &__field { display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.85rem; font-weight: 600; color: var(--paper-dim); }
  &__pass { display: flex; align-items: center; gap: 0.4rem; padding: 0 0.4rem 0 0.8rem; border-radius: 10px; background: rgba(26, 32, 41, 0.9); box-shadow: inset 0 0 0 1px rgba(241, 233, 216, 0.14);
    &:focus-within { box-shadow: inset 0 0 0 1px var(--brass, #d2b15a); }
    input { flex: 1; min-width: 0; height: 2.8rem; border: 0; background: none; color: var(--paper); font: inherit; font-size: 1rem; font-weight: 500; letter-spacing: 0.02em; &:focus { outline: none; } } }
  &__eye { padding: 0.35rem 0.6rem; border-radius: 7px; font-size: 0.75rem; font-weight: 600; color: var(--paper-faint); &:hover { color: var(--paper); background: rgba(241, 233, 216, 0.06); } }
  &__error { color: #e07a6b; font-size: 0.85rem; }
  &__head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 1.6rem; h1 { margin-bottom: 0.35rem; font-size: clamp(1.8rem, 1.2rem + 2vw, 2.6rem); } }
  &__actions { display: flex; gap: 0.5rem; }
  &__btn { min-height: 2.3rem; padding: 0 0.95rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; color: var(--paper-2, var(--paper)); background: rgba(241, 233, 216, 0.04);
    box-shadow: inset 0 0 0 1px rgba(241, 233, 216, 0.18); transition: background-color var(--dur-fast, 0.15s) ease, box-shadow var(--dur-fast, 0.15s) ease;
    &:hover { background: rgba(241, 233, 216, 0.1); box-shadow: inset 0 0 0 1px rgba(241, 233, 216, 0.35); } }
  &__cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.8rem; margin-bottom: 1.6rem; }
  &__card { display: flex; flex-direction: column; gap: 0.35rem; padding: 1rem 1.1rem; border-radius: 12px; background: rgba(18, 22, 29, 0.85); box-shadow: inset 0 0 0 1px var(--glass-line, rgba(255, 255, 255, 0.08)); }
  &__big { font-family: var(--font-display); font-size: 2.2rem; font-weight: 700; line-height: 1.1; color: var(--paper);
    small { margin-left: 0.5rem; font-family: var(--font-ui); font-size: 0.8rem; font-weight: 600; color: var(--paper-faint); } }
  &__live { color: #8ad3a0; font-size: 0.85rem; font-weight: 600; }
  &__block { margin-bottom: 1.6rem; > .label { margin-bottom: 0.6rem; } }
  &__scroll { overflow-x: auto; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--glass-line, rgba(255, 255, 255, 0.08)); }
  &__table { width: 100%; border-collapse: collapse; font-size: 0.85rem; white-space: nowrap;
    th { position: sticky; top: 0; padding: 0.6rem 0.8rem; text-align: left; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--paper-faint); background: rgba(18, 22, 29, 0.95); }
    td { padding: 0.55rem 0.8rem; border-top: 1px solid rgba(241, 233, 216, 0.06); color: var(--paper-2, var(--paper)); }
    td:nth-child(5) { white-space: normal; min-width: 10rem; } }
  &__row--live td { background: rgba(138, 211, 160, 0.06); }
  &__dot { display: inline-block; width: 0.5rem; height: 0.5rem; margin-right: 0.45rem; border-radius: 50%; background: #8ad3a0; vertical-align: middle; }
  &__foot { max-width: 60rem; }
}
</style>
