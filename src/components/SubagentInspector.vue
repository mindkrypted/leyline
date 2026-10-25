<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import CopyIcon from './CopyIcon.vue'
import SubagentTailEntry from './SubagentTailEntry.vue'
import { subagentStatus, subagentStatuses, subagentSummary } from '../../lib/subagent-status.js'
import { subagentCallTitle, subagentEmptyText, subagentFallback, subagentModelChips, subagentOutput, subagentTasks, subagentTaskTitle } from '../../lib/subagent-view.js'
import { subagentLedgerRows, subagentLedgerText, subagentLedgerTitle } from '../../lib/subagent-ledger.js'
import { imageSrc, renderedBlock } from '../lib/transcript'
import { useSubagentPreview } from '../composables/useSubagentPreview'

const props = defineProps({
  entry: { type: Object, required: true },
  toolStatus: { type: String, default: '' },
  copiedEntryId: { type: String, default: '' },
  initialTaskIndex: { type: Number, default: 0 },
})
const emit = defineEmits(['close', 'copy', 'copy-entry', 'navigate-child-session', 'open-image'])
const pane = ref(null)
const body = ref(null)
const tailContent = ref(null)
const taskList = ref(null)
const taskMarker = ref(null)
const hasTaskMarker = ref(false)
const selectedIndex = ref(props.initialTaskIndex || 0)
const tasks = computed(() => subagentTasks(props.entry))
const outcome = computed(() => subagentSummary(props.entry, props.toolStatus))
const fallback = computed(() => subagentFallback(props.entry, props.toolStatus))
const target = computed(() => tasks.value[selectedIndex.value])
const targetStatus = computed(() => target.value ? taskStatus(target.value) : fallback.value.status)
const preview = useSubagentPreview(computed(() => target.value?.childSession), targetStatus)
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
  model: preview.model.value,
  thinkingLevel: preview.thinkingLevel.value,
}))
const presentation = shallowRef(requestedView.value)
const waiting = computed(() => requestedView.value.index !== presentation.value.index)
const selected = computed(() => presentation.value.task)
const status = computed(() => presentation.value.status)
const modelChips = computed(() => subagentModelChips(selected.value, {
  model: presentation.value.model,
  thinkingLevel: presentation.value.thinkingLevel,
}))
const title = computed(() => tasks.value.length > 1 ? subagentCallTitle(props.entry)
  : selected.value ? subagentTaskTitle(selected.value) : 'Task details')
const resultKeys = new Map()
const ledgerCache = new Map()
const rows = computed(() => {
  const rows = subagentLedgerRows(presentation.value.items, ledgerCache)
  const output = presentation.value.output
  const matching = output && rows.find(row => row.kind === 'message' && row.text.trim() === output.trim())
  if (matching) {
    const key = resultKey(output, matching.key, rows)
    if (key !== matching.key || status.value === 'completed') {
      rows[rows.indexOf(matching)] = { ...matching, key, ...(status.value === 'completed' ? { kind: 'result', action: 'Result' } : {}) }
    }
  } else if (output && status.value !== 'running') {
    rows.push(textRow(resultKey(output, 'result', rows), output, status.value === 'failed' ? 'error' : 'saved', 'Result'))
  } else if (output && !rows.length) {
    rows.push(textRow(resultKey(output, 'result', rows), output, 'running', 'Output'))
  }
  for (const error of new Set([selected.value?.error, presentation.value.runtimeError].filter(Boolean))) {
    if (!rows.some(row => row.text.trim() === error.trim())) rows.push(textRow('error', error, 'error', 'Error'))
  }
  if (props.entry.text && (!selected.value || props.entry.subagentDetails?.resultsUnavailable)) {
    rows.push(textRow('call', props.entry.text, 'saved', 'Call output'))
  }
  return rows
})
const latest = computed(() => rows.value.findLast(row => ['message', 'thought', 'result'].includes(row.kind)))
const callCount = computed(() => rows.value.filter(row => row.kind === 'tool').length)
const reader = shallowRef(null)
const readerRow = computed(() => reader.value && (rows.value.find(row => row.key === reader.value.key) || reader.value))
const format = ref('formatted')
const readerText = computed(() => format.value === 'args' ? JSON.stringify(readerRow.value?.args, null, 2) || '' : readerRow.value?.text || '')
const readerStreaming = computed(() => readerRow.value?.streaming === true)
const readerHtml = computed(() => format.value === 'formatted'
  ? renderedBlock({ text: readerText.value }, { streaming: readerStreaming.value }) : '')
const readerImage = computed(() => {
  const image = readerRow.value?.preview
  return image?.data && (image.type === 'image' || image.kind === 'image') ? imageSrc(image) : ''
})
const formats = computed(() => readerRow.value?.kind === 'tool'
  ? [{ value: 'raw', label: 'Output' }, { value: 'args', label: 'Arguments', disabled: readerRow.value.args === undefined }]
  : [{ value: 'formatted', label: 'Formatted' }, { value: 'raw', label: 'Source' }])
const viewKey = computed(() => `${presentation.value.index}:${reader.value?.key || 'ledger'}`)
const copyId = computed(() => `subagent-${props.entry.toolCallId || props.entry.id}-${viewKey.value}:${format.value}`)
const previewLabel = computed(() => ({
  connecting: 'Connecting…', reconnecting: 'Reconnecting…', live: 'Live updates',
  settled: status.value === 'running' ? 'Live feed ended' : 'Saved activity',
}[presentation.value.connection] || subagentStatuses[status.value]?.label || 'Task details'))
const following = ref(true)
const readerFollowing = ref(false)
const hasNewOutput = ref(false)
const readPosition = ref('Start of entry')
const readProgress = ref(0)
const readerAtEnd = ref(false)
const direction = ref('task')
const positions = new Map()
const followStates = new Map()
const lastRead = ref(new Map())
const motions = new Map()
const movingRows = new Set()
const animatedRows = shallowRef(new Set())
const rowMotionTimers = new Map()
const rowMotionLimit = 6
const rowMoveEnabled = ref(false)
const rowMotionReady = ref(false)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const prefersReducedMotion = ref(reducedMotion.matches)
const rowMotionEnabled = computed(() => rowMotionReady.value && following.value && !reader.value && !waiting.value && !prefersReducedMotion.value)
const updateReducedMotion = event => { prefersReducedMotion.value = event.matches }
reducedMotion.addEventListener('change', updateReducedMotion)
let rowMotionFrame
let presentationFrame
let pendingPresentation
let scrollFrame
let scrollRevision = 0
let pinning = false
let resizeObserver
let taskObserver

watch(() => tasks.value.length, length => {
  if (selectedIndex.value >= length) selectTask(0)
})
watch(requestedView, view => {
  pendingPresentation = view
  if (presentationFrame !== undefined) return
  presentationFrame = requestAnimationFrame(() => {
    presentationFrame = undefined
    const next = pendingPresentation
    pendingPresentation = undefined
    if (next?.index === selectedIndex.value && (next.index === presentation.value.index || !next.started || next.ready)) presentation.value = next
  })
}, { flush: 'post' })
watch(() => presentation.value.index, (index, previous) => {
  rememberPosition(previous)
  followStates.set(previous, following.value)
  reader.value = null
  following.value = followStates.get(index) ?? true
  hasNewOutput.value = false
})
watch(viewKey, restorePosition, { flush: 'post', immediate: true })
watch([viewKey, () => presentation.value.ready], (_, previous, onCleanup) => {
  rowMotionReady.value = false
  movingRows.clear()
  let cancelled = false
  onCleanup(() => { cancelled = true; cancelAnimationFrame(rowMotionFrame) })
  if (reader.value || !presentation.value.ready) return
  nextTick(() => {
    if (cancelled) return
    rowMotionFrame = requestAnimationFrame(() => { rowMotionReady.value = true })
  })
}, { immediate: true })
watch([selectedIndex, () => tasks.value.length], positionTaskMarker, { flush: 'post' })
watch(taskList, element => {
  taskObserver?.disconnect()
  if (!element) return
  taskObserver = new ResizeObserver(positionTaskMarker)
  taskObserver.observe(element)
  positionTaskMarker()
}, { flush: 'post' })
watch([rows, rowMotionEnabled], ([next, enabled], [previous, wasEnabled]) => {
  rowMoveEnabled.value = false
  if (!enabled) { clearRowBudget(); return }
  if (!wasEnabled) return
  const before = new Map(previous.map((row, index) => [row.key, { row, index }]))
  const keys = new Set(next.map(row => row.key))
  for (const row of [...next].reverse()) {
    const old = before.get(row.key)?.row
    if (!old || old.status !== row.status || Boolean(old.excerpt) !== Boolean(row.excerpt)) grantRowMotion(row.key)
  }
  for (const row of previous) if (!keys.has(row.key)) grantRowMotion(row.key)
  if (next.length !== previous.length || next.some(row => !before.has(row.key))) return
  const moved = next.filter((row, index) => before.get(row.key).index !== index)
  if (!moved.length || new Set([...animatedRows.value, ...moved.map(row => row.key)]).size > rowMotionLimit) return
  for (const row of moved) grantRowMotion(row.key)
  rowMoveEnabled.value = true
})
watch([rows, () => presentation.value.ready, () => presentation.value.activity], () => {
  if (reader.value) {
    if (readerRow.value?.streaming && readerFollowing.value) scrollToEnd()
    else nextTick(updateReadPosition)
    return
  }
  if (following.value) { scrollToEnd(); return }
  hasNewOutput.value = true
  const bounds = body.value?.getBoundingClientRect()
  const focused = document.activeElement?.closest('[data-subagent-tail-entry]')
  const anchor = focused && body.value?.contains(focused) ? focused
    : [...(body.value?.querySelectorAll('[data-subagent-tail-entry]') || [])]
      .find(element => bounds && element.getBoundingClientRect().top >= bounds.top)
  if (!anchor) return
  const top = anchor.getBoundingClientRect().top
  const key = anchor.dataset.subagentTailEntry
  const revision = scrollRevision
  nextTick(() => {
    if (revision !== scrollRevision || following.value || reader.value || !body.value) return
    const current = body.value.querySelector(`[data-subagent-tail-entry="${CSS.escape(key)}"]`)
    if (!current) return
    pinning = true
    body.value.scrollTop += current.getBoundingClientRect().top - top
    if (focused && !focused.isConnected) current.focus({ preventScroll: true })
    releasePin(revision)
  })
})
watch([tailContent, body], ([element, scroll]) => {
  resizeObserver?.disconnect()
  if (!element || !scroll) return
  resizeObserver = new ResizeObserver(() => {
    if (!reader.value && following.value) scrollToEnd()
    else if (reader.value) updateReadPosition()
  })
  resizeObserver.observe(element)
  resizeObserver.observe(scroll)
}, { flush: 'post' })
onBeforeUnmount(() => {
  scrollRevision++
  cancelAnimationFrame(scrollFrame)
  cancelAnimationFrame(rowMotionFrame)
  cancelAnimationFrame(presentationFrame)
  pendingPresentation = undefined
  ledgerCache.clear()
  clearRowBudget()
  reducedMotion.removeEventListener('change', updateReducedMotion)
  resizeObserver?.disconnect()
  taskObserver?.disconnect()
  movingRows.clear()
  for (const animation of motions.values()) animation.cancel()
})

function resultKey(text, key, rows) {
  const id = selected.value?.childSession?.id || presentation.value.index
  const previous = resultKeys.get(id)
  let next = previous?.text === text ? previous.key : key
  if (next !== key && rows.some(row => row.key === next)) next = key
  resultKeys.set(id, { key: next, text })
  return next
}
function textRow(key, text, state, action) {
  return { key, kind: action === 'Result' || action === 'Output' ? 'result' : key, action, title: subagentLedgerTitle(text) || action, excerpt: subagentLedgerText(text.split(/\r?\n/).slice(1).join('\n')), text, status: state }
}
function grantRowMotion(key) {
  const retained = animatedRows.value.has(key)
  if (!retained && animatedRows.value.size >= rowMotionLimit) return
  clearTimeout(rowMotionTimers.get(key))
  rowMotionTimers.set(key, setTimeout(() => {
    rowMotionTimers.delete(key)
    const next = new Set(animatedRows.value)
    next.delete(key)
    animatedRows.value = next
  }, 360))
  if (!retained) animatedRows.value = new Set([...animatedRows.value, key])
}
function clearRowBudget() {
  for (const timer of rowMotionTimers.values()) clearTimeout(timer)
  rowMotionTimers.clear()
  if (animatedRows.value.size) animatedRows.value = new Set()
}
function prepareRow(element) {
  element.inert = false
  element.removeAttribute('aria-hidden')
  if (rowMotionEnabled.value && animatedRows.value.has(element.dataset.rowKey)) {
    element.dataset.rowMotion = 'true'
    movingRows.add(element)
  } else delete element.dataset.rowMotion
}
function retireRow(element) {
  element.inert = true
  element.setAttribute('aria-hidden', 'true')
  if (rowMotionEnabled.value && animatedRows.value.has(element.dataset.rowKey)) {
    element.dataset.rowMotion = 'true'
    movingRows.add(element)
  } else delete element.dataset.rowMotion
}
function finishRow(element) {
  if (movingRows.delete(element) && following.value && !reader.value) scrollToEnd()
}
function restoreRow(element) {
  finishRow(element)
  element.inert = false
  element.removeAttribute('aria-hidden')
}
function taskStatus(task) { return subagentStatus(task, outcome.value.active) }
function count(value) { return new Intl.NumberFormat().format(value) }
function positionKey(index = presentation.value.index) { return `${index}:${reader.value?.key || 'ledger'}:${reader.value ? format.value : ''}` }
function rememberPosition(index) {
  if (body.value) positions.set(positionKey(index), body.value.scrollTop)
}
function releasePin(revision) {
  cancelAnimationFrame(scrollFrame)
  scrollFrame = requestAnimationFrame(() => { if (revision === scrollRevision) pinning = false })
}
function restorePosition() {
  const revision = ++scrollRevision
  pinning = true
  nextTick(() => {
    if (revision !== scrollRevision || !body.value) return
    const saved = positions.get(positionKey())
    body.value.scrollTop = !reader.value && following.value ? body.value.scrollHeight : saved || 0
    readerFollowing.value = Boolean(reader.value && readerRow.value?.streaming && body.value.scrollHeight <= body.value.clientHeight)
    updateReadPosition()
    releasePin(revision)
  })
}
function scrollToEnd() {
  const revision = ++scrollRevision
  pinning = true
  nextTick(() => {
    if (revision !== scrollRevision || !body.value) return
    body.value.scrollTop = body.value.scrollHeight
    hasNewOutput.value = false
    updateReadPosition()
    releasePin(revision)
  })
}
function pauseFollowing() {
  scrollRevision++
  cancelAnimationFrame(scrollFrame)
  pinning = false
  if (reader.value) readerFollowing.value = false
  else following.value = false
}
function handleScroll() {
  updateReadPosition()
  if (pinning || !body.value || (following.value && movingRows.size)) return
  const atEnd = body.value.scrollHeight - body.value.clientHeight - body.value.scrollTop < 24
  if (reader.value) readerFollowing.value = atEnd
  else { following.value = atEnd; if (atEnd) hasNewOutput.value = false }
  rememberPosition()
}
function updateReadPosition() {
  if (!reader.value || !body.value) return
  const max = body.value.scrollHeight - body.value.clientHeight
  readProgress.value = max > 0 ? Math.min(100, body.value.scrollTop / max * 100) : 100
  readerAtEnd.value = max - body.value.scrollTop < 3
  readPosition.value = max < 2 ? 'Entire entry visible' : body.value.scrollTop < 2 ? 'Start of entry'
    : readerAtEnd.value ? 'End of entry' : `${Math.round(readProgress.value)}% through this entry`
}
function selectTask(index) {
  if (index === selectedIndex.value) return
  direction.value = 'task'
  selectedIndex.value = index
}
function openEntry(row) {
  rememberPosition()
  direction.value = 'forward'
  reader.value = row
  format.value = row.kind === 'tool' || ['prompt', 'call', 'error'].includes(row.kind) ? 'raw' : 'formatted'
  lastRead.value = new Map(lastRead.value).set(presentation.value.index, row.key)
  nextTick(() => body.value?.focus({ preventScroll: true }))
}
function backToLedger() {
  rememberPosition()
  direction.value = 'back'
  const key = reader.value?.key
  reader.value = null
  nextTick(() => {
    const target = key === 'prompt' ? pane.value?.querySelector('.subagent-inspector-prompt')
      : body.value?.querySelector(`[data-subagent-tail-entry="${CSS.escape(key || '')}"]`)
    ;(target || body.value)?.focus({ preventScroll: true })
  })
}
function dismissReader() {
  if (!reader.value) return false
  backToLedger()
  return true
}
function changeFormat(value) {
  if (format.value === value) return
  rememberPosition()
  format.value = value
  restorePosition()
}
function jump() {
  if (!body.value) return
  body.value.scrollTop = readerAtEnd.value ? 0 : body.value.scrollHeight
  updateReadPosition()
}
function jumpToLatest() {
  if (reader.value) { rememberPosition(); reader.value = null; direction.value = 'back' }
  following.value = true
  scrollToEnd()
}
function openPrompt() {
  if (selected.value?.task) openEntry({ key: 'prompt', kind: 'prompt', action: 'Task prompt', title: 'Full task prompt', text: selected.value.task, status: 'saved' })
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
function positionTaskMarker() {
  const task = taskList.value?.querySelector('[aria-pressed="true"]')
  if (!task || !taskMarker.value) return
  Object.assign(taskMarker.value.style, { transform: `translateY(${task.offsetTop}px)`, left: `${task.offsetLeft}px`, width: `${task.offsetWidth}px`, height: `${task.offsetHeight}px` })
  hasTaskMarker.value = true
}
function prepareEnter(element) {
  element.dataset.motion = direction.value
  element.style.opacity = '0'
  element.style.transform = direction.value === 'task' ? 'translateY(8px)' : `translateX(${direction.value === 'back' ? -14 : 14}px)`
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
  const content = element.classList.contains('subagent-inspector-content')
  if (!entering) { element.inert = true; element.setAttribute('aria-hidden', 'true') }
  else { element.inert = waiting.value; if (!waiting.value) element.removeAttribute('aria-hidden') }
  interruptMotion(element)
  const style = getComputedStyle(element)
  const exit = direction.value === 'task' ? 'translateY(-4px)' : `translateX(${direction.value === 'back' ? 5 : -5}px)`
  const animation = element.animate([
    { opacity: style.opacity, transform: style.transform },
    { opacity: entering ? 1 : 0, transform: entering ? 'translate(0,0)' : exit },
  ], {
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : content && entering ? 420 : 250,
    easing: entering ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.2,0,0,1)', fill: 'both',
  })
  motions.set(element, animation)
  animation.finished.then(() => {
    if (motions.get(element) !== animation) return
    motions.delete(element)
    if (entering) { element.style.opacity = ''; element.style.transform = '' }
    done()
    animation.cancel()
  }).catch(() => {})
}

defineExpose({ element: pane, dismissReader })
</script>

<template>
  <section id="subagent-inspector" ref="pane" class="subagent-inspector" role="dialog" aria-modal="true" aria-labelledby="subagent-inspector-title" tabindex="-1" @keydown.esc.stop.prevent="dismissReader() || emit('close')">
    <div class="subagent-inspector-context" tabindex="0" aria-label="Task details">
      <header class="subagent-inspector-header">
        <div class="subagent-inspector-heading"><p>{{ entry.researchThreads ? 'Research threads' : 'Subagent' }}<span v-if="selected?.agent" class="subagent-inspector-agent"> · {{ selected.agent }}</span></p><h2 id="subagent-inspector-title">{{ title }}</h2></div>
        <div class="subagent-inspector-actions">
          <button class="subagent-inspector-icon-button" type="button" :title="copiedEntryId === entry.id ? 'Copied' : 'Copy tool output'" aria-label="Copy tool output" @click="emit('copy-entry', entry)"><CopyIcon :copied="copiedEntryId === entry.id" /></button>
          <button class="subagent-inspector-icon-button" type="button" aria-label="Close subagent inspector" @click="emit('close')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
        </div>
        <button v-if="selected?.task" class="subagent-inspector-prompt" type="button" @click="openPrompt">Full task prompt <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg></button>
        <div v-if="tasks.length !== 1 && outcome.counts.length" class="subagent-summary" aria-label="Task outcomes" aria-live="polite"><span v-for="item in outcome.counts" :key="item.status" :class="`status-${item.status}`">{{ item.text }}</span></div>
      </header>
      <nav v-if="tasks.length > 1" ref="taskList" class="subagent-inspector-tasks" :class="{ 'has-selection-marker': hasTaskMarker }" aria-label="Subagent tasks">
        <span ref="taskMarker" class="subagent-inspector-task-marker" :hidden="!hasTaskMarker" aria-hidden="true"></span>
        <button v-for="(task, index) in tasks" :key="index" class="subagent-inspector-task" type="button" :aria-pressed="selectedIndex === index" :title="subagentTaskTitle(task, index)" @click="selectTask(index)">
          <span class="subagent-inspector-index">{{ index + 1 }}</span><span class="subagent-inspector-task-label">{{ subagentTaskTitle(task, index) }}</span><span class="subagent-task-status" :class="`status-${taskStatus(task)}`">{{ subagentStatuses[taskStatus(task)].label }}</span>
        </button>
      </nav>
      <div class="subagent-inspector-meta">
        <span v-if="modelChips.model" class="subagent-inspector-model" :title="modelChips.model.title || undefined"><span>Model</span><code>{{ modelChips.model.code }}</code><span v-if="modelChips.model.source" class="subagent-inspector-model-source">· {{ modelChips.model.source }}</span></span><span v-if="modelChips.thinking" class="subagent-inspector-thinking"><span>Thinking</span><code>{{ modelChips.thinking.level }}</code></span><span v-if="selected?.research">{{ selected.research.sources?.length || 0 }} sources</span><span class="subagent-task-status" :class="`status-${status}`" aria-label="Task status" aria-live="polite">{{ subagentStatuses[status].label }}</span>
      </div>
    </div>
    <div class="subagent-inspector-reader-stack" :aria-busy="waiting">
      <Transition :css="false" @before-enter="prepareEnter" @enter="(element, done) => animateContent(element, done, true)" @leave="(element, done) => animateContent(element, done, false)" @enter-cancelled="interruptMotion" @leave-cancelled="interruptMotion">
        <div :key="viewKey" class="subagent-inspector-content" :inert="waiting" :aria-hidden="waiting || undefined" :data-file-session-id="selected?.childSession?.id">
          <template v-if="readerRow">
            <div class="subagent-entry-nav"><button class="subagent-entry-back" type="button" @click="backToLedger"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14 8H2m5-5L2 8l5 5" /></svg>Back to activity</button><span>{{ count(readerText.length) }} chars · {{ count(readerText.split('\n').length) }} lines</span></div>
            <div class="subagent-entry-sections">
              <header class="subagent-entry-header">
                <h3 class="subagent-entry-title">{{ readerRow.title }}</h3><div class="subagent-entry-meta"><span>{{ readerRow.action }}</span><span v-if="readerRow.timestamp">{{ new Date(readerRow.timestamp).toLocaleTimeString() }}</span><span :class="`status-${readerRow.status}`">{{ readerRow.streaming ? 'Live' : ({ completed: 'Done', error: 'Failed', stopped: 'Stopped', unknown: 'Unknown' })[readerRow.status] || 'Saved' }}</span></div>
              </header>
              <nav class="subagent-entry-formats" aria-label="Content format"><button v-for="item in formats" :key="item.value" type="button" :aria-pressed="format === item.value" :disabled="item.disabled" :title="item.disabled ? 'Arguments were not recorded for this call' : undefined" @click="changeFormat(item.value)">{{ item.label }}</button><button class="subagent-entry-copy" type="button" @click="emit('copy', copyId, readerText)">{{ copiedEntryId === copyId ? 'Copied' : 'Copy full text' }}</button></nav>
              <div ref="body" class="subagent-entry-scroll" tabindex="0" aria-label="Full entry content" @scroll="handleScroll" @wheel.passive="$event.deltaY < 0 && pauseFollowing()" @touchmove.passive="pauseFollowing" @pointerdown="contentPointerDown" @keydown="['ArrowUp', 'PageUp', 'Home'].includes($event.key) && pauseFollowing()" @click="openImage">
                <img v-if="readerImage && format !== 'args'" class="subagent-entry-image" :src="readerImage" alt="Subagent image">
                <div v-if="format === 'formatted'" class="subagent-inspector-output markdown-body" v-html="readerHtml"></div><pre v-else class="subagent-entry-raw">{{ readerText || (readerRow.streaming ? 'Waiting for output…' : 'No text output.') }}</pre>
                <p class="subagent-entry-end">{{ readerRow.streaming ? 'This entry is still updating.' : 'End of entry. Full text retained.' }}</p>
              </div>
              <div class="subagent-entry-position" :style="{ '--read-progress': `${readProgress}%` }"><span>{{ readPosition }}</span><button type="button" @click="jump">{{ readerAtEnd ? 'Back to top' : 'Jump to end' }}</button></div>
            </div>
          </template>
          <div v-else class="subagent-ledger-overview">
            <div class="subagent-ledger-summary" tabindex="0" aria-label="Latest activity">
              <section v-if="latest" class="subagent-ledger-latest"><div class="subagent-ledger-latest-heading"><span><span class="subagent-ledger-latest-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path :d="latest.kind === 'thought' ? 'M3 11a5.5 5.5 0 1 1 3 2L2 14l1-3ZM5.5 7.5h.1m2.4 0h.1m2.4 0h.1' : 'M2 2.5h12v8H7l-3.5 3v-3H2z'" /></svg></span>{{ latest.kind === 'thought' ? 'Latest thought' : 'Latest response' }}</span><button type="button" @click="openEntry(latest)">Read full · {{ count(latest.text.length) }} chars</button></div><h3>{{ latest.title }}</h3><p v-if="latest.excerpt">{{ latest.excerpt }}</p></section>
              <div v-if="presentation.error || presentation.connection === 'reconnecting'" class="subagent-inspector-notice" role="status"><span>{{ presentation.error ? 'Child activity could not be loaded.' : 'Reconnecting. Showing the last received activity.' }}</span><button v-if="presentation.error" type="button" @click="preview.refresh">Retry</button></div>
            </div>
            <div class="subagent-ledger-labels"><span class="subagent-ledger-activity-label">Activity</span><span>{{ rows.length }} entries · {{ callCount }} calls</span><span v-if="presentation.connection" class="subagent-ledger-connection" :class="{ 'is-live': presentation.connection === 'live' }" role="status">{{ previewLabel }}</span><span v-else class="subagent-ledger-read-hint">Select a row to read</span></div>
            <div ref="body" class="subagent-ledger-scroll" tabindex="0" aria-label="Child session activity" @scroll="handleScroll" @wheel.passive="$event.deltaY < 0 && pauseFollowing()" @touchmove.passive="pauseFollowing" @pointerdown="contentPointerDown" @keydown="['ArrowUp', 'PageUp', 'Home'].includes($event.key) && pauseFollowing()">
              <div ref="tailContent" class="subagent-ledger-rows" :class="{ 'has-row-motion': rowMotionEnabled }">
                <TransitionGroup name="subagent-row" :move-class="rowMoveEnabled ? 'subagent-row-move' : 'subagent-row-static'" :css="rowMotionEnabled" @before-enter="prepareRow" @after-enter="finishRow" @enter-cancelled="finishRow" @before-leave="retireRow" @after-leave="finishRow" @leave-cancelled="restoreRow">
                  <SubagentTailEntry v-for="row in rows" :key="row.key" :row="row" :animate="rowMotionEnabled && animatedRows.has(row.key)" :selected="lastRead.get(presentation.index) === row.key" @open="openEntry" />
                </TransitionGroup>
                <p v-if="presentation.started && !presentation.ready" class="subagent-tail-activity" role="status"><span class="live-tool-spinner" aria-hidden="true"></span>Loading child activity…</p>
                <p v-else-if="presentation.activity && !rows.some(row => row.streaming)" class="subagent-tail-activity" role="status"><span class="live-tool-spinner" aria-hidden="true"></span>{{ presentation.compacting ? 'Compacting context…' : presentation.activity }}</p>
                <p v-else-if="!rows.length" class="subagent-inspector-empty">{{ selected ? subagentEmptyText(status) : fallback.status === 'running' ? 'Waiting for task updates.' : 'Individual task details are unavailable.' }}</p>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
    <footer class="subagent-inspector-footer has-motion-footer">
      <Transition :css="false" @before-enter="prepareEnter" @enter="(element, done) => animateContent(element, done, true)" @leave="(element, done) => animateContent(element, done, false)" @enter-cancelled="interruptMotion" @leave-cancelled="interruptMotion">
        <div :key="`${presentation.index}:${waiting}:${Boolean(reader)}`" class="subagent-inspector-footer-content">
          <button v-if="selected?.childSession" class="subagent-inspector-session" type="button" :disabled="waiting" @click="emit('navigate-child-session', selected.childSession, $event)" @auxclick.middle.prevent="emit('navigate-child-session', selected.childSession, $event)">Open child session <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4h7v7M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg></button><span v-else>{{ ['running', 'queued', 'not-started'].includes(status) ? 'No child session yet' : 'Child session unavailable' }}</span>
          <span v-if="waiting" class="subagent-tail-following" role="status">Preparing preview…</span><span v-else-if="reader" class="subagent-tail-following">{{ readerRow?.streaming ? 'Reading live content' : 'Reading saved content' }}</span><button v-else-if="!following" class="subagent-tail-jump" type="button" @click="jumpToLatest">{{ hasNewOutput ? 'New output' : 'Jump to latest' }}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6" /></svg></button><span v-else class="subagent-tail-following">{{ status === 'running' ? 'Following live' : 'Latest recorded activity' }}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6" /></svg></span>
        </div>
      </Transition>
    </footer>
  </section>
</template>
