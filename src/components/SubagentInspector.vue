<script setup>
import { computed, ref, watch } from 'vue'
import CopyIcon from './CopyIcon.vue'
import { subagentStatus, subagentStatuses, subagentSummary } from '../../lib/subagent-status.js'
import { subagentCallTitle, subagentEmptyText, subagentFallback, subagentOutput, subagentTasks, subagentTaskTitle } from '../../lib/subagent-view.js'
import { renderedText } from '../lib/transcript'

const props = defineProps({
  entry: { type: Object, required: true },
  toolStatus: { type: String, default: '' },
  copiedEntryId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'copy', 'copy-entry', 'navigate-child-session', 'open-image'])
const pane = ref(null)
const body = ref(null)
const selectedIndex = ref(0)
const tasks = computed(() => subagentTasks(props.entry))
const outcome = computed(() => subagentSummary(props.entry, props.toolStatus))
const fallback = computed(() => subagentFallback(props.entry, props.toolStatus))
const selected = computed(() => tasks.value[selectedIndex.value])
const status = computed(() => selected.value ? taskStatus(selected.value) : fallback.value.status)
const output = computed(() => selected.value ? subagentOutput(selected.value) : '')
const outputHtml = computed(() => renderedText(output.value))
const copyId = computed(() => `subagent-${props.entry.toolCallId || props.entry.id}-${selectedIndex.value}`)
const title = computed(() => tasks.value.length > 1 ? subagentCallTitle(props.entry)
  : tasks.value.length ? '1 delegated task' : 'Task details')

watch(() => tasks.value.length, length => {
  if (selectedIndex.value >= length) selectedIndex.value = 0
})

function taskStatus(task) {
  return subagentStatus(task, outcome.value.active)
}

function selectTask(index) {
  selectedIndex.value = index
  body.value?.scrollTo({ top: 0 })
}

function openImage(event) {
  const image = event.target.closest('img')
  if (!image) return
  event.preventDefault()
  emit('open-image', image.currentSrc || image.src, image.alt || 'Subagent image', event)
}

defineExpose({ element: pane })
</script>

<template>
  <section
    id="subagent-inspector"
    ref="pane"
    class="subagent-inspector"
    role="dialog"
    aria-modal="true"
    aria-labelledby="subagent-inspector-title"
    tabindex="-1"
  >
    <header class="subagent-inspector-header">
      <div>
        <p>{{ entry.researchThreads ? 'Research threads' : 'Subagent' }}</p>
        <h2 id="subagent-inspector-title">{{ title }}</h2>
      </div>
      <button
        class="subagent-inspector-icon-button"
        type="button"
        :title="copiedEntryId === entry.id ? 'Copied' : 'Copy tool output'"
        @click="emit('copy-entry', entry)"
      ><CopyIcon :copied="copiedEntryId === entry.id" /></button>
      <button class="subagent-inspector-icon-button" type="button" aria-label="Close subagent inspector" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </header>

    <div class="subagent-inspector-summary">
      <div v-if="outcome.counts.length" class="subagent-summary" aria-label="Task outcomes" aria-live="polite">
        <span v-for="count in outcome.counts" :key="count.status" :class="`status-${count.status}`">{{ count.text }}</span>
      </div>
      <span v-else class="subagent-task-status" :class="`status-${fallback.status}`">{{ fallback.label }}</span>
      <p v-if="tasks.length === 1" class="subagent-inspector-task-title">{{ subagentTaskTitle(tasks[0]) }}</p>
    </div>

    <nav v-if="tasks.length > 1" class="subagent-inspector-tasks" aria-label="Subagent tasks">
      <button
        v-for="(task, index) in tasks"
        :key="index"
        class="subagent-inspector-task"
        type="button"
        :aria-pressed="selectedIndex === index"
        :title="subagentTaskTitle(task, index)"
        @click="selectTask(index)"
      >
        <span class="subagent-inspector-index">{{ index + 1 }}</span>
        <span class="subagent-inspector-task-label">{{ subagentTaskTitle(task, index) }}</span>
        <span class="subagent-task-status" :class="`status-${taskStatus(task)}`">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path :d="subagentStatuses[taskStatus(task)].path" /></svg>
          {{ subagentStatuses[taskStatus(task)].label }}
        </span>
      </button>
    </nav>

    <div
      ref="body"
      class="subagent-inspector-content"
      tabindex="0"
      aria-label="Selected task details"
      :data-file-session-id="selected?.childSession?.id"
    >
      <template v-if="selected">
        <div class="subagent-inspector-meta">
          <span>Agent <code>{{ selected.agent }}</code></span>
          <span v-if="selected.research">{{ selected.research.sources?.length || 0 }} sources</span>
          <span class="subagent-task-status" :class="`status-${status}`">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path :d="subagentStatuses[status].path" /></svg>
            {{ subagentStatuses[status].label }}
          </span>
        </div>
        <details v-if="selected.task" :key="selectedIndex" class="subagent-inspector-prompt">
          <summary><span aria-hidden="true">›</span> Full task prompt</summary>
          <pre>{{ selected.task }}</pre>
        </details>
        <h3>{{ output ? (status === 'completed' ? 'Result' : 'Output') : 'Task outcome' }}</h3>
        <div v-if="output" class="subagent-inspector-output markdown-body" v-html="outputHtml" @click="openImage"></div>
        <p v-else class="subagent-inspector-empty">{{ subagentEmptyText(status) }}</p>
        <pre v-if="selected.error && selected.error !== output" class="subagent-inspector-error">{{ selected.error }}</pre>
      </template>
      <p v-else class="subagent-inspector-empty">{{ fallback.status === 'running' ? 'Waiting for task updates.' : 'Individual task details are unavailable.' }}</p>
      <template v-if="entry.text && (!selected || entry.subagentDetails?.resultsUnavailable)">
        <h3 v-if="selected">Call output</h3>
        <pre class="subagent-inspector-raw">{{ entry.text }}</pre>
      </template>
    </div>

    <footer class="subagent-inspector-footer">
      <button
        v-if="selected?.childSession"
        class="subagent-inspector-session"
        type="button"
        @click="emit('navigate-child-session', selected.childSession, $event)"
        @auxclick.middle.prevent="emit('navigate-child-session', selected.childSession, $event)"
      >
        Open child session
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4h7v7M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>
      </button>
      <span v-else>{{ ['running', 'queued', 'not-started'].includes(status) ? 'No child session yet' : 'Child session unavailable' }}</span>
      <button v-if="output" type="button" @click="emit('copy', copyId, output)">
        <CopyIcon :copied="copiedEntryId === copyId" />{{ copiedEntryId === copyId ? 'Copied' : 'Copy result' }}
      </button>
    </footer>
  </section>
</template>
