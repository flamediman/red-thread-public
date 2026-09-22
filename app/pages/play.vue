<script setup lang="ts">
import { abilityUses } from '~/utils/ability'
import { INKS } from '#shared/inks'

import { ART } from '~/utils/art'

useHead({ title: 'Красная нить' })

const { state, you, send, connected, ready, kicked, noRoom, needPin, roomCode, enterRoom, enterPin, joinGame, updateProfile, savedName, savedPhoto } = useGame('player')
/* в сети код комнаты приходит в ссылке из QR (?r=ABCDEF); без него — последний сохранённый */
const route = useRoute()
enterRoom(typeof route.query.r === 'string' ? route.query.r : null, false, typeof route.query.p === 'string' ? route.query.p : null)
function onRoom(code: string) {
  enterRoom(code)
  void navigateTo({ query: { r: code } }, { replace: true })
}

const screen = computed(() => state.value?.screen ?? 'menu')
/* тема телефона: пока дело не выбрано — бренд, дальше — сеттинг дела */
const brand = computed(() => !state.value || screen.value === 'menu')
useHead({ htmlAttrs: { 'data-setting': computed(() => brand.value ? 'brand' : state.value?.setting.theme ?? 'noir') } })
const myColor = computed(() => (you.value ? INKS[you.value.ink] ?? INKS[0] : INKS[0]))
const { seconds } = useCountdown(computed(() => state.value?.deadline ?? null))

/* мой сыщик: способность и пример — по кнопке на любом экране партии */
const roleOpen = ref(false)
const myRole = computed(() => state.value?.detectives.find(d => d.id === you.value?.detectiveId) ?? null)
const usesText = computed(() => abilityUses(myRole.value?.ability, you.value?.usesLeft))

/* правка профиля из лобби */
const editing = ref(false)
const editingProfile = computed(() => {
  const me = you.value
  if (!me || !editing.value) return undefined
  return { id: me.id, name: me.name, ink: me.ink, photo: savedPhoto(), photoVersion: me.photo }
})
function onJoin(name: string, ink: number, photo: string | null, photoChanged: boolean) {
  if (you.value && editing.value) { updateProfile(name, ink, photo, photoChanged); editing.value = false }
  else joinGame(name, ink, photo)
}
</script>

<template>
  <div class="pad" :style="{ '--my-ink': myColor }">
    <TheLoader v-if="!ready && !kicked" />
    <p v-else-if="!connected" class="pad__offline">Нет связи — переподключаюсь…</p>
    <p v-else-if="kicked" class="pad__offline">{{ kicked }}</p>

    <PadRoom v-else-if="noRoom !== null || needPin !== null" :reason="needPin ?? noRoom ?? ''" :code="roomCode" :pin="needPin !== null" @enter="onRoom" @pin="enterPin" />

    <PadJoin
      v-else-if="!you || (editing && screen === 'lobby')"
      :players="state?.players ?? []"
      :saved-name="savedName()"
      :case-title="brand ? null : state?.caseInfo.title ?? null"
      :editing="editingProfile"
      @join="onJoin"
      @back="editing = false"
    />

    <PadLobby v-else-if="screen === 'lobby' && state" :you="you" :state="state" @send="send" @edit="editing = true" />
    <!-- экраны партии: сверху кнопка «мой сыщик», под ней текущий экран -->
    <div v-else-if="state" class="pad__game">
      <button v-if="myRole" class="me" type="button" @click="roleOpen = true">
        <img class="face" :src="ART.detective(myRole.id)" alt="">
        <span class="me__text"><b>{{ myRole.title }}</b><small>{{ you.name }} · способность</small></span>
        <span class="me__more">?</span>
      </button>
      <PadTutorial v-if="screen === 'tutorial'" :you="you" :state="state" />
      <PadPlan v-else-if="screen === 'plan'" :you="you" :state="state" :seconds-left="seconds" @send="send" />
      <PadField v-else-if="screen === 'field'" :you="you" :state="state" @send="send" />
      <PadVote v-else-if="screen === 'accuse'" :you="you" :state="state" :seconds-left="seconds" @send="send" />
      <PadFinal v-else-if="screen === 'final'" :you="you" :state="state" />
      <PadWait v-else :you="you" :state="state" :seconds-left="seconds" @send="send" />
    </div>

    <div v-if="roleOpen && myRole" class="veil" @click.self="roleOpen = false">
      <div class="veil__card" role="dialog" aria-modal="true">
        <div class="veil__role">
          <img class="face" :src="ART.detective(myRole.id)" alt="">
          <div><h2 class="veil__title">{{ myRole.title }}</h2><p class="veil__who">{{ myRole.name }}</p></div>
        </div>
        <p class="veil__text"><b>Способность.</b> {{ myRole.ability.text }}</p>
        <p class="veil__text veil__example"><b>Пример.</b> {{ myRole.ability.example }}</p>
        <p class="veil__text veil__uses">{{ usesText }}</p>
        <div class="veil__actions"><button class="btn" @click="roleOpen = false">Понятно</button></div>
      </div>
    </div>
  </div>
</template>
