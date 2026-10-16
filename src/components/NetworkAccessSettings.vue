<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { fetchNetworkAccess, saveNetworkAccess } from '../lib/leyline-api'

const props = defineProps({ copiedId: { type: String, default: '' } })
const emit = defineEmits(['copy'])
const config = ref(null)
const busy = ref(false)
const error = ref('')
const portDraft = ref('')
const requestedPort = computed(() => Number(portDraft.value || 0))
const portChanged = computed(() => requestedPort.value !== (config.value?.configuredPort || 0))

async function load() {
  if (busy.value) return
  const keepDraft = portChanged.value
  busy.value = true
  error.value = ''
  try {
    config.value = await fetchNetworkAccess()
    if (!keepDraft) portDraft.value = config.value.configuredPort || ''
    error.value = config.value.error || ''
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}

async function save(values) {
  if (busy.value || !config.value?.available) return
  const keepDraft = values.port === undefined && portChanged.value
  busy.value = true
  error.value = ''
  try {
    config.value = await saveNetworkAccess(values)
    if (!keepDraft) portDraft.value = config.value.configuredPort || ''
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
  window.addEventListener('focus', load)
})
onUnmounted(() => window.removeEventListener('focus', load))
</script>

<template>
  <section class="settings-group network-settings" aria-label="Network access" :aria-busy="busy">
    <h2>Network access</h2>
    <div class="settings-rows">
      <div class="settings-row">
        <span>
          <strong id="network-access-label">Allow network access</strong>
          <small>Share this app’s native backend.</small>
        </span>
        <button
          type="button"
          class="pi-settings-switch"
          role="switch"
          aria-labelledby="network-access-label"
          aria-describedby="network-access-warning"
          :aria-checked="config?.enabled === true"
          :disabled="busy || !config?.available"
          @click="save({ enabled: !config.enabled })"
        />
      </div>
      <form class="settings-row" @submit.prevent="save({ port: requestedPort })">
        <span>
          <label for="network-access-port"><strong>Proxy port</strong></label>
          <small id="network-access-port-help">Leave blank to choose automatically.</small>
        </span>
        <div class="network-settings-port">
          <input
            id="network-access-port"
            v-model="portDraft"
            type="number"
            min="1"
            max="65535"
            step="1"
            inputmode="numeric"
            placeholder="Automatic"
            aria-describedby="network-access-port-help"
            :disabled="busy || !config?.available"
          />
          <button
            class="pi-settings-button"
            type="submit"
            :disabled="busy || !config?.available || !portChanged"
          >Apply</button>
        </div>
      </form>
    </div>
    <p id="network-access-warning" class="settings-note">
      No authentication. Connected devices can read files and run commands. Use trusted networks only.
    </p>
    <template v-if="config">
      <p v-if="config.directAccess" class="settings-note">
        Startup settings also allow direct access. This switch does not control it.
      </p>
      <p class="settings-note" role="status">
        {{ config.enabled ? `Listening on port ${config.port}.` : 'Network access is off.' }}
      </p>
      <div v-if="config.urls.length" class="network-settings-addresses">
        <div v-for="url in config.urls" :key="url" class="network-settings-address">
          <code>{{ url }}</code>
          <button
            type="button"
            class="pi-settings-button"
            :aria-label="`Copy ${url}`"
            @click="emit('copy', `network-access-${url}`, url)"
          >{{ props.copiedId === `network-access-${url}` ? 'Copied' : 'Copy' }}</button>
        </div>
      </div>
      <p v-else-if="config.enabled" class="settings-note">No network address found.</p>
      <p v-if="config.enabled" class="settings-note">Changing the port or turning access off disconnects remote clients. Local agents keep running.</p>
    </template>
    <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
    <button v-if="error && !config" class="settings-text-link" type="button" :disabled="busy" @click="load">Retry</button>
  </section>
</template>
