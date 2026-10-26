<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchSessionTitleSettings, saveSessionTitleSettings } from '../lib/pi-api'
import { formatMode } from '../lib/format'
import SettingsSelect from './SettingsSelect.vue'

const props = defineProps({ availableModels: { type: Array, default: () => [] } })
const config = ref(null)
const busy = ref(false)
const error = ref('')
const failedSave = ref(null)
const enabled = computed(() => config.value?.enabled === true)
const selectedModel = computed(() => config.value?.model || '')
const selectedThinking = computed(() => config.value?.thinking || '')
const modelOptions = computed(() => props.availableModels.map((model) => ({
  value: `${model.provider}/${model.id}`,
  label: model.name || `${model.provider}/${model.id}`,
  description: `${model.provider}/${model.id}`,
  levels: model.availableThinkingLevels || [],
})))
const selectedModelOption = computed(() => modelOptions.value.find((model) => model.value === selectedModel.value))
const modelAvailable = computed(() => Boolean(selectedModelOption.value))
const thinkingLevels = computed(() => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  .filter((level) => selectedModelOption.value?.levels.includes(level)))
const thinkingAvailable = computed(() => !selectedThinking.value || thinkingLevels.value.includes(selectedThinking.value))
const toggleDisabled = computed(() => busy.value || !config.value
  || (!enabled.value && (!modelAvailable.value || !thinkingAvailable.value)))
const lowestThinkingLabel = computed(() => thinkingLevels.value.length
  ? `Lowest available (${formatMode(thinkingLevels.value[0])})`
  : 'Lowest available')
const titleModelOptions = computed(() => [
  { value: '', label: 'Choose a model', disabled: enabled.value },
  ...(selectedModel.value && !modelAvailable.value ? [{
    value: selectedModel.value,
    label: selectedModel.value,
    description: 'Saved, unavailable',
    disabled: true,
  }] : []),
  ...modelOptions.value,
])
const thinkingOptions = computed(() => [
  { value: '', label: lowestThinkingLabel.value },
  ...(!thinkingAvailable.value ? [{
    value: selectedThinking.value,
    label: formatMode(selectedThinking.value),
    description: 'Saved, unavailable for this model',
    disabled: true,
  }] : []),
  ...thinkingLevels.value.map((level) => ({ value: level, label: formatMode(level) })),
])
let active = true

onMounted(load)
onBeforeUnmount(() => { active = false })

async function load() {
  if (busy.value || !active) return
  busy.value = true
  error.value = ''
  failedSave.value = null
  try {
    const data = await fetchSessionTitleSettings()
    if (active) config.value = data
  } catch (failure) {
    if (active) error.value = failure.message
  } finally {
    if (active) busy.value = false
  }
}

function updateModel(model) {
  const next = modelOptions.value.find((option) => option.value === model)
  const thinking = next?.levels.includes(selectedThinking.value) ? selectedThinking.value : ''
  save({ enabled: enabled.value, model, thinking })
}

async function save(settings) {
  if (busy.value || !config.value || !active) return
  if (settings.enabled && !modelOptions.value.some((model) => model.value === settings.model)) {
    error.value = 'Choose an available title model first.'
    failedSave.value = null
    return
  }
  if (settings.enabled && settings.thinking
    && !modelOptions.value.find((model) => model.value === settings.model)?.levels.includes(settings.thinking)) {
    error.value = 'Choose an available thinking mode first.'
    failedSave.value = null
    return
  }
  busy.value = true
  error.value = ''
  failedSave.value = null
  try {
    const data = await saveSessionTitleSettings(settings)
    if (active) config.value = data
  } catch (failure) {
    if (active) {
      error.value = failure.message
      failedSave.value = settings
    }
  } finally {
    if (active) busy.value = false
  }
}
</script>

<template>
  <section aria-labelledby="session-titles-heading" :aria-busy="busy">
    <h3 id="session-titles-heading" class="settings-section-heading">Session titles</h3>
    <p id="session-titles-help" class="settings-note">One background request uses the first message in each new conversation. Manual titles are preserved.</p>
    <small v-if="busy" class="settings-note" role="status">{{ config ? 'Saving title settings…' : 'Loading title settings…' }}</small>
    <div class="settings-rows">
      <div class="settings-row">
        <span>
          <strong id="automatic-titles-label">Automatic titles</strong>
        </span>
        <button
          type="button"
          class="pi-settings-switch"
          role="switch"
          aria-labelledby="automatic-titles-label"
          aria-describedby="session-titles-help"
          :aria-checked="enabled"
          :aria-disabled="toggleDisabled || undefined"
          :tabindex="toggleDisabled ? -1 : 0"
          @click="!toggleDisabled && save({ enabled: !enabled, model: selectedModel, thinking: selectedThinking })"
        />
      </div>
      <div class="settings-row">
        <span>
          <strong>Title model</strong>
          <small>Choose a model before enabling automatic titles.</small>
        </span>
        <SettingsSelect
          :model-value="selectedModel"
          :options="titleModelOptions"
          label="Title model"
          searchable
          search-placeholder="Filter models"
          :disabled="busy || !config"
          @update:model-value="updateModel"
        />
      </div>
      <div class="settings-row">
        <span>
          <strong>Thinking mode</strong>
          <small>Uses the title model’s lowest supported mode by default.</small>
        </span>
        <SettingsSelect
          :model-value="selectedThinking"
          :options="thinkingOptions"
          label="Thinking mode"
          :disabled="busy || !config || !modelAvailable"
          @update:model-value="save({ enabled, model: selectedModel, thinking: $event })"
        />
      </div>
    </div>
    <p v-if="config && !modelOptions.length" class="settings-note">No models are available.</p>
    <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
    <button v-if="error" class="settings-text-link" type="button" :disabled="busy" @click="failedSave ? save(failedSave) : load()">Retry</button>
  </section>
</template>
