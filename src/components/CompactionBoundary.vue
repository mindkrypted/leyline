<script setup>
import { computed, ref, watch } from 'vue'
import { compactNumber } from '../lib/format'

const props = defineProps({
  reason: { type: String, default: '' },
  startedAt: { type: Number, default: 0 },
  tokens: { type: Number, default: null },
  viewport: { type: Object, default: null },
  dock: { type: Object, default: null },
})

const anchor = ref(null)
const docked = ref(true)
const now = ref(Date.now())

watch(() => props.startedAt, (startedAt, previous, onCleanup) => {
  now.value = Date.now()
  if (!startedAt) return
  const timer = setInterval(() => { now.value = Date.now() }, 1000)
  onCleanup(() => clearInterval(timer))
}, { immediate: true })

watch([anchor, () => props.viewport, () => props.dock], ([element, viewport, dock], previous, onCleanup) => {
  if (!element || !viewport || !dock) return
  let intersectionObserver
  let frame
  const observe = () => {
    intersectionObserver?.disconnect()
    const inset = Math.max(0, viewport.getBoundingClientRect().bottom - dock.getBoundingClientRect().bottom)
    intersectionObserver = new IntersectionObserver(([entry]) => {
      docked.value = !entry.isIntersecting || entry.intersectionRatio < 1
    }, { root: viewport, rootMargin: `-8px 0px -${inset}px 0px`, threshold: 1 })
    intersectionObserver.observe(element)
  }
  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(observe)
  })
  resizeObserver.observe(viewport)
  resizeObserver.observe(dock)
  if (dock.parentElement) resizeObserver.observe(dock.parentElement)
  observe()
  onCleanup(() => {
    cancelAnimationFrame(frame)
    intersectionObserver?.disconnect()
    resizeObserver.disconnect()
  })
}, { flush: 'post' })

const label = computed(() => {
  const tokens = props.tokens
  if (!Number.isFinite(tokens) || tokens <= 0) return 'Compacting context…'
  return `Compacting ${compactNumber(tokens)} tokens…`
})

const elapsedLabel = computed(() => {
  if (!props.startedAt) return ''
  const seconds = Math.max(0, Math.floor((now.value - props.startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
})

const note = computed(() => {
  const reason = props.reason === 'threshold' ? 'auto · threshold'
    : props.reason === 'manual' ? 'manual'
      : props.reason === 'overflow' ? 'overflow recovery'
        : ''
  return [reason, elapsedLabel.value].filter(Boolean).join(' · ')
})
</script>

<template>
  <div ref="anchor" class="compaction-boundary-anchor">
    <Teleport :to="dock || 'body'" :disabled="!docked || !dock">
      <div class="compaction-boundary" :class="{ 'is-docked': docked && dock }">
        <div class="compaction-boundary-row">
          <span class="compaction-boundary-rule" aria-hidden="true"></span>
          <span class="compaction-boundary-marker" role="status">
            <span class="live-tool-spinner" aria-hidden="true"></span>
            {{ label }}
          </span>
          <span class="compaction-boundary-rule" aria-hidden="true"></span>
        </div>
        <p v-if="note" class="compaction-boundary-note">{{ note }}</p>
      </div>
    </Teleport>
  </div>
</template>
