<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useModalFocus } from '../composables/useModalFocus'
import { formatMode } from '../lib/format'

const props = defineProps({
  availableModels: { type: Array, default: () => [] },
  availableThinkingLevels: { type: Array, default: () => [] },
  currentModelLabel: { type: String, default: '' },
  selectedModelKey: { type: String, default: '' },
  modelKey: { type: Function, required: true },
  thinkingLevel: { type: String, default: '' },
  disabled: Boolean,
  running: Boolean,
  interrupting: Boolean,
  settingsDisabled: Boolean,
  settingsError: { type: String, default: '' },
  imageDisabled: Boolean,
  ultrafastAvailable: Boolean,
  ultrafastEnabled: Boolean,
  researchEnabled: Boolean,
  researchDisabled: Boolean,
  research: Boolean,
  toolNames: { type: Array, default: () => [] },
})
const emit = defineEmits(['select-model', 'select-thinking', 'toggle-ultrafast', 'pick-images', 'newline', 'toggle-research', 'interrupt', 'open'])
const page = ref('')
const query = ref('')
const dialog = ref(null)
const opener = ref(null)
const fallbackId = useId()
const opened = computed(() => Boolean(page.value))
const title = computed(() => ({ options: 'Session options', thinking: 'Thinking', service: 'Service tier', add: 'Add to message', details: 'Session details' })[page.value])
const selectedModel = computed(() => props.availableModels.find(model => props.modelKey(model) === props.selectedModelKey))
const modelLabel = computed(() => selectedModel.value?.name || props.currentModelLabel || 'Choose model')
const models = computed(() => {
  const terms = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return props.availableModels.filter(model => terms.every(term => `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(term)))
})
useModalFocus({ dialog, active: opened, opener, initialFocus: dialog, fallbackSelector: () => `#${CSS.escape(fallbackId)}` })
watch(opened, value => emit('open', value), { flush: 'sync' })
onBeforeUnmount(() => emit('open', false))
watch(page, async () => {
  query.value = ''
  await nextTick()
  if (page.value) dialog.value?.focus({ preventScroll: true })
})
function open(name, event) {
  opener.value = event?.currentTarget || document.activeElement
  page.value = name
}
function dismiss() {
  if (!page.value) return false
  page.value = ''
  return true
}
function addImage(event) {
  emit('pick-images', event)
  dismiss()
}
function newline() {
  dismiss()
  emit('newline')
}
function chooseThinking(level) {
  emit('select-thinking', level)
  page.value = 'options'
}
function chooseTier(enabled) {
  if (props.settingsDisabled || (enabled && !props.ultrafastAvailable)) return
  if (enabled !== props.ultrafastEnabled) emit('toggle-ultrafast')
  page.value = 'options'
}
defineExpose({ open, dismiss, opened })
</script>

<template>
  <button :id="fallbackId" class="mobile-add-control" type="button" aria-label="Add to message" aria-haspopup="dialog" :disabled="disabled" :aria-expanded="page === 'add'" @mousedown.prevent @click="open('add', $event)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
  <button class="mobile-model-control" type="button" aria-haspopup="dialog" :aria-label="`${modelLabel}, ${formatMode(thinkingLevel)} thinking, ${ultrafastEnabled ? 'Ultrafast' : 'Standard'} service. Open settings`" :aria-expanded="['options', 'thinking', 'service'].includes(page)" :disabled="disabled || settingsDisabled" @click="open('options', $event)">
    <span class="mobile-model-content"><span class="mobile-model-title"><span>{{ modelLabel }}</span><svg class="mobile-model-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5h6L6 8.5z" /></svg></span><small v-if="ultrafastEnabled" class="mobile-ultrafast"><svg viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="2.5" /></svg>ultrafast</small></span>
  </button>
  <Teleport to="body">
    <Transition name="mobile-sheet">
      <div v-if="opened" class="mobile-sheet-backdrop" @click.self="dismiss" @keydown.esc.prevent.stop="dismiss">
        <section ref="dialog" class="mobile-composer-sheet" :class="{ 'is-options': page === 'options' }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
          <div class="mobile-sheet-handle" aria-hidden="true"></div>
          <header class="mobile-sheet-heading"><button v-if="page === 'thinking' || page === 'service'" type="button" aria-label="Back to session options" @click="page = 'options'">‹</button><h2>{{ title }}</h2><button type="button" class="mobile-sheet-done" @click="dismiss">Done</button></header>
          <p v-if="settingsError" class="mobile-sheet-error" role="alert">{{ settingsError }}</p>
          <div class="mobile-sheet-body">
            <template v-if="page === 'options'">
              <h3>Model</h3>
              <label class="mobile-model-search"><span aria-hidden="true">⌕</span><input v-model="query" type="search" placeholder="Find a model" aria-label="Find a model" @keydown.enter.prevent /></label>
              <div class="mobile-sheet-choices mobile-sheet-models">
                <button v-for="model in models" :key="modelKey(model)" type="button" :disabled="disabled || settingsDisabled" :aria-pressed="modelKey(model) === selectedModelKey" @click="emit('select-model', model)"><span>{{ model.name || model.id }}<small>{{ model.provider }} · {{ model.id }}</small></span><span v-if="modelKey(model) === selectedModelKey" aria-hidden="true">✓</span></button>
                <p v-if="!models.length">{{ availableModels.length ? 'No matching models.' : 'No models available.' }}</p>
              </div>
              <h3>Options</h3>
              <div class="mobile-sheet-choices"><button type="button" :disabled="disabled || settingsDisabled || !availableThinkingLevels.length" @click="page = 'thinking'"><span>Thinking</span><span class="mobile-option-value">{{ formatMode(thinkingLevel) }}</span><span aria-hidden="true">›</span></button><button type="button" :disabled="disabled || settingsDisabled" @click="page = 'service'"><span>Service tier</span><span class="mobile-option-value" :class="{ 'mobile-ultrafast': ultrafastEnabled }">{{ ultrafastEnabled ? 'Ultrafast' : 'Standard' }}</span><span aria-hidden="true">›</span></button></div>
            </template>
            <template v-else-if="page === 'thinking'">
              <p>Choose the thinking level for your next message.</p>
              <div class="mobile-sheet-choices"><button v-for="level in availableThinkingLevels" :key="level" type="button" :disabled="disabled || settingsDisabled" :aria-pressed="level === thinkingLevel" @click="chooseThinking(level)"><span>{{ formatMode(level) }}</span><span v-if="level === thinkingLevel" aria-hidden="true">✓</span></button></div>
            </template>
            <template v-else-if="page === 'service'">
              <div class="mobile-sheet-choices"><button type="button" :disabled="disabled || settingsDisabled" :aria-pressed="!ultrafastEnabled" @click="chooseTier(false)"><span>Standard<small>Default service tier</small></span><span v-if="!ultrafastEnabled" aria-hidden="true">✓</span></button><button type="button" :disabled="disabled || settingsDisabled || !ultrafastAvailable" :aria-pressed="ultrafastEnabled" @click="chooseTier(true)"><span>Ultrafast<small>Premium pricing</small></span><span v-if="ultrafastEnabled" aria-hidden="true">✓</span></button></div>
              <p class="mobile-sheet-note">{{ ultrafastAvailable ? 'Ultrafast stays visible beside the model while enabled.' : 'Ultrafast is not available for this model.' }}</p>
            </template>
            <div v-else-if="page === 'add'" class="mobile-sheet-choices"><button type="button" :disabled="disabled || imageDisabled" @click="addImage"><span>Add image</span></button><button type="button" :disabled="disabled" @click="newline"><span>New line</span></button><button v-if="running" type="button" :disabled="interrupting" @click="emit('interrupt'); dismiss()"><span>{{ interrupting ? 'Stopping' : 'Stop generation' }}</span></button><button v-if="researchEnabled" type="button" :disabled="disabled || imageDisabled || researchDisabled" :aria-pressed="research" @click="emit('toggle-research')"><span>Research</span><span v-if="research" aria-hidden="true">✓</span></button></div>
            <template v-else-if="page === 'details'"><h3>Enabled tools · {{ toolNames.length }}</h3><ul class="mobile-tool-inventory"><li v-for="tool in toolNames" :key="tool">{{ tool }}</li></ul><p v-if="!toolNames.length">No tools are enabled.</p></template>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mobile-add-control, .mobile-model-control { display: none; }
@media (max-width: 760px) {
  .mobile-add-control, .mobile-model-control { display: flex; align-items: center; justify-content: center; min-height: 44px; border: 0; border-radius: 10px; padding: 0; background: transparent; color: #d7d7d7; font: inherit; }
  .mobile-add-control { flex: none; width: 44px; }
  .mobile-add-control svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
  .mobile-model-control { flex: 1; min-width: 0; padding: 0 3px; }
  .mobile-model-content { display: flex; flex-direction: column; align-items: center; min-width: 0; max-width: 100%; gap: 2px; }
  .mobile-model-title { display: flex; align-items: center; gap: 8px; height: 32px; max-width: 100%; min-width: 0; border: 1px solid transparent; border-radius: 999px; padding: 6px 12px; background: #2b2b2c; color: var(--muted-strong); font-size: 13px; font-weight: 600; line-height: 1; transition: background-color var(--motion-base) var(--ease-decelerate), border-color var(--motion-base) var(--ease-decelerate), color var(--motion-base) var(--ease-decelerate); }
  .mobile-model-control:hover:not(:disabled) .mobile-model-title, .mobile-model-control[aria-expanded='true'] .mobile-model-title { border-color: var(--accent-border); background: #201a32; color: var(--text); }
  .mobile-model-title > span:first-child { overflow: hidden; min-width: 0; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-model-caret { flex: none; width: 12px; height: 12px; fill: currentColor; }
  .mobile-model-content small { display: flex; align-items: center; gap: 4px; height: 10px; font-size: 10px; line-height: 1; }
  .mobile-model-content small svg { width: 7px; height: 7px; fill: var(--accent); }
  .mobile-ultrafast { color: #bfb3ef !important; }
  .mobile-sheet-backdrop { position: fixed; z-index: 80; top: var(--app-top, 0px); left: 0; width: 100%; height: var(--app-height, 100dvh); display: flex; align-items: flex-end; background: #0008; }
  .mobile-composer-sheet { display: flex; flex-direction: column; width: 100%; max-height: calc(100% - 16px - env(safe-area-inset-top, 0px)); min-height: 0; border: 1px solid #3a3a3a; border-bottom: 0; border-radius: 24px 24px 0 0; outline: none; background: #181818; color: #e5e5e5; box-shadow: 0 -12px 50px #0005; padding-bottom: env(safe-area-inset-bottom, 0px); }
  .mobile-composer-sheet.is-options { height: 560px; }
  .mobile-sheet-handle { flex: none; width: 34px; height: 4px; margin: 10px auto 2px; border-radius: 3px; background: #515151; }
  .mobile-sheet-heading { display: flex; align-items: center; flex: none; gap: 4px; min-height: 54px; border-bottom: 1px solid #292929; padding: 0 10px 0 18px; }
  .mobile-sheet-heading h2 { flex: 1; min-width: 0; margin: 0; font-size: 16px; font-weight: 550; }
  .mobile-sheet-heading button { min-width: 44px; min-height: 44px; border: 0; border-radius: 8px; background: transparent; color: #ccc2f8; font: inherit; }
  .mobile-sheet-error { flex: none; max-height: calc(var(--app-height, 100dvh) * .25); overflow: auto; margin: 12px 16px 0; color: #f0a6a6; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
  .mobile-sheet-body { flex: 1; min-height: 0; overflow: auto; padding: 16px; overscroll-behavior: contain; scrollbar-width: thin; }
  .mobile-sheet-body h3 { margin: 18px 0 8px; color: #999; font-size: 12px; font-weight: 400; }
  .mobile-sheet-body h3:first-child { margin-top: 0; }
  .mobile-model-search { display: flex; align-items: center; gap: 8px; min-height: 44px; margin-bottom: 10px; border: 1px solid #383838; border-radius: 10px; padding: 0 10px; background: #202020; color: #999; }
  .mobile-model-search input { min-width: 0; width: 100%; height: 42px; border: 0; outline: none; padding: 0; background: transparent; color: #ddd; font: inherit; font-size: 16px; }
  .mobile-model-search:focus-within { border-color: #6b6b6b; }
  .mobile-sheet-choices { overflow: hidden; border: 1px solid #303030; border-radius: 12px; background: #232323; }
  .mobile-sheet-models { max-height: 230px; overflow-y: auto; overscroll-behavior: contain; }
  .mobile-sheet-choices button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; border: 0; border-bottom: 1px solid #ffffff06; padding: 10px 12px; background: transparent; color: #ddd; font: inherit; font-size: 14px; text-align: left; }
  .mobile-sheet-choices button:last-child { border-bottom: 0; }
  .mobile-sheet-choices button > span:first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .mobile-sheet-choices small { display: block; margin-top: 3px; color: #969696; font-size: 11px; line-height: 1.4; }
  .mobile-option-value { margin-left: auto; color: #9d9d9d; }
  .mobile-sheet-body p { color: #9c9c9c; font-size: 12px; line-height: 1.6; }
  .mobile-sheet-choices p { padding: 0 12px; }
  .mobile-sheet-note { margin: 12px 2px 0; }
  .mobile-tool-inventory { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; list-style: none; padding: 0; margin: 0; }
  .mobile-tool-inventory li { overflow-wrap: anywhere; border-bottom: 1px solid #303030; padding: 12px 2px; color: #bdbdbd; font: 11px/1.4 ui-monospace, monospace; }
  button:disabled { opacity: .4; cursor: default; }
  button:focus-visible { outline: 2px solid #aaa; outline-offset: -2px; }
  .mobile-sheet-enter-active, .mobile-sheet-leave-active { transition: background-color 300ms var(--ease-standard); }
  .mobile-sheet-enter-active .mobile-composer-sheet, .mobile-sheet-leave-active .mobile-composer-sheet { transition: transform 360ms var(--ease-emphasized), opacity 260ms var(--ease-standard); }
  .mobile-sheet-enter-from, .mobile-sheet-leave-to { background-color: transparent; }
  .mobile-sheet-enter-from .mobile-composer-sheet, .mobile-sheet-leave-to .mobile-composer-sheet { transform: translateY(34px); opacity: 0; }
  .mobile-sheet-leave-active { pointer-events: none; }
}
@media (prefers-reduced-motion: reduce) {
  .mobile-model-title, .mobile-sheet-enter-active, .mobile-sheet-leave-active, .mobile-sheet-enter-active .mobile-composer-sheet, .mobile-sheet-leave-active .mobile-composer-sheet { transition: none; }
}
</style>
