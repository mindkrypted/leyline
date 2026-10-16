<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { fetchNetworkAccess, saveNetworkAccess } from '../lib/leyline-api'

const props = defineProps({ copiedId: { type: String, default: '' } })
const emit = defineEmits(['copy'])
const config = ref(null)
const busy = ref(false)
const error = ref('')

async function load() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    config.value = await fetchNetworkAccess()
    error.value = config.value.error || ''
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}

async function toggle() {
  if (busy.value || !config.value?.available) return
  busy.value = true
  error.value = ''
  try {
    config.value = await saveNetworkAccess(!config.value.enabled)
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
          <small>Let other devices connect to this app’s native backend.</small>
        </span>
        <button
          type="button"
          class="pi-settings-switch"
          role="switch"
          aria-labelledby="network-access-label"
          aria-describedby="network-access-warning"
          :aria-checked="config?.enabled === true"
          :disabled="busy || !config?.available"
          @click="toggle"
        />
      </div>
    </div>
    <p id="network-access-warning" class="settings-note">
      No authentication. Anyone who can reach this backend can access files, change settings, and run commands. Use trusted networks only.
    </p>
    <template v-if="config">
      <p class="settings-note">Applies immediately. The local app and running agents stay connected.</p>
      <p class="settings-note">
        Uses all IPv4 interfaces, including Wi-Fi and Tailscale. The sharing URL can change each time you enable access.
      </p>
      <p v-if="config.directAccess" class="settings-note">
        Startup configuration also exposes the origin. This toggle controls only the additional network listener.
      </p>
      <p class="settings-note" role="status">
        {{ config.enabled ? `Network access is enabled on port ${config.port}.` : 'The network listener is off.' }}
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
      <p v-else-if="config.enabled" class="settings-note">No network address is available. Check your network connection.</p>
      <p v-if="config.enabled" class="settings-note">Turning this off disconnects remote clients and their terminals.</p>
    </template>
    <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
    <button v-if="error && !config" class="settings-text-link" type="button" :disabled="busy" @click="load">Retry</button>
  </section>
</template>
