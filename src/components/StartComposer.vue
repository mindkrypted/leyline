<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DictationStatus from './DictationStatus.vue'
import ModelPicker from './ModelPicker.vue'
import MobileComposerControls from './MobileComposerControls.vue'
import { useMobileComposerInput } from '../composables/useMobileComposerInput'
import UltrafastToggle from './UltrafastToggle.vue'
import { formatMode } from '../lib/format'

const props = defineProps({
  dictation: { type: Object, required: true },
  dictationSubmitting: Boolean,
  mobile: Boolean,
  settingsError: { type: String, default: '' },
  startProjectTrigger: { default: null },
  attachedImages: {
    type: Array,
    default: () => [],
  },
  availableModels: {
    type: Array,
    default: () => [],
  },
  availableThinkingLevels: {
    type: Array,
    default: () => [],
  },
  chips: {
    type: Array,
    default: () => [],
  },
  creatingSessionCwd: {
    type: String,
    default: '',
  },
  currentModelLabel: {
    type: String,
    default: '',
  },
  currentThinkingLabel: {
    type: String,
    default: '',
  },
  draft: {
    type: String,
    default: '',
  },
  imageSupportWarning: {
    type: String,
    default: '',
  },
  visionDelegationNotice: {
    type: String,
    default: '',
  },
  modelKey: {
    type: Function,
    required: true,
  },
  modelPickerOpen: Boolean,
  researchEnabled: Boolean,
  sessionKind: {
    type: String,
    default: 'session',
  },
  newSessionCwd: {
    type: String,
    default: '',
  },
  selectedModelKey: {
    type: String,
    default: '',
  },
  slashActiveIndex: {
    type: Number,
    default: 0,
  },
  slashCommandItems: {
    type: Array,
    default: () => [],
  },
  slashCommandSourceLabel: {
    type: Function,
    required: true,
  },
  slashPickerOpen: Boolean,
  startProjectLabel: {
    type: String,
    default: '',
  },
  startProjectOptions: {
    type: Array,
    default: () => [],
  },
  startProjectPickerOpen: Boolean,
  startProjectQuery: {
    type: String,
    default: '',
  },
  switchingModel: Boolean,
  switchingThinking: Boolean,
  switchingUltrafast: Boolean,
  ultrafastAvailable: Boolean,
  ultrafastEnabled: Boolean,
  thinkingLevel: {
    type: String,
    default: '',
  },
  thinkingPickerOpen: Boolean,
  toolNames: {
    type: Array,
    default: () => [],
  },
  toolsChipLabel: {
    type: String,
    default: 'tools unknown',
  },
  toolsPickerOpen: Boolean,
})

const emit = defineEmits([
  'composition-start',
  'composition-end',
  'input-blur',
  'keydown',
  'open-image',
  'open-project-browser',
  'paste',
  'pick-images',
  'remove-image',
  'select-model',
  'select-project',
  'select-slash-command',
  'select-thinking',
  'show-slash-picker',
  'submit',
  'toggle-picker',
  'toggle-ultrafast',
  'toggle-session-kind',
  'toggle-project-picker',
  'update:draft',
  'update:startProjectQuery',
])

const form = ref(null)
const textarea = ref(null)
const mobileControls = ref(null)
const mobileSheetOpen = ref(false)
useMobileComposerInput({ textarea, mobile: () => props.mobile, draft: () => props.draft })
const startProjectMenu = ref(null)
const startProjectMenuStyle = ref({})
let projectMenuObserver
let projectMenuFrame = 0
const shellMode = computed(() => props.draft.trimStart().startsWith('!'))
const researchMode = computed(() => props.sessionKind === 'research')
const hiddenShellMode = computed(() => props.draft.trimStart().startsWith('!!'))
const shellCommand = computed(() => {
  const text = props.draft.trimStart()
  if (!text.startsWith('!')) return ''
  return text.slice(text.startsWith('!!') ? 2 : 1).trim()
})
const shellModeLabel = computed(() => {
  return hiddenShellMode.value ? 'shell · hidden' : 'shell · context'
})
const inputDisabled = computed(() => Boolean(props.creatingSessionCwd))

watch(() => props.startProjectPickerOpen, scheduleProjectMenu, { flush: 'post' })
watch(() => props.startProjectTrigger, (element, previous) => {
  if (previous) projectMenuObserver?.unobserve(previous)
  if (element) projectMenuObserver?.observe(element)
  scheduleProjectMenu()
}, { flush: 'post' })
watch(startProjectMenu, (element, previous) => {
  if (previous) projectMenuObserver?.unobserve(previous)
  if (element) projectMenuObserver?.observe(element)
  scheduleProjectMenu()
})

onMounted(() => {
  projectMenuObserver = new ResizeObserver(scheduleProjectMenu)
  if (form.value) projectMenuObserver.observe(form.value)
  if (props.startProjectTrigger) projectMenuObserver.observe(props.startProjectTrigger)
  if (startProjectMenu.value) projectMenuObserver.observe(startProjectMenu.value)
  window.addEventListener('resize', scheduleProjectMenu)
  window.addEventListener('scroll', scheduleProjectMenu, true)
  window.visualViewport?.addEventListener('resize', scheduleProjectMenu)
  window.visualViewport?.addEventListener('scroll', scheduleProjectMenu)
  scheduleProjectMenu()
})

onBeforeUnmount(() => {
  projectMenuObserver?.disconnect()
  cancelAnimationFrame(projectMenuFrame)
  window.removeEventListener('resize', scheduleProjectMenu)
  window.removeEventListener('scroll', scheduleProjectMenu, true)
  window.visualViewport?.removeEventListener('resize', scheduleProjectMenu)
  window.visualViewport?.removeEventListener('scroll', scheduleProjectMenu)
})

function scheduleProjectMenu() {
  if (!props.startProjectPickerOpen || projectMenuFrame) return
  projectMenuFrame = requestAnimationFrame(() => {
    projectMenuFrame = 0
    updateProjectMenu()
  })
}

function updateProjectMenu() {
  if (!props.startProjectPickerOpen || !form.value || !startProjectMenu.value) return
  const rect = (props.mobile && props.startProjectTrigger || form.value).getBoundingClientRect()
  const viewport = window.visualViewport
  const top = (viewport?.offsetTop || 0) + 8
  const left = (viewport?.offsetLeft || 0) + 8
  const bottom = top + (viewport?.height || window.innerHeight) - 16
  const right = left + (viewport?.width || window.innerWidth) - 16
  const above = Math.max(0, rect.top - top - 8)
  const below = Math.max(0, bottom - rect.bottom - 8)
  const preferred = Math.min(360, startProjectMenu.value.scrollHeight + 2)
  const minimum = Math.min(160, preferred)
  const placement = below >= minimum && (below >= preferred || below >= above)
    ? 'below' : above >= minimum ? 'above' : 'bounded'
  const height = Math.max(0, Math.min(preferred,
    placement === 'below' ? below : placement === 'above' ? above : bottom - top))
  const width = Math.max(0, Math.min(300, right - left))
  const menuTop = placement === 'above' ? rect.top - height - 8
    : placement === 'below' ? rect.bottom + 8
      : Math.max(top, Math.min(rect.top, bottom - height))
  const menuLeft = Math.max(left, Math.min(rect.left + (props.mobile ? 0 : 12), right - width))
  startProjectMenuStyle.value = props.mobile ? {
    position: 'fixed',
    zIndex: 70,
    top: `${menuTop}px`,
    left: `${menuLeft}px`,
    width: `${width}px`,
    maxHeight: `${height}px`,
    transformOrigin: placement === 'above' ? 'bottom left' : 'top left',
  } : {
    top: `${menuTop - rect.top - form.value.clientTop}px`,
    left: `${menuLeft - rect.left - form.value.clientLeft}px`,
    width: `${width}px`,
    maxHeight: `${height}px`,
    transformOrigin: placement === 'above' ? 'bottom left' : 'top left',
  }
}

function updateDraft(event) {
  emit('update:draft', event.target.value)
  emit('show-slash-picker')
}

async function insertNewline() {
  const input = textarea.value
  if (!input || inputDisabled.value) return
  input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end')
  const value = input.value
  const caret = input.selectionStart
  updateDraft({ target: input })
  await nextTick()
  if (textarea.value !== input || inputDisabled.value || props.draft !== value) return
  input.focus({ preventScroll: true })
  input.setSelectionRange(caret, caret)
}

function focus() {
  if (!inputDisabled.value) textarea.value?.focus()
}

function dismissMobileSheet() {
  return mobileControls.value?.dismiss() || false
}

function openMobileDetails(event) {
  mobileControls.value?.open('details', event)
}

function getSelection() {
  const input = textarea.value
  return input ? { text: input.value, start: input.selectionStart, end: input.selectionEnd } : null
}

function getTextarea() {
  return textarea.value
}

async function restoreSelection(input, value, caret, valid, restoreFocus) {
  await nextTick()
  if (!valid() || textarea.value !== input || !input.isConnected || input.disabled || props.draft !== value) return
  if (restoreFocus?.()) input.focus({ preventScroll: true })
  input.setSelectionRange(caret, caret)
}

defineExpose({ form, focus, getSelection, getTextarea, restoreSelection, mobileSheetOpen, dismissMobileSheet, openMobileDetails })
</script>

<template>
  <form
    ref="form"
    class="start-composer"
    :class="{
      'shell-mode-composer': shellMode,
      'hidden-shell-mode-composer': hiddenShellMode,
      'research-mode-composer': researchMode,
    }"
    @submit.prevent="!switchingUltrafast && emit('submit')"
  >
    <div class="composer-input-shell">
      <Transition name="shell-glyph">
        <span v-if="shellMode" class="shell-prompt-glyph">$</span>
      </Transition>
      <textarea
        ref="textarea"
        :value="draft"
        :placeholder="researchMode
          ? 'Describe the research question, constraints, and desired report'
          : 'Ask Leyline anything'"
        :disabled="inputDisabled"
        @keydown="emit('keydown', $event)"
        @compositionstart="emit('composition-start', $event)"
        @compositionend="emit('composition-end', $event)"
        @blur="emit('input-blur', $event)"
        @input="updateDraft"
        @paste="emit('paste', $event)"
      ></textarea>
    </div>
    <Transition name="composer-popover">
      <div v-if="slashPickerOpen" class="slash-picker">
        <button
          v-for="(command, index) in slashCommandItems"
          :key="`${command.source}-${command.name}`"
          type="button"
          :class="{ active: index === slashActiveIndex }"
          @mousedown.prevent
          @click="emit('select-slash-command', command)"
        >
          <span class="slash-command-name">/{{ command.name }}</span>
          <span class="slash-command-description">
            {{ command.description || 'No description' }}
          </span>
          <span class="slash-command-source">
            {{ slashCommandSourceLabel(command.source) }}
          </span>
        </button>
      </div>
    </Transition>
    <Transition name="composer-reveal">
      <div v-if="attachedImages.length" class="attachment-tray">
      <div
        v-for="(image, index) in attachedImages"
        :key="`${image.mimeType}-${index}`"
        class="attachment-chip"
      >
        <button
          class="attachment-preview-button"
          type="button"
          :aria-label="`Open attached image ${index + 1}`"
          @click="emit('open-image', image.preview, `Attached image ${index + 1}`, $event)"
        >
          <img :src="image.preview" alt="Pasted image" />
        </button>
        <button
          class="attachment-remove-button"
          type="button"
          :aria-label="`Remove attached image ${index + 1}`"
          @click="emit('remove-image', index)"
        >×</button>
      </div>
    </div>
    </Transition>
    <Transition name="composer-reveal">
      <div v-if="imageSupportWarning" class="composer-error">
        {{ imageSupportWarning }}
      </div>
    </Transition>
    <Transition name="composer-reveal">
      <div v-if="visionDelegationNotice" class="composer-notice">{{ visionDelegationNotice }}</div>
    </Transition>
    <DictationStatus :dictation="dictation" />
    <div class="start-composer-bar">
      <div class="composer-primary-row">
        <div class="composer-row-spacer"></div>
        <div class="composer-actions" :class="{ 'has-ultrafast': ultrafastAvailable }">
          <MobileComposerControls
            v-if="mobile"
            ref="mobileControls"
            :available-models="availableModels"
            :available-thinking-levels="availableThinkingLevels"
            :current-model-label="currentModelLabel"
            :selected-model-key="selectedModelKey"
            :model-key="modelKey"
            :thinking-level="thinkingLevel"
            :disabled="inputDisabled"
            :settings-disabled="switchingModel || switchingThinking || switchingUltrafast"
            :settings-error="settingsError"
            :image-disabled="shellMode"
            :ultrafast-available="ultrafastAvailable"
            :ultrafast-enabled="ultrafastEnabled"
            :research-enabled="researchEnabled"
            :research="researchMode"
            :tool-names="toolNames"
            @open="mobileSheetOpen = $event"
            @select-model="emit('select-model', $event)"
            @select-thinking="emit('select-thinking', $event)"
            @toggle-ultrafast="emit('toggle-ultrafast')"
            @toggle-research="emit('toggle-session-kind')"
            @pick-images="emit('pick-images', $event)"
            @newline="insertNewline"
          />
          <ModelPicker
            :available-models="availableModels"
            :current-model-label="currentModelLabel"
            :disabled="switchingModel || switchingUltrafast || availableModels.length === 0"
            :model-key="modelKey"
            :open="modelPickerOpen && !switchingUltrafast"
            :selected-model-key="selectedModelKey"
            start
            @select="!switchingUltrafast && emit('select-model', $event)"
            @toggle="emit('toggle-picker', 'model')"
          />
          <div class="model-picker small-picker start-picker">
            <button
              class="composer-chip model-picker-button start-composer-chip"
              type="button"
              :disabled="switchingThinking || switchingUltrafast || !availableThinkingLevels.length"
              @click="emit('toggle-picker', 'thinking')"
            >
              <span class="model-label">{{ currentThinkingLabel }}</span>
              <span class="model-caret">▾</span>
            </button>
            <Transition name="composer-popover">
              <div v-if="thinkingPickerOpen && !switchingUltrafast" class="model-menu small-menu">
                <button
                  v-for="level in availableThinkingLevels"
                  :key="level"
                  type="button"
                  :class="{ active: level === thinkingLevel }"
                  :disabled="switchingUltrafast"
                  @click="!switchingUltrafast && emit('select-thinking', level)"
                >
                  <span>{{ formatMode(level) }}</span>
                  <span v-if="level === thinkingLevel">✓</span>
                </button>
              </div>
            </Transition>
          </div>
          <UltrafastToggle
            v-if="ultrafastAvailable"
            :enabled="ultrafastEnabled"
            :disabled="!!creatingSessionCwd
              || switchingModel
              || switchingThinking
              || switchingUltrafast"
            start
            @toggle="emit('toggle-ultrafast')"
          />
          <button
            class="dictation-button"
            :class="{
              active: dictation.active,
              unsupported: !dictation.supported,
            }"
            type="button"
            :disabled="dictation.buttonDisabled || inputDisabled || dictationSubmitting"
            :title="dictation.title"
            :aria-label="dictation.title"
            :aria-disabled="!dictation.supported"
            :aria-pressed="dictation.active"
            @mousedown.prevent
            @click="dictation.toggle({ focusFrom: $event.currentTarget })"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="9"
                y="3"
                width="6"
                height="11"
                rx="3"
                stroke="currentColor"
                stroke-width="1.8"
              ></rect>
              <path
                d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              ></path>
            </svg>
          </button>
          <button
            class="start-send-button"
            :class="{ 'shell-run-button': shellMode }"
            type="submit"
            :title="shellMode ? 'Run shell command' : 'Send message'"
            :disabled="!newSessionCwd.trim()
              || !!creatingSessionCwd
              || switchingUltrafast
              || dictationSubmitting
              || !!imageSupportWarning
              || (!dictation.active && shellMode && (!shellCommand || attachedImages.length))"
          >{{ shellMode ? 'Run' : '↑' }}</button>
        </div>
      </div>
      <div class="composer-context-row">
        <button
          class="composer-chip composer-input-action"
          type="button"
          :disabled="inputDisabled || shellMode"
          @click="emit('pick-images', $event)"
        >Add image</button>
        <button
          class="composer-chip composer-input-action composer-newline-button"
          type="button"
          :disabled="inputDisabled"
          @mousedown.prevent
          @click="insertNewline"
        >New line</button>
        <button
          class="start-project-button"
          type="button"
          @click="emit('toggle-project-picker')"
        >
          <span class="start-project-icon">▱</span>
          <span class="start-project-label">{{ startProjectLabel }}</span>
          <span class="model-caret">▾</span>
        </button>
        <button
          v-if="researchEnabled"
          class="composer-chip start-composer-chip research-mode-chip"
          :class="{ active: researchMode }"
          type="button"
          :disabled="shellMode || inputDisabled"
          :aria-pressed="researchMode"
          title="Toggle deep research mode"
          @click="emit('toggle-session-kind')"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 2h4M7 2v4l-3.5 6A1.3 1.3 0 0 0 4.6 14h6.8a1.3 1.3 0 0 0 1.1-2L9 6V2M5.5 10h5"></path>
          </svg>
          <span>research</span>
        </button>
        <span
          v-if="shellMode"
          class="composer-chip start-composer-chip shell-mode-chip"
          :class="{ 'hidden-shell-mode-chip': hiddenShellMode }"
        >
          {{ shellModeLabel }}
        </span>
        <span
          v-for="chip in chips"
          :key="chip"
          class="composer-chip start-composer-chip"
        >
          {{ chip }}
        </span>
        <div class="model-picker tool-picker start-tool-picker">
          <button
            class="composer-chip model-picker-button start-composer-chip
              tool-picker-button"
            type="button"
            @click="emit('toggle-picker', 'tools')"
          >
            <span class="model-label">{{ toolsChipLabel }}</span>
            <span class="model-caret">▾</span>
          </button>
          <Transition name="composer-popover">
            <div v-if="toolsPickerOpen" class="model-menu tool-menu">
              <div class="mode-menu-label">Enabled tools</div>
              <div v-if="!toolNames.length" class="tool-menu-empty">
                No tools are enabled for this session.
              </div>
              <div
                v-for="tool in toolNames"
                :key="tool"
                class="tool-menu-row"
              >
                <span>{{ tool }}</span>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
    <Teleport to="body" :disabled="!mobile">
    <Transition name="composer-popover">
      <div
        v-if="startProjectPickerOpen"
        ref="startProjectMenu"
        class="start-project-menu"
        :style="startProjectMenuStyle"
      >
        <label>
          <span>⌕</span>
          <input
            :value="startProjectQuery"
            placeholder="Search projects"
            aria-label="Search projects"
            @input="emit('update:startProjectQuery', $event.target.value)"
          />
        </label>
        <button
          v-for="project in startProjectOptions"
          :key="project.cwd"
          type="button"
          @click="emit('select-project', project.cwd, $event)"
          @auxclick.middle.prevent="emit(
            'select-project',
            project.cwd,
            $event,
          )"
        >
          <span>▱</span>
          <strong>{{ project.name }}</strong>
          <em v-if="project.cwd === newSessionCwd">✓</em>
        </button>
        <div class="start-project-divider"></div>
        <button type="button" @click="emit('open-project-browser')">
          <span>＋</span>
          <strong>Add new project</strong>
        </button>
      </div>
    </Transition>
    </Teleport>
  </form>
</template>

<style scoped>
.composer-context-row {
  flex-wrap: wrap;
}

.composer-input-action {
  flex: none;
  min-height: 28px;
}

.composer-newline-button {
  display: none;
}

.start-project-menu {
  align-content: start;
  grid-auto-rows: max-content;
  overscroll-behavior: contain;
}

@media (hover: none), (pointer: coarse) {
  .start-composer textarea,
  .start-project-menu input {
    font-size: 16px;
  }

  .composer-input-action,
  .start-project-menu button {
    min-height: 44px;
  }

  .start-composer .composer-context-row > .composer-chip.composer-input-action {
    display: inline-flex;
    align-items: center;
  }
}
</style>
