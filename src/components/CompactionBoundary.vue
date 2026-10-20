<script setup>
import { computed, ref, watch } from 'vue'
import { compactNumber } from '../lib/format'

const props = defineProps({
  reason: { type: String, default: '' },
  startedAt: { type: Number, default: 0 },
  tokens: { type: Number, default: null },
})

const now = ref(Date.now())

watch(() => props.startedAt, (startedAt, previous, onCleanup) => {
  now.value = Date.now()
  if (!startedAt) return
  const timer = setInterval(() => { now.value = Date.now() }, 1000)
  onCleanup(() => clearInterval(timer))
}, { immediate: true })

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
  <div class="compaction-boundary">
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
</template>
