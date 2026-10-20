<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import CopyIcon from './CopyIcon.vue'
import SubagentTailEntry from './SubagentTailEntry.vue'
import { activityEntry, activitySummary } from '../../lib/tool-activity.js'
import { subagentStatus, subagentStatuses, subagentSummary } from '../../lib/subagent-status.js'
import { subagentCallTitle, subagentEmptyText, subagentFallback, subagentOutput, subagentTasks, subagentTaskTitle } from '../../lib/subagent-view.js'
import { renderedText } from '../lib/transcript'
import { useSubagentPreview } from '../composables/useSubagentPreview'

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
  : selected.value ? subagentTaskTitle(selected.value) : 'Task details')
const {
  activity: previewActivity,
  compacting: previewCompacting,
  connection: previewConnection,
  error: previewError,
  items: previewItems,
  itemKey: previewItemKey,
  loading: previewLoading,
  refresh: refreshPreview,
  runtimeError: previewRuntimeError,
  started: previewStarted,
} = useSubagentPreview(computed(() => selected.value?.childSession), status)
const following = ref(true)
const hasNewOutput = ref(false)
const tailContent = ref(null)
const tailViews = new Map()
const previewLabel = computed(() => ({
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  live: 'Live updates',
  settled: status.value === 'running' ? 'Live feed ended' : 'Saved activity',
}[previewConnection.value] || ''))
const showActivity = computed(() => previewActivity.value
  && !previewItems.value.some(item => item.type === 'tool-activity' && activitySummary(item.items).busy)
  && !previewItems.value.at(-1)?.streaming)
const showResult = computed(() => !previewStarted.value || (output.value
  && (status.value !== 'running' || !previewItems.value.length)
  && !previewItems.value.some(item => {
    const entry = activityEntry(item)
    return item.type !== 'tool-activity' && entry.text?.trim() === output.value.trim()
  })))
let scrollFrame
let scrollRevision = 0
let pinning = false
let resizeObserver

watch(() => tasks.value.length, length => {
  if (selectedIndex.value >= length) selectTask(0)
})
watch([() => selected.value?.childSession?.id, () => selected.value?.childSession?.path], () => tailViews.clear())
watch([previewItems, previewActivity, previewConnection, previewError, output, status], () => {
  const retainedViews = new Set()
  for (const item of previewItems.value) {
    if (item.type !== 'tool-activity') continue
    retainedViews.add(`group:${item.id}`)
    for (const call of item.items) retainedViews.add(`tool:${call.toolCallId || activityEntry(call).toolCallId || call.id}`)
  }
  for (const key of tailViews.keys()) if (!retainedViews.has(key)) tailViews.delete(key)
  if (!previewStarted.value) return
  if (following.value) {
    followLatest()
    return
  }
  hasNewOutput.value = true
  const bounds = body.value?.getBoundingClientRect()
  const focused = document.activeElement
  const focusBounds = focused?.getBoundingClientRect()
  const focusAnchor = body.value?.contains(focused) && bounds && focusBounds.top >= bounds.top && focusBounds.bottom <= bounds.bottom
    ? focused.closest('[data-subagent-tail-entry]') : null
  const anchor = focusAnchor || [...(body.value?.querySelectorAll('[data-subagent-tail-entry]') || [])]
    .find(element => {
      const top = element.getBoundingClientRect().top
      return bounds && top >= bounds.top && top < bounds.bottom
    })
  const anchorTop = anchor?.getBoundingClientRect().top
  const anchorKey = anchor?.getAttribute('data-subagent-tail-entry')
  const revision = scrollRevision
  nextTick(() => {
    if (revision !== scrollRevision || following.value || !body.value || !anchor) return
    const current = anchor.isConnected ? anchor : [...body.value.querySelectorAll('[data-subagent-tail-entry]')]
      .find(element => element.getAttribute('data-subagent-tail-entry') === anchorKey)
    if (!current) return
    pinning = true
    body.value.scrollTop += current.getBoundingClientRect().top - anchorTop
    if (focusAnchor && !focused.isConnected) current.querySelector('summary, button, a')?.focus({ preventScroll: true })
    cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      if (revision === scrollRevision) pinning = false
    })
  })
})
watch(tailContent, element => {
  resizeObserver?.disconnect()
  if (!element) return
  resizeObserver = new ResizeObserver(() => {
    if (following.value) followLatest()
  })
  resizeObserver.observe(element)
  if (body.value) resizeObserver.observe(body.value)
}, { flush: 'post' })
onBeforeUnmount(() => {
  scrollRevision++
  cancelAnimationFrame(scrollFrame)
  resizeObserver?.disconnect()
})

function taskStatus(task) {
  return subagentStatus(task, outcome.value.active)
}

function selectTask(index) {
  scrollRevision++
  cancelAnimationFrame(scrollFrame)
  pinning = false
  following.value = true
  hasNewOutput.value = false
  selectedIndex.value = index
  body.value?.scrollTo({ top: 0 })
}

function followLatest() {
  const revision = ++scrollRevision
  cancelAnimationFrame(scrollFrame)
  pinning = true
  nextTick(() => {
    if (revision !== scrollRevision || !following.value) return
    scrollFrame = requestAnimationFrame(() => {
      if (revision !== scrollRevision || !body.value || !following.value) return
      body.value.scrollTop = body.value.scrollHeight
      hasNewOutput.value = false
      scrollFrame = requestAnimationFrame(() => {
        if (revision === scrollRevision) pinning = false
      })
    })
  })
}

function pauseFollowing() {
  scrollRevision++
  cancelAnimationFrame(scrollFrame)
  pinning = false
  following.value = false
}

function handleScroll() {
  if (pinning || !body.value) return
  const element = body.value
  following.value = element.scrollHeight - element.clientHeight - element.scrollTop < 32
  if (following.value) hasNewOutput.value = false
}

function jumpToLatest() {
  following.value = true
  followLatest()
}

function contentClick(event) {
  if (event.target.closest('summary')) pauseFollowing()
  openImage(event)
}

function contentPointerDown(event) {
  if (body.value && event.clientX >= body.value.getBoundingClientRect().right - 16) pauseFollowing()
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

    <div v-if="tasks.length !== 1" class="subagent-inspector-summary">
      <div v-if="outcome.counts.length" class="subagent-summary" aria-label="Task outcomes" aria-live="polite">
        <span v-for="count in outcome.counts" :key="count.status" :class="`status-${count.status}`">{{ count.text }}</span>
      </div>
      <span v-else class="subagent-task-status" :class="`status-${fallback.status}`">{{ fallback.label }}</span>
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
      @scroll="handleScroll"
      @wheel.passive="$event.deltaY < 0 && pauseFollowing()"
      @touchmove.passive="pauseFollowing"
      @pointerdown="contentPointerDown"
      @keydown="['ArrowUp', 'PageUp', 'Home'].includes($event.key) && pauseFollowing()"
      @click="contentClick"
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
        <section v-if="previewStarted" ref="tailContent" class="subagent-tail" aria-label="Child session activity">
          <div class="subagent-tail-heading">
            <h3>{{ status === 'running' ? 'Live activity' : 'Task activity' }}</h3>
            <span>{{ previewLabel }}</span>
          </div>
          <div v-if="previewError || previewConnection === 'reconnecting'" class="subagent-tail-notice" role="status">
            <span>{{ previewError ? 'Child activity could not be loaded.' : 'Reconnecting. Showing the last received activity.' }}</span>
            <button v-if="previewError" type="button" @click="refreshPreview">Retry</button>
          </div>
          <SubagentTailEntry
            v-for="item in previewItems"
            :key="previewItemKey(item)"
            :item="item"
            :following="following"
            :views="tailViews"
          />
          <p v-if="showActivity || (previewLoading && !previewItems.length)" class="subagent-tail-activity" role="status">
            <span class="live-tool-spinner" aria-hidden="true"></span>
            {{ previewCompacting ? 'Compacting context…' : previewActivity || 'Loading child activity…' }}
          </p>
          <p v-else-if="!previewItems.length && !previewError && status === 'running'" class="subagent-inspector-empty">Waiting for child activity.</p>
          <pre v-if="previewRuntimeError && previewRuntimeError !== selected.error && previewRuntimeError !== output" class="subagent-inspector-error">{{ previewRuntimeError }}</pre>
        </section>
        <template v-if="showResult">
          <h3>{{ output ? (status === 'completed' ? 'Result' : 'Output') : 'Task outcome' }}</h3>
          <div v-if="output" class="subagent-inspector-output markdown-body" v-html="outputHtml"></div>
          <p v-else class="subagent-inspector-empty">{{ subagentEmptyText(status) }}</p>
        </template>
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
      <button v-if="previewStarted && !following" class="subagent-tail-jump" type="button" @click="jumpToLatest">
        {{ hasNewOutput ? 'New output' : 'Jump to latest' }}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6" /></svg>
      </button>
      <span v-else-if="previewStarted && status === 'running'" class="subagent-tail-following">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6" /></svg>
        {{ previewConnection === 'settled' ? 'Live feed ended' : 'Following live' }}
      </span>
      <button v-else-if="output" type="button" @click="emit('copy', copyId, output)">
        <CopyIcon :copied="copiedEntryId === copyId" />{{ copiedEntryId === copyId ? 'Copied' : 'Copy result' }}
      </button>
    </footer>
  </section>
</template>
