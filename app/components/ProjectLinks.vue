<script setup lang="ts">
/* Канал игры и поддержка проекта. На экране — кнопка и карточка с QR (телевизор не кликают, по коду наводят телефон). */
const { config } = useConfig()
const open = ref(false)
const cards = computed(() => [
  config.value.telegram && { id: 'tg', url: config.value.telegram, title: 'Канал игры', text: 'Новости, голосования за новые дела, обратная связь' },
  config.value.donate && { id: 'donate', url: config.value.donate, title: 'Поддержать', text: 'Любая сумма — на голоса, музыку и иллюстрации новых дел' }
].filter((c): c is { id: string; url: string; title: string; text: string } => !!c))
/** подпись под кодом: короткий адрес как есть; длинную ссылку банка с реквизитами на экран не выводим */
const BANKS = /sberbank|tbank|tinkoff|nspk|alfabank|vtb|yoomoney/
function short(url: string) {
  const clean = url.replace(/^https:\/\//, '').replace(/\/$/, '')
  if (clean.length <= 32) return clean
  try { return BANKS.test(new URL(url).hostname) ? 'перевод по СБП из любого банка' : new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}
</script>

<template>
  <template v-if="cards.length">
    <button class="links-btn" type="button" @click="open = true">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
      {{ config.donate ? 'Канал и поддержка' : 'Канал игры' }}
    </button>
    <Teleport to="body">
      <div v-if="open" class="veil" @click.self="open = false">
        <div class="veil__card links" role="dialog" aria-modal="true">
          <h2 class="veil__title">{{ config.donate ? 'Новые дела делаем вместе' : 'Канал игры' }}</h2>
          <p class="veil__text">
            <template v-if="config.donate">Каждое дело — это сценарий, голоса, музыка и иллюстрации. В канале вы выбираете следующий сюжет, а поддержка помогает ему выйти быстрее.</template>
            <template v-else>Новые дела, голосования за следующие сюжеты и разговоры после партий.</template>
            Наведите камеру телефона на код.
          </p>
          <div class="links__cards">
            <a v-for="c in cards" :key="c.id" class="links__card" :href="c.url" target="_blank" rel="noopener">
              <span class="links__qr"><Qrcode :value="c.url" white-color="#efe6d3" black-color="#1c1a1f" /></span>
              <b>{{ c.title }}</b>
              <span>{{ c.text }}</span>
              <small>{{ short(c.url) }}</small>
            </a>
          </div>
          <div class="veil__actions"><button class="btn" type="button" @click="open = false">Закрыть</button></div>
        </div>
      </div>
    </Teleport>
  </template>
</template>
