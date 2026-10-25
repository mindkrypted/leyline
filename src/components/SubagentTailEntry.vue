<script setup>
import { computed } from 'vue'

const props = defineProps({
  row: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  animate: { type: Boolean, default: false },
})
const emit = defineEmits(['open'])
const label = computed(() => ({ running: props.row.kind === 'thought' ? 'Thinking' : 'Running', completed: 'Done', error: 'Failed', stopped: 'Stopped', unknown: 'Unknown', saved: 'Saved' }[props.row.status] || 'Saved'))
const size = computed(() => props.row.text.length >= 1000 ? `${(props.row.text.length / 1000).toFixed(1)}k` : props.row.text.length)
const icon = computed(() => {
  if (props.row.kind === 'thought') return 'M3 11a5.5 5.5 0 1 1 3 2L2 14l1-3ZM5.5 7.5h.1m2.4 0h.1m2.4 0h.1'
  if (props.row.action === 'Search') return 'M10.5 6.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm0 4 3.5 3.5'
  if (props.row.action === 'Fetch') return 'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0ZM2 8h12M8 2c-4 3-4 9 0 12 4-3 4-9 0-12Z'
  if (props.row.action === 'Run') return 'm2 4 4 4-4 4m6 0h6'
  if (['Edit', 'Write'].includes(props.row.action)) return 'm10.5 2.5 3 3M3 10l8.5-8.5 3 3L6 13l-4 1z'
  if (props.row.kind === 'image') return 'M2 2h12v12H2Zm0 10 4-4 3 3 2-2 3 3M10 5h.1'
  return 'M4 1.5h5l3 3v10H4zM9 1.5v3h3M6 8h4m-4 3h4'
})
</script>

<template>
  <div class="subagent-ledger-row-slot" :data-row-key="row.key" :data-row-motion="animate || undefined">
    <div class="subagent-ledger-row-clip">
      <button class="subagent-ledger-row" type="button" :data-subagent-tail-entry="row.key" :data-last-read="selected || undefined" :title="row.title" @click="emit('open', row)">
        <span class="subagent-ledger-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path :d="icon" /></svg></span>
        <span class="subagent-ledger-body"><span class="subagent-ledger-line"><span class="subagent-ledger-action">{{ row.action }}</span><span class="subagent-ledger-target">{{ row.title }}</span></span><Transition name="subagent-excerpt" :css="animate"><span v-if="row.excerpt" class="subagent-ledger-excerpt">{{ row.excerpt }}</span></Transition></span>
        <span class="subagent-ledger-outcome"><span class="subagent-ledger-status-stack"><Transition name="subagent-status" :css="animate" @before-enter="$event.removeAttribute('aria-hidden')" @before-leave="$event.setAttribute('aria-hidden', 'true')" @leave-cancelled="$event.removeAttribute('aria-hidden')"><span :key="row.status" class="subagent-ledger-status" :class="`status-${row.status}`"><span v-if="row.status === 'running'" class="live-tool-spinner" aria-hidden="true"></span><svg v-else-if="row.status === 'completed'" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>{{ label }}</span></Transition></span><span class="subagent-ledger-size">{{ size }} chars</span></span>
      </button>
    </div>
  </div>
</template>
