<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { TraceInspector, TraceWorkspace, TraceExplorer } from '@elune/embedded/vue'
import '@elune/embedded/vue/style.css'

const props = defineProps({
  mode: { type: String, required: true },
  client: { type: Object, required: true },
  sessionId: { type: String, default: '' },
  selection: { type: Object, default: () => ({}) },
  listState: { type: Object, default: () => ({}) },
  backendName: { type: String, default: '' },
  returnTo: { type: String, default: '' },
  projects: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:selection', 'update:listState', 'open-workspace', 'open-session', 'close'])
const surface = computed(() => ({ inspector: TraceInspector, workspace: TraceWorkspace, explorer: TraceExplorer })[props.mode])
const pane = ref(null)
const config = shallowRef(null)
const configReading = ref(false)
const configWriting = ref(false)
const configBusy = computed(() => configReading.value || configWriting.value)
const configError = ref('')
const visible = ref(document.visibilityState !== 'hidden')
let controller
let mutation
let requestVersion = 0
let refreshTimer
let readPending = false
let detach
let mounted = false

function cancelRead() {
  requestVersion++
  clearTimeout(refreshTimer)
  controller?.abort()
  controller = null
  configReading.value = false
}

async function readConfig() {
  if (!mounted || !visible.value) return
  if (mutation) {
    readPending = true
    return
  }
  cancelRead()
  readPending = false
  const version = requestVersion
  const client = props.client
  const pending = new AbortController()
  controller = pending
  configReading.value = true
  configError.value = ''
  try {
    const result = await client.getConfig({ signal: pending.signal })
    if (!mounted || version !== requestVersion || pending.signal.aborted || client !== props.client) return
    config.value = result
  } catch (error) {
    if (mounted && version === requestVersion && !pending.signal.aborted && client === props.client) {
      configError.value = error.message || 'Could not read tracing capture status.'
    }
  } finally {
    if (version === requestVersion) configReading.value = false
  }
}

function scheduleRead() {
  cancelRead()
  readPending = true
  if (!mutation) refreshTimer = setTimeout(readConfig, 200)
}

async function updateConfig(enabled) {
  if (enabled === undefined) return readConfig()
  if (!mounted || !visible.value || mutation) return
  cancelRead()
  readPending = false
  const client = props.client
  const pending = new AbortController()
  mutation = pending
  configWriting.value = true
  configError.value = ''
  try {
    const result = await client.setConfig(enabled, { signal: pending.signal })
    if (!mounted || mutation !== pending || pending.signal.aborted || client !== props.client) return
    cancelRead()
    config.value = result
  } catch (error) {
    if (mounted && mutation === pending && !pending.signal.aborted && client === props.client) {
      configError.value = `${error.message || 'Could not confirm capture change.'} The change may have been saved. Retry to read the current status.`
    }
  } finally {
    if (mutation === pending) {
      mutation = null
      configWriting.value = false
      if (readPending && mounted && visible.value && client === props.client) scheduleRead()
    }
  }
}

function cancelMutation() {
  mutation?.abort()
  mutation = null
  configWriting.value = false
  readPending = false
}

function connectConfig() {
  detach?.()
  detach = null
  cancelRead()
  if (!mounted || !visible.value) return
  const client = props.client
  detach = client.subscribeConfig(() => {
    if (mounted && visible.value && client === props.client) scheduleRead()
  })
  void readConfig()
}

function visibilityChanged() {
  visible.value = document.visibilityState !== 'hidden'
  connectConfig()
}

function focus() {
  pane.value?.focus({ preventScroll: true })
}

watch(() => props.mode, () => nextTick(focus))
watch(() => props.client, () => {
  cancelMutation()
  config.value = null
  configError.value = ''
  connectConfig()
}, { flush: 'sync' })

onMounted(() => {
  mounted = true
  document.addEventListener('visibilitychange', visibilityChanged)
  connectConfig()
  focus()
})
onUnmounted(() => {
  mounted = false
  detach?.()
  cancelRead()
  cancelMutation()
  document.removeEventListener('visibilitychange', visibilityChanged)
})
defineExpose({ focus })
</script>

<template>
  <aside ref="pane" class="trace-panel" :class="`trace-panel-${mode}`" tabindex="-1" :aria-label="mode === 'explorer' ? 'Backend trace explorer' : mode === 'workspace' ? 'Tracing workspace' : 'Session trace inspector'">
    <div class="trace-host-context">
      <span>{{ backendName }}<template v-if="mode === 'explorer'"> · Across projects</template></span>
      <label v-if="mode === 'explorer'" class="trace-project-filter">
        <select :value="listState.cwd || ''" aria-label="Trace project" @change="emit('update:listState', { ...listState, cwd: $event.target.value, page: 1 })">
          <option value="">All projects</option>
          <option v-if="listState.cwd && !projects.some(project => project.cwd === listState.cwd)" :value="listState.cwd">{{ listState.cwd }}</option>
          <option v-for="project in projects" :key="project.cwd" :value="project.cwd">{{ project.name || project.cwd }}</option>
        </select>
      </label>
      <span v-if="mode === 'workspace'">Back to {{ returnTo === 'explorer' ? 'explorer' : 'inspector' }}</span>
    </div>
    <component :is="surface" :key="mode" :client="client" :session-id="sessionId" :selection="selection" :list-state="listState" :active="true" @update:selection="emit('update:selection', $event)" @update:list-state="emit('update:listState', $event)" @open-workspace="emit('open-workspace', $event)" @open-session="emit('open-session', $event)" @close="emit('close')" />
    <footer class="trace-host-footer">
      <p v-if="config?.error" class="trace-host-error" role="alert">Trace capture failed: {{ config.error }}</p>
      <p v-if="configError" class="trace-host-error" role="alert">{{ configError }} <button type="button" :disabled="configBusy" @click="updateConfig()">Retry</button></p>
      <details>
        <summary>Capture new runs · {{ configBusy ? 'Updating…' : config ? config.enabled ? 'On' : 'Off' : 'Unavailable' }}</summary>
        <label class="trace-capture-toggle"><input type="checkbox" :checked="config?.enabled === true" :disabled="!config || configBusy" @change="updateConfig($event.target.checked)" />Capture new runs</label>
        <p>Prompts and tool results are stored locally on {{ backendName }}. Turning capture off does not delete traces or interrupt a run already being captured.</p>
      </details>
      <p v-if="configWriting">Capture change is pending on {{ backendName }}. If you close this view, reopen traces on this backend to check the result.</p>
      <p>{{ config?.error ? 'Capture is unavailable for new runs.' : config?.enabled === false ? 'Capture is off for new runs.' : config?.enabled === true ? 'New runs will be captured.' : 'Capture status is unavailable.' }} Historical records are not reconstructed.</p>
    </footer>
  </aside>
</template>

<style>
.trace-panel {
  position: fixed;
  z-index: 31;
  inset: 53px 0 0 var(--sidebar-width);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
  outline: none;
  border-left: 1px solid var(--border);
}
.sidebar-hidden .trace-panel { left: 0; }
.trace-panel.trace-panel-inspector {
  left: auto;
  width: min(510px, calc(100vw - var(--sidebar-width)));
  box-shadow: -18px 0 50px rgb(0 0 0 / 25%);
}
.sidebar-hidden .trace-panel.trace-panel-inspector { left: auto; width: min(510px, 100vw); }
.trace-panel > .elune-ui { flex: 1; height: auto; --elune-muted: #929292; }
.trace-host-context {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  color: var(--muted-strong);
  font-size: 10px;
}
.trace-host-context > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trace-project-filter select {
  max-width: 180px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel);
  font: inherit;
  color: var(--text);
}
.trace-host-footer { flex: none; max-height: 35%; overflow: auto; padding: 10px 16px; border-top: 1px solid var(--border); color: #929292; font-size: 10px; line-height: 1.6; }
.trace-host-footer p { margin: 5px 0 0; }
.trace-host-footer summary { cursor: pointer; color: var(--muted-strong); }
.trace-capture-toggle { display: flex; align-items: center; gap: 7px; padding-top: 9px; color: var(--text); }
.trace-host-error { margin: 0; padding: 8px 16px; color: #c99990; font-size: 11px; overflow-wrap: anywhere; }
.trace-host-footer .trace-host-error { padding: 0 0 8px; }
.trace-host-error button { border: 1px solid var(--border); background: var(--panel); border-radius: 4px; font: inherit; }
.trace-workbench-covered .main-pane { visibility: hidden; pointer-events: none; }
.trace-navigation-notice { position: absolute; z-index: 2; top: 8px; left: 16px; right: 16px; margin: 0; padding: 10px 12px; background: var(--panel); border: 1px solid var(--border); }
.trace-navigation-notice button { margin-left: 8px; border: 1px solid var(--border); background: var(--panel-soft); color: var(--text); font: inherit; }
.sidebar-traces-button[aria-pressed=true] { color: #b5a0ce; background: var(--panel-soft); }
@media (max-width: 760px) {
  .trace-panel, .sidebar-hidden .trace-panel, .trace-panel.trace-panel-inspector, .sidebar-hidden .trace-panel.trace-panel-inspector { inset: 50px 0 0; width: 100%; border-left: 0; box-shadow: none; }
}
</style>
