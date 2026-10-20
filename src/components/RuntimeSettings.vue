<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES } from '../../lib/leyline-settings.js'
import { fetchRuntimeSettings, saveRuntimeSettings } from '../lib/pi-api'

const props = defineProps({ backendName: { type: String, required: true } })
const idleTimeoutMinutes = ref(DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES)
const baseline = ref(DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES)
const busy = ref(true)
const loaded = ref(false)
const error = ref('')
const saved = ref(false)
const dirty = computed(() => idleTimeoutMinutes.value !== baseline.value)

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  void load()
})
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))

function beforeUnload(event) {
  if (!dirty.value && !busy.value) return
  event.preventDefault()
  event.returnValue = ''
}

function confirmLeave() {
  if (busy.value) return false
  if (dirty.value && !window.confirm('Discard your unsaved runtime settings?')) return false
  idleTimeoutMinutes.value = baseline.value
  return true
}

defineExpose({ confirmLeave })

function apply(data) {
  baseline.value = data.idleTimeoutMinutes ?? DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES
  idleTimeoutMinutes.value = baseline.value
}

async function load() {
  busy.value = true
  error.value = ''
  try {
    apply(await fetchRuntimeSettings())
    loaded.value = true
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}

async function save() {
  if (busy.value || !loaded.value) return
  saved.value = false
  if (!Number.isInteger(idleTimeoutMinutes.value) || idleTimeoutMinutes.value < 0 || idleTimeoutMinutes.value > 1440) {
    error.value = 'Enter a whole number from 0 to 1440.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    apply(await saveRuntimeSettings({ idleTimeoutMinutes: idleTimeoutMinutes.value }))
    saved.value = true
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="settings-group" aria-labelledby="runtime-cleanup-heading" :aria-busy="busy">
    <h2 id="runtime-cleanup-heading">Idle cleanup</h2>
    <form class="backend-connection-form" @submit.prevent="save" @input="saved = false">
      <label>
        <span>Idle timeout (minutes)</span>
        <input
          v-model.number="idleTimeoutMinutes"
          type="number"
          min="0"
          max="1440"
          step="1"
          required
          aria-describedby="runtime-timeout-help runtime-cleanup-help runtime-protection-help"
          :disabled="busy || !loaded"
        />
      </label>
      <small id="runtime-timeout-help">Use 0 to disable cleanup. Default: {{ DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES }} minutes. Maximum: 1440 minutes.</small>
      <small id="runtime-cleanup-help">Close idle runtimes and their MCP processes on {{ props.backendName }} after this timeout. Reopen a session to restore its history and connections.</small>
      <small id="runtime-protection-help">Active work, queued tasks, pending approvals, and sessions open in connected windows stay loaded.</small>
      <p v-if="error" class="backend-connection-error" role="alert">{{ error }}</p>
      <div class="backend-connection-form-actions">
        <span v-if="saved" class="backend-connection-success" role="status">Saved</span>
        <button v-if="!loaded && error" type="button" :disabled="busy" @click="load">Retry</button>
        <button type="submit" :disabled="busy || !loaded || !dirty">{{ busy ? (loaded ? 'Saving…' : 'Loading…') : 'Save' }}</button>
      </div>
    </form>
  </section>
</template>
