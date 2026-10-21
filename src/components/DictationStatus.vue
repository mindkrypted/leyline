<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { createDictationWaveform, DICTATION_WAVE_BARS } from '../lib/dictation-waveform.js'
import '../styles/dictation.css'

const props = defineProps({ dictation: { type: Object, required: true } })
const pending = reactive(new Set())
const recoveryInput = ref(null)
const copyFeedback = ref('')
const copying = ref(false)
const recoveryText = computed(() => props.dictation.recoveryText || '')
const phase = computed(() => props.dictation.phase || 'idle')
const error = computed(() => props.dictation.error)
const active = computed(() => props.dictation.active || ['preparing', 'listening', 'finishing', 'testing'].includes(phase.value))
const visible = computed(() => active.value || phase.value === 'error' || Boolean(error.value) || Boolean(recoveryText.value))
const label = computed(() => {
  if (phase.value === 'preparing') return 'Preparing dictation…'
  if (phase.value === 'listening') return 'Listening'
  if (phase.value === 'finishing') return 'Finishing…'
  if (phase.value === 'testing') return 'Testing microphone'
  return phase.value === 'error' ? 'Dictation needs attention' : 'Dictation'
})
const compactLabel = computed(() => {
  if (phase.value === 'preparing') return 'Preparing…'
  if (phase.value === 'testing') return 'Mic test'
  if (phase.value === 'error') return 'Needs attention'
  return label.value
})
const timer = computed(() => {
  const seconds = Math.max(0, Math.floor(Number(props.dictation.elapsed) || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
const measuring = computed(() => phase.value === 'testing' || (phase.value === 'listening' && props.dictation.engine === 'local'))
const waveBars = []
const waveform = createDictationWaveform()
let waveFrame = 0
let waveMounted = false
let motionQuery

function canMeasure() {
  return waveMounted && measuring.value && !document.hidden
}

function paintWaveform(now) {
  const heights = waveform.read(now)
  for (let index = 0; index < waveBars.length; index++) {
    if (waveBars[index]) waveBars[index].style.transform = `scaleY(${heights[index] / 18})`
  }
}

function animateWaveform(now) {
  waveFrame = 0
  if (!canMeasure() || motionQuery?.matches) return
  paintWaveform(now)
  waveFrame = requestAnimationFrame(animateWaveform)
}

function receiveMeter() {
  if (!canMeasure()) return
  const now = performance.now()
  const value = props.dictation.level
  const rms = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) / 4 : 0
  waveform.push(props.dictation.meter ?? { rms, peak: rms }, now)
  if (motionQuery?.matches) paintWaveform(now)
  else if (!waveFrame) waveFrame = requestAnimationFrame(animateWaveform)
}

function resetWaveform() {
  cancelAnimationFrame(waveFrame)
  waveFrame = 0
  waveform.reset()
  paintWaveform(performance.now())
  receiveMeter()
}

watch(measuring, resetWaveform, { flush: 'post' })
watch(() => props.dictation.meter ?? props.dictation.level, receiveMeter, { deep: true, flush: 'post' })
onMounted(() => {
  waveMounted = true
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionQuery.addEventListener('change', resetWaveform)
  document.addEventListener('visibilitychange', resetWaveform)
  resetWaveform()
})

let copyGeneration = 0

watch(recoveryText, () => {
  copyGeneration++
  copyFeedback.value = ''
  copying.value = false
}, { flush: 'sync' })
onBeforeUnmount(() => {
  copyGeneration++
  waveMounted = false
  cancelAnimationFrame(waveFrame)
  waveform.reset()
  motionQuery?.removeEventListener('change', resetWaveform)
  document.removeEventListener('visibilitychange', resetWaveform)
})

async function copyTranscript() {
  if (copying.value || !recoveryText.value) return
  const generation = ++copyGeneration
  copying.value = true
  copyFeedback.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(recoveryText.value)
    if (generation === copyGeneration) copyFeedback.value = 'Transcript copied.'
  } catch {
    if (generation !== copyGeneration) return
    copyFeedback.value = 'Clipboard unavailable. Select the transcript and copy it manually.'
    recoveryInput.value?.focus({ preventScroll: true })
    recoveryInput.value?.select()
  } finally {
    if (generation === copyGeneration) copying.value = false
  }
}

async function act(action, event) {
  if (pending.has(action) || (pending.size && action !== 'cancel')) return
  pending.add(action)
  try {
    await props.dictation[action](action === 'finish' ? { focusFrom: event.currentTarget } : undefined)
  } catch {} finally {
    pending.delete(action)
  }
}
</script>

<template>
  <div v-if="visible" class="dictation-status" :class="{ 'dictation-status-listening': phase === 'listening', 'dictation-status-busy': phase === 'preparing' || phase === 'finishing' }" aria-label="Dictation">
    <span class="dictation-sr-only" role="status" aria-live="polite" aria-atomic="true">{{ label }}</span>
    <div class="dictation-status-strip">
      <div class="dictation-status-line">
        <span class="dictation-status-dot" aria-hidden="true" />
        <span class="dictation-phase-label" :title="label">{{ compactLabel }}</span>
        <span class="dictation-timer" aria-label="Elapsed time">{{ timer }}</span>
      </div>
      <div class="dictation-status-signal">
        <svg class="dictation-wave" :class="{ 'dictation-wave-measured': measuring }" viewBox="0 0 210 18" preserveAspectRatio="none" aria-hidden="true">
          <rect v-for="index in DICTATION_WAVE_BARS" :key="index" :ref="element => { waveBars[index - 1] = element }" :x="(index - 1) * 7 + 2" y="0" width="3" height="18" rx="1.5" style="transform: scaleY(0.111111)" />
        </svg>
      </div>
      <div class="dictation-strip-actions">
        <button v-if="active" class="dictation-finish-target" type="button" :disabled="pending.size > 0 || !['listening', 'testing'].includes(phase)" :aria-label="phase === 'testing' ? 'Stop microphone test' : 'Finish dictation'" @click="act(phase === 'testing' ? 'stopTest' : 'finish', $event)">
          <span class="composer-chip dictation-finish-pill">{{ phase === 'testing' ? 'Stop test' : 'Finish' }}</span>
        </button>
        <button v-else-if="error || phase === 'error'" class="dictation-finish-target" type="button" :disabled="pending.size > 0" aria-label="Dismiss dictation error" @click="act('dismissError')">
          <span class="composer-chip dictation-finish-pill dictation-dismiss-pill">Dismiss</span>
        </button>
        <span class="dictation-cancel-slot">
          <button v-if="active && phase !== 'testing'" class="dictation-cancel" type="button" :disabled="pending.has('cancel')" title="Cancel dictation and discard this recording" aria-label="Cancel dictation and discard this recording" @click="act('cancel')">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" /></svg>
          </button>
        </span>
      </div>
    </div>
    <div v-if="error" class="dictation-status-failure">
      <p class="dictation-status-error" role="alert">{{ error }}</p>
    </div>
    <div v-if="recoveryText" class="dictation-recovery">
      <label class="dictation-status-label">
        Recovered transcript
        <textarea ref="recoveryInput" class="dictation-recovery-text" :value="recoveryText" rows="3" readonly spellcheck="false" />
      </label>
      <p class="dictation-status-note">This text was not inserted. Copy it to keep it.</p>
      <div class="dictation-recovery-actions">
        <span class="dictation-status-note" role="status" aria-live="polite">{{ copyFeedback }}</span>
        <div class="dictation-status-actions">
          <button class="dictation-button" type="button" :disabled="copying" @click="copyTranscript">Copy transcript</button>
          <button class="dictation-button dictation-button-quiet" type="button" aria-label="Dismiss recovered transcript" @click="dictation.dismissRecovery()">Dismiss</button>
        </div>
      </div>
    </div>
  </div>
</template>
