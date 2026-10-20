<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { activityEntry, activityOperations, activityStatus, activitySummary, toolStatusTone } from '../../lib/tool-activity.js'
import { messageBlocksFor, renderedBlock } from '../lib/transcript'

const props = defineProps({
  item: { type: Object, required: true },
  following: { type: Boolean, default: true },
  views: { type: Map, default: () => new Map() },
})
const calls = computed(() => props.item.type === 'tool-activity' ? props.item.items : [])
const entry = computed(() => activityEntry(props.item))
const blocks = computed(() => messageBlocksFor(entry.value).map(block => ({
  ...block,
  html: block.type === 'text' ? renderedBlock(block, { streaming: props.item.streaming === true }) : '',
})))
const summary = computed(() => activitySummary(calls.value))
const groupView = computed(() => {
  const key = `group:${props.item.id}`
  if (props.views.has(key)) return props.views.get(key)
  const source = props.views.get(`group:${props.item.sourceGroupId}`)
  return view(key, { open: source?.open || false, manual: source?.manual || false })
})
const expandedThoughts = ref(new Set())

watch([calls, () => props.following], ([items, following]) => {
  if (!items.length) return
  for (const item of items) {
    const state = toolView(item)
    const tone = toolStatusTone(activityStatus(item))
    if (following && tone === 'completed' && !state.manual) state.open = false
    if (state.seen) continue
    state.seen = true
    if (tone !== 'running') continue
    state.open = true
    groupView.value.open = true
  }
  if (following && !groupView.value.manual && items.every(item => toolStatusTone(activityStatus(item)) === 'completed')) groupView.value.open = false
}, { immediate: true })

function toolKey(item) {
  return item.toolCallId || activityEntry(item).toolCallId || item.id
}

function view(key, initial) {
  if (!props.views.has(key)) props.views.set(key, reactive(initial))
  return props.views.get(key)
}

function toolView(item) {
  return view(`tool:${toolKey(item)}`, { open: false, manual: false, seen: false })
}

function toggleGroup(event) {
  if (event.target.isConnected) groupView.value.open = event.target.open
}

function toggleTool(item, event) {
  if (event.target.isConnected) toolView(item).open = event.target.open
}

function markTool(item) {
  const state = toolView(item)
  state.manual = !state.open
}

function toggleThought(index, event) {
  if (!event.target.isConnected) return
  const next = new Set(expandedThoughts.value)
  if (event.target.open) next.add(index)
  else next.delete(index)
  expandedThoughts.value = next
}

function toolOutput(item) {
  const value = activityEntry(item)
  const text = value.preview?.fallbackText || value.text || ''
  const lines = text.slice(-8000).split(/\r?\n/)
  return {
    text: lines.slice(-14).join('\n'),
    clipped: text.length > 8000 || lines.length > 14,
    image: value.preview?.kind === 'image',
  }
}
</script>

<template>
  <details
    v-if="calls.length"
    class="subagent-tail-tools"
    :class="{ 'is-single': calls.length === 1 }"
    :open="calls.length === 1 || groupView.open"
    @toggle.self="toggleGroup"
  >
    <summary v-show="calls.length > 1" class="subagent-tail-group-summary" @click="groupView.manual = !groupView.open">
      <span class="subagent-tail-chevron" aria-hidden="true">›</span>
      <span>{{ activityOperations(calls).join(' · ') }}</span>
      <span class="subagent-tail-group-outcomes">
        <span v-for="outcome in summary.outcomes" :key="outcome.status" :class="`status-${outcome.status}`">{{ outcome.text }}</span>
      </span>
    </summary>
    <div class="subagent-tail-tool-list">
      <details
        v-for="call in calls"
        :key="toolKey(call)"
        class="subagent-tail-tool"
        :data-subagent-tail-entry="`tool:${toolKey(call)}`"
        :class="`status-${toolStatusTone(activityStatus(call))}`"
        :open="toolView(call).open"
        @toggle.self="toggleTool(call, $event)"
      >
        <summary @click="markTool(call)">
          <span class="subagent-tail-chevron" aria-hidden="true">›</span>
          <span>{{ activityEntry(call).label || activityEntry(call).toolName }}</span>
          <code v-if="!toolView(call).open" class="subagent-tail-target">{{ activityEntry(call).code }}</code>
          <span class="subagent-tail-tool-status" :class="`status-${toolStatusTone(activityStatus(call))}`">
            <span v-if="toolStatusTone(activityStatus(call)) === 'running'" class="live-tool-spinner" aria-hidden="true"></span>
            <svg v-else-if="toolStatusTone(activityStatus(call)) === 'completed'" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>
            {{ activityStatus(call) === 'reading result' ? 'Finishing' : activityStatus(call) }}
          </span>
        </summary>
        <template v-if="toolView(call).open">
          <pre v-if="activityEntry(call).code" class="subagent-tail-command">{{ activityEntry(call).code }}</pre>
          <div class="subagent-tail-tool-output">
            <span v-if="toolOutput(call).clipped" class="subagent-tail-clipped">Last 14 lines. Full output is in the child session.</span>
            <pre v-if="toolOutput(call).text">{{ toolOutput(call).text }}</pre>
            <p v-else-if="toolOutput(call).image">Image result. Open the child session to view it.</p>
            <p v-else>{{ toolStatusTone(activityStatus(call)) === 'running' ? 'Waiting for tool output…' : 'No text output.' }}</p>
          </div>
        </template>
      </details>
    </div>
  </details>
  <article v-else class="subagent-tail-message" :data-subagent-tail-entry="`message:${item.id}`">
    <div class="subagent-tail-message-meta"><span>Agent</span><span v-if="item.streaming" class="subagent-tail-writing">Writing</span></div>
    <template v-for="(block, index) in blocks" :key="index">
      <details
        v-if="block.type === 'thinking'"
        class="subagent-tail-thought"
        :open="expandedThoughts.has(index)"
        @toggle.self="toggleThought(index, $event)"
      >
        <summary><span class="subagent-tail-chevron" aria-hidden="true">›</span>{{ item.streaming ? 'Thinking' : 'Thought' }}</summary>
        <pre v-if="expandedThoughts.has(index)">{{ block.text }}</pre>
      </details>
      <div v-else-if="block.type === 'text'" class="subagent-inspector-output markdown-body" v-html="block.html"></div>
      <p v-else-if="block.type === 'image'" class="subagent-tail-image-note">Image output is available in the child session.</p>
    </template>
  </article>
</template>
