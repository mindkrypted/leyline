<script setup>
import { nextTick, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  items: { type: Array, required: true },
})

const active = ref(0)
const tabs = ref([])
const lightbox = ref(false)
const dialog = ref(null)
const closeButton = ref(null)

let opener = null
let bodyState = null

function select(index) {
  active.value = index
}

function step(delta) {
  active.value =
    (active.value + delta + props.items.length) % props.items.length
}

function onTabKeydown(event) {
  const last = props.items.length - 1
  let next = null

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = active.value === last ? 0 : active.value + 1
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = active.value === 0 ? last : active.value - 1
  } else if (event.key === 'Home') {
    next = 0
  } else if (event.key === 'End') {
    next = last
  }

  if (next === null) return
  event.preventDefault()
  select(next)
  tabs.value[next]?.focus()
}

function openLightbox() {
  opener = document.activeElement
  lightbox.value = true
}

function closeLightbox() {
  lightbox.value = false
}

function onDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeLightbox()
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    step(1)
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    step(-1)
    return
  }

  if (event.key !== 'Tab') return

  const buttons = [...(dialog.value?.querySelectorAll('button') ?? [])]
  if (!buttons.length) return

  const current = document.activeElement
  if (!buttons.includes(current)) {
    event.preventDefault()
    buttons[0].focus()
    return
  }

  const first = buttons[0]
  const last = buttons[buttons.length - 1]

  if (event.shiftKey && current === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && current === last) {
    event.preventDefault()
    first.focus()
  }
}

function lockScroll() {
  bodyState = {
    overflow: document.body.style.overflow,
    padding: document.body.style.paddingRight,
  }
  const gap = window.innerWidth - document.documentElement.clientWidth
  if (gap > 0) document.body.style.paddingRight = `${gap}px`
  document.body.style.overflow = 'hidden'
}

function unlockScroll() {
  if (!bodyState) return
  document.body.style.overflow = bodyState.overflow
  document.body.style.paddingRight = bodyState.padding
  bodyState = null
}

watch(lightbox, async (open) => {
  if (open) {
    lockScroll()
    window.addEventListener('keydown', onDialogKeydown)
    await nextTick()
    closeButton.value?.focus()
    return
  }

  unlockScroll()
  window.removeEventListener('keydown', onDialogKeydown)
  opener?.focus?.()
  opener = null
})

onUnmounted(() => {
  window.removeEventListener('keydown', onDialogKeydown)
  unlockScroll()
})
</script>

<template>
  <div class="showcase">
    <div
      class="segmented"
      role="tablist"
      aria-label="Leyline views"
      :style="{ '--segments': items.length }"
    >
      <span
        class="segmented-thumb"
        aria-hidden="true"
        :style="{ transform: `translateX(${active * 100}%)` }"
      />
      <button
        v-for="(item, index) in items"
        :key="item.key"
        ref="tabs"
        class="segment"
        type="button"
        role="tab"
        :id="`view-tab-${item.key}`"
        :aria-selected="index === active"
        :aria-controls="`view-panel-${item.key}`"
        :tabindex="index === active ? 0 : -1"
        @click="select(index)"
        @keydown="onTabKeydown"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="frame">
      <div
        v-for="(item, index) in items"
        :key="item.key"
        class="panel"
        :class="{ 'is-active': index === active }"
        role="tabpanel"
        :id="`view-panel-${item.key}`"
        :aria-labelledby="`view-tab-${item.key}`"
        :aria-hidden="index !== active"
      >
        <button
          class="zoom"
          type="button"
          aria-haspopup="dialog"
          :aria-label="`Open the ${item.label} view full screen`"
          :tabindex="index === active ? 0 : -1"
          @click="openLightbox"
        >
          <img
            :src="item.image"
            :alt="item.alt"
            :loading="index === 0 ? 'eager' : 'lazy'"
            :fetchpriority="index === 0 ? 'high' : 'auto'"
            decoding="async"
          />
          <span class="zoom-hint" aria-hidden="true">
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4" />
            </svg>
            Expand
          </span>
        </button>
      </div>
    </div>

    <Transition name="caption" mode="out-in">
      <p class="caption" :key="items[active].key">{{ items[active].caption }}</p>
    </Transition>

    <Teleport to="body">
      <Transition name="lightbox">
        <div
          v-if="lightbox"
          ref="dialog"
          class="lightbox"
          role="dialog"
          aria-modal="true"
          :aria-label="`${items[active].label} view`"
        >
          <div class="lightbox-chrome">
            <p class="lightbox-title">
              {{ items[active].label }}
              <span class="lightbox-count">
                {{ active + 1 }} / {{ items.length }}
              </span>
            </p>
            <button
              ref="closeButton"
              class="lightbox-close"
              type="button"
              aria-label="Close full screen view"
              @click="closeLightbox"
            >
              <svg
                viewBox="0 0 16 16"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              >
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </button>
          </div>

          <div class="lightbox-stage" @click.self="closeLightbox">
            <figure class="lightbox-figure" @click.self="closeLightbox">
              <img
                class="lightbox-image"
                :src="items[active].image"
                :alt="items[active].alt"
                decoding="async"
              />
            </figure>

            <button
              class="lightbox-nav lightbox-prev"
              type="button"
              aria-label="Previous view"
              @click="step(-1)"
            >
              <svg
                viewBox="0 0 16 16"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M10 3.5L5.5 8l4.5 4.5" />
              </svg>
            </button>
            <button
              class="lightbox-nav lightbox-next"
              type="button"
              aria-label="Next view"
              @click="step(1)"
            >
              <svg
                viewBox="0 0 16 16"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6 3.5L10.5 8L6 12.5" />
              </svg>
            </button>
          </div>

          <p class="lightbox-caption">{{ items[active].caption }}</p>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.showcase {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  width: 100%;
}

.segmented {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(var(--segments, 4), minmax(0, 1fr));
  margin: 0 auto 20px;
  padding: 4px;
  width: fit-content;
  min-width: 340px;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 13px;
  background: rgb(255 255 255 / 3%);
}

.segmented-thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc((100% - 8px) / var(--segments, 4));
  border-radius: 10px;
  background: rgb(255 255 255 / 9%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 9%);
  transition: transform 460ms var(--ease-out);
}

.segment {
  position: relative;
  z-index: 1;
  padding: 8px 16px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #9a9a9a;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.005em;
  transition: color 220ms var(--ease-out);
}

.segment:hover {
  color: #cfcfcf;
}

.segment[aria-selected='true'] {
  color: #f2f2f2;
}

.segment:focus-visible {
  outline: 2px solid #8a78ff;
  outline-offset: 2px;
}

.frame {
  position: relative;
  z-index: 1;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 9%);
  border-radius: 16px;
  background: #101010;
  box-shadow:
    0 1px 0 rgb(255 255 255 / 5%) inset,
    0 40px 80px -32px rgb(0 0 0 / 85%),
    0 0 0 1px rgb(0 0 0 / 45%);
}

.frame::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  content: '';
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 7%);
}

.panel {
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: scale(1.012);
  pointer-events: none;
  transition:
    opacity 420ms var(--ease-out),
    transform 640ms var(--ease-out);
}

.panel.is-active {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}

.zoom {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}

.zoom img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.zoom:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px #8a78ff;
}

.zoom-hint {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 8px;
  background: rgb(12 12 12 / 82%);
  color: #d8d8d8;
  font-size: 11.5px;
  font-weight: 500;
  opacity: 0;
  transition: opacity 200ms var(--ease-out);
}

.zoom:hover .zoom-hint,
.zoom:focus-visible .zoom-hint {
  opacity: 1;
}

@media (hover: none) {
  .zoom-hint {
    opacity: 0.8;
  }
}

.caption {
  position: relative;
  z-index: 1;
  margin: 18px auto 0;
  min-height: 3.2em;
  max-width: 640px;
  color: #9a9a9a;
  font-size: 14px;
  line-height: 1.6;
  text-align: center;
}

.caption-enter-active {
  transition:
    opacity 260ms var(--ease-out),
    transform 260ms var(--ease-out);
}

.caption-leave-active {
  transition:
    opacity 140ms ease-in,
    transform 140ms ease-in;
}

.caption-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.caption-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  padding: 16px 16px 14px;
  background: #0a0a0a;
  color: #ececec;
}

.lightbox-chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 2px 12px;
}

.lightbox-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  color: #e8e8e8;
  font-size: 13px;
  font-weight: 500;
}

.lightbox-count {
  color: #8a8a8a;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.lightbox-close,
.lightbox-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 12%);
  background: rgb(255 255 255 / 4%);
  color: #d0d0d0;
  transition:
    background-color 180ms var(--ease-out),
    border-color 180ms var(--ease-out),
    color 180ms var(--ease-out);
}

.lightbox-close {
  width: 34px;
  height: 34px;
  border-radius: 9px;
}

.lightbox-close:hover,
.lightbox-nav:hover {
  border-color: rgb(255 255 255 / 22%);
  background: rgb(255 255 255 / 9%);
  color: #fff;
}

.lightbox-close:focus-visible,
.lightbox-nav:focus-visible {
  outline: 2px solid #8a78ff;
  outline-offset: 2px;
}

.lightbox-stage {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  align-items: stretch;
  min-height: 0;
}

.lightbox-figure {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  margin: 0;
}

.lightbox-image {
  max-width: 100%;
  max-height: 100%;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 12px;
  background: #101010;
  box-shadow: 0 40px 90px -30px #000;
}

.lightbox-nav {
  position: absolute;
  top: 50%;
  width: 38px;
  height: 38px;
  margin-top: -19px;
  border-radius: 50%;
  background: rgb(14 14 14 / 85%);
}

.lightbox-prev {
  left: 6px;
}

.lightbox-next {
  right: 6px;
}

.lightbox-caption {
  margin: 12px auto 0;
  max-width: 720px;
  color: #9a9a9a;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}

.lightbox-enter-active {
  transition: opacity 180ms ease-out;
}

.lightbox-leave-active {
  transition: opacity 140ms ease-in;
}

.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .segmented {
    width: 100%;
    min-width: 0;
    margin-bottom: 14px;
  }

  .segment {
    padding: 8px 6px;
    font-size: 12.5px;
  }

  .frame {
    border-radius: 12px;
  }

  .caption {
    margin-top: 14px;
    min-height: 0;
    font-size: 13.5px;
  }

  .zoom-hint {
    right: 10px;
    bottom: 10px;
  }

  .lightbox {
    padding: 10px 10px 12px;
  }

  .lightbox-nav {
    width: 32px;
    height: 32px;
    margin-top: -16px;
  }

  .lightbox-caption {
    font-size: 12.5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .segmented-thumb,
  .panel,
  .caption-enter-active,
  .caption-leave-active,
  .lightbox-enter-active,
  .lightbox-leave-active {
    transition-duration: 0.001ms;
  }
}
</style>
