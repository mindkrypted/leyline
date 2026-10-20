<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
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
const target = computed(() => tasks.value[selectedIndex.value])
const targetStatus = computed(() => target.value ? taskStatus(target.value) : fallback.value.status)
const preview = useSubagentPreview(computed(() => target.value?.childSession), targetStatus)
const targetViews = shallowRef(new Map())
const requestedView = computed(() => ({
  index: selectedIndex.value,
  task: target.value,
  status: targetStatus.value,
  output: target.value ? subagentOutput(target.value) : '',
  activity: preview.activity.value,
  compacting: preview.compacting.value,
  connection: preview.connection.value,
  error: preview.error.value,
  items: preview.items.value.map(item => ({ item, key: preview.itemKey(item) })),
  ready: preview.ready.value,
  runtimeError: preview.runtimeError.value,
  started: preview.started.value,
  views: targetViews.value,
}))
const presentation = shallowRef(requestedView.value)
const waiting = computed(() => requestedView.value.index !== presentation.value.index)
const selected = computed(() => presentation.value.task)
const status = computed(() => presentation.value.status)
const output = computed(() => presentation.value.output)
const outputHtml = computed(() => renderedText(output.value))
const copyId = computed(() => `subagent-${props.entry.toolCallId || props.entry.id}-${presentation.value.index}`)
const title = computed(() => tasks.value.length > 1 ? subagentCallTitle(props.entry)
  : selected.value ? subagentTaskTitle(selected.value) : 'Task details')
const previewActivity = computed(() => presentation.value.activity)
const previewCompacting = computed(() => presentation.value.compacting)
const previewConnection = computed(() => presentation.value.connection)
const previewError = computed(() => presentation.value.error)
const previewItems = computed(() => presentation.value.items.map(row => row.item))
const previewReady = computed(() => presentation.value.ready)
const previewRuntimeError = computed(() => presentation.value.runtimeError)
const previewStarted = computed(() => presentation.value.started)
const refreshPreview = () => preview.refresh()
const following = ref(true)
const hasNewOutput = ref(false)
const tailContent = ref(null)
const tailViews = computed(() => presentation.value.views)
const taskList = ref(null)
const taskMarker = ref(null)
const hasTaskMarker = ref(false)
const motions = new Map()
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
let taskObserver

watch(() => tasks.value.length, length => {
  if (selectedIndex.value >= length) selectTask(0)
})
watch([() => target.value?.childSession?.id, () => target.value?.childSession?.path], () => {
  targetViews.value = new Map()
}, { flush: 'sync' })
watch(requestedView, view => {
  if (view.index === presentation.value.index || !view.started || view.ready) presentation.value = view
}, { flush: 'post' })
watch(() => presentation.value.index, () => {
  const revision = ++scrollRevision
  cancelAnimationFrame(scrollFrame)
  pinning = true
  following.value = true
  hasNewOutput.value = false
  nextTick(() => {
    if (revision !== scrollRevision || !body.value) return
    body.value.scrollTop = previewStarted.value && previewReady.value ? body.value.scrollHeight : 0
    scrollFrame = requestAnimationFrame(() => {
      if (revision === scrollRevision) pinning = false
    })
  })
})
watch([selectedIndex, () => tasks.value.length], positionTaskMarker, { flush: 'post' })
watch(taskList, element => {
  taskObserver?.disconnect()
  if (!element) return
  taskObserver = new ResizeObserver(positionTaskMarker)
  taskObserver.observe(element)
  positionTaskMarker()
}, { flush: 'post' })
watch([previewItems, previewReady, previewActivity, previewConnection, previewError, output, status], () => {
  const retainedViews = new Set()
  for (const item of previewItems.value) {
    if (item.type !== 'tool-activity') continue
    retainedViews.add(`group:${item.id}`)
    for (const call of item.items) retainedViews.add(`tool:${call.toolCallId || activityEntry(call).toolCallId || call.id}`)
  }
  for (const key of tailViews.value.keys()) if (!retainedViews.has(key)) tailViews.value.delete(key)
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
watch([tailContent, () => selected.value?.childSession?.id, previewReady], ([element]) => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (!element || !previewReady.value) return
  const observer = new ResizeObserver(() => {
    if (resizeObserver === observer && element.isConnected && following.value) followLatest()
  })
  resizeObserver = observer
  observer.observe(element)
  if (body.value) observer.observe(body.value)
}, { flush: 'post' })
onBeforeUnmount(() => {
  scrollRevision++
  cancelAnimationFrame(scrollFrame)
  resizeObserver?.disconnect()
  resizeObserver = null
  taskObserver?.disconnect()
  for (const animation of motions.values()) animation.cancel()
  motions.clear()
})

function positionTaskMarker() {
  const task = taskList.value?.querySelector('[aria-pressed="true"]')
  if (!task || !taskMarker.value) return
  Object.assign(taskMarker.value.style, {
    transform: `translateY(${task.offsetTop}px)`,
    left: `${task.offsetLeft}px`,
    width: `${task.offsetWidth}px`,
    height: `${task.offsetHeight}px`,
  })
  hasTaskMarker.value = true
}

function prepareEnter(element) {
  element.style.opacity = '0'
  element.style.transform = `translateY(${element.classList.contains('subagent-inspector-content') ? 14 : 4}px)`
}

function interruptMotion(element) {
  const animation = motions.get(element)
  if (!animation) return
  const style = getComputedStyle(element)
  element.style.opacity = style.opacity
  element.style.transform = style.transform
  animation.cancel()
  motions.delete(element)
}

function animateContent(element, done, entering) {
  const reader = element.classList.contains('subagent-inspector-content')
  if (entering && reader) element.scrollTop = previewStarted.value && previewReady.value ? element.scrollHeight : 0
  if (!entering) {
    element.inert = true
    element.setAttribute('aria-hidden', 'true')
  }
  interruptMotion(element)
  const style = getComputedStyle(element)
  const animation = element.animate([
    { opacity: style.opacity, transform: style.transform },
    { opacity: entering ? 1 : 0, transform: entering ? 'translateY(0)' : `translateY(${reader ? -8 : -4}px)` },
  ], {
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : reader ? entering ? 420 : 280 : 260,
    easing: style.getPropertyValue(entering ? '--ease-dock' : '--ease-accelerate').trim() || 'ease',
    fill: 'both',
  })
  motions.set(element, animation)
  animation.finished.then(() => {
    if (motions.get(element) !== animation) return
    motions.delete(element)
    if (entering) {
      element.style.opacity = ''
      element.style.transform = ''
    }
    done()
    animation.cancel()
  }).catch(() => {})
}

function taskStatus(task) {
  return subagentStatus(task, outcome.value.active)
}

function selectTask(index) {
  if (index !== selectedIndex.value) selectedIndex.value = index
}

function followLatest() {
  const revision = ++scrollRevision
  cancelAnimationFrame(scrollFrame)
  pinning = true
  nextTick(() => {
    if (revision !== scrollRevision || !body.value || !following.value) return
    body.value.scrollTop = body.value.scrollHeight
    hasNewOutput.value = false
    scrollFrame = requestAnimationFrame(() => {
      if (revision === scrollRevision) pinning = false
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

    <nav v-if="tasks.length > 1" ref="taskList" class="subagent-inspector-tasks" :class="{ 'has-selection-marker': hasTaskMarker }" aria-label="Subagent tasks">
      <span ref="taskMarker" class="subagent-inspector-task-marker" :hidden="!hasTaskMarker" aria-hidden="true"></span>
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

    <div class="subagent-inspector-reader-stack" :aria-busy="waiting">
      <Transition
        :css="false"
        @before-enter="prepareEnter"
        @enter="(element, done) => animateContent(element, done, true)"
        @leave="(element, done) => animateContent(element, done, false)"
        @enter-cancelled="interruptMotion"
        @leave-cancelled="interruptMotion"
      >
        <div
          :key="`${presentation.index}:${previewStarted && !previewReady ? 'loading' : 'content'}`"
          ref="body"
          class="subagent-inspector-content"
          :inert="waiting"
          :aria-hidden="waiting || undefined"
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
            <details v-if="selected.task" class="subagent-inspector-prompt">
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
              <template v-if="previewReady">
                <SubagentTailEntry
                  v-for="row in presentation.items"
                  :key="row.key"
                  :item="row.item"
                  :following="following"
                  :views="tailViews"
                />
                <p v-if="showActivity" class="subagent-tail-activity" role="status">
                  <span class="live-tool-spinner" aria-hidden="true"></span>
                  {{ previewCompacting ? 'Compacting context…' : previewActivity }}
                </p>
                <p v-else-if="!previewItems.length && !previewError && status === 'running'" class="subagent-inspector-empty">Waiting for child activity.</p>
                <pre v-if="previewRuntimeError && previewRuntimeError !== selected.error && previewRuntimeError !== output" class="subagent-inspector-error">{{ previewRuntimeError }}</pre>
              </template>
              <p v-else class="subagent-tail-activity" role="status">
                <span class="live-tool-spinner" aria-hidden="true"></span>
                Loading child activity…
              </p>
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
      </Transition>
    </div>

    <footer class="subagent-inspector-footer has-motion-footer">
      <Transition
        :css="false"
        @before-enter="prepareEnter"
        @enter="(element, done) => animateContent(element, done, true)"
        @leave="(element, done) => animateContent(element, done, false)"
        @enter-cancelled="interruptMotion"
        @leave-cancelled="interruptMotion"
      >
        <div :key="`${presentation.index}:${waiting}`" class="subagent-inspector-footer-content">
          <button
            v-if="selected?.childSession"
            class="subagent-inspector-session"
            type="button"
            :disabled="waiting"
            @click="emit('navigate-child-session', selected.childSession, $event)"
            @auxclick.middle.prevent="emit('navigate-child-session', selected.childSession, $event)"
          >
            Open child session
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4h7v7M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>
          </button>
          <span v-else>{{ ['running', 'queued', 'not-started'].includes(status) ? 'No child session yet' : 'Child session unavailable' }}</span>
          <span v-if="waiting" class="subagent-tail-following" role="status">Preparing preview…</span>
          <button v-else-if="previewStarted && !following" class="subagent-tail-jump" type="button" @click="jumpToLatest">
            {{ hasNewOutput ? 'New output' : 'Jump to latest' }}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6" /></svg>
          </button>
          <span v-else-if="previewStarted && status === 'running'" class="subagent-tail-following">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6" /></svg>
            {{ !previewReady ? 'Loading preview…' : previewConnection === 'settled' ? 'Live feed ended' : 'Following live' }}
          </span>
          <button v-else-if="output" type="button" @click="emit('copy', copyId, output)">
            <CopyIcon :copied="copiedEntryId === copyId" />{{ copiedEntryId === copyId ? 'Copied' : 'Copy result' }}
          </button>
        </div>
      </Transition>
    </footer>
  </section>
</template>
