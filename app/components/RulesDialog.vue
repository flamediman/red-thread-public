<script setup lang="ts">
/* Правила простыми словами, с примерами. На экране — крупная карточка в две колонки, на телефоне — лист на весь экран. */
import { rulesFor } from '~/utils/rules'

const props = defineProps<{ variant?: 'stage' | 'pad'; mode?: 'rounds' | 'realtime' }>()
const rules = computed(() => rulesFor(props.mode))
const open = defineModel<boolean>({ default: false })

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open.value = false }
watch(open, (v) => {
  if (!import.meta.client) return
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => { if (import.meta.client) window.removeEventListener('keydown', onKey) })
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="veil rules" :class="`rules--${variant ?? 'stage'}`" @click.self="open = false">
        <div class="veil__card rules__card" role="dialog" aria-modal="true" aria-label="Правила">
          <div class="rules__head">
            <h2 class="veil__title">Правила</h2>
            <button class="rules__close" type="button" aria-label="Закрыть" @click="open = false">×</button>
          </div>
          <ol class="rules__list">
            <li v-for="(r, i) in rules" :key="r.title" class="rules__item">
              <span class="rules__num tabnum">{{ i + 1 }}</span>
              <div>
                <h3 class="rules__title">{{ r.title }}</h3>
                <p class="rules__text">{{ r.text }}</p>
                <p class="rules__example"><b>Пример.</b> {{ r.example }}</p>
              </div>
            </li>
          </ol>
          <div class="veil__actions"><button class="btn" type="button" @click="open = false">Понятно</button></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
