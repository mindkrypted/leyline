<script setup>
import { computed } from 'vue'
import { activitySummary } from '../../lib/tool-activity.js'

const props = defineProps({
  group: { type: Object, required: true },
  expanded: Boolean,
})
const emit = defineEmits(['toggle'])

const summary = computed(() => activitySummary(props.group.items))
const statusLabel = computed(() => [
  ...(summary.value.busy ? ['running'] : []),
  ...summary.value.outcomes.map(outcome => outcome.text),
].join(' · ') || 'Completed')
const visibleItems = computed(() => (props.expanded ? props.group.items : props.group.items.slice(-1)))
const label = computed(() => {
  const count = props.group.items.length
  return `${count} tool ${count === 1 ? 'call' : 'calls'}`
})
</script>

<template>
  <section class="mobile-activity-card" :class="{ 'is-expanded': expanded }">
    <button class="mobile-activity-summary" type="button" :aria-expanded="expanded" @click="emit('toggle', group)">
      <span class="mobile-activity-heading">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 4.5-9 4.5-9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" /></svg>
        <strong>{{ label }}</strong>
        <span class="mobile-activity-state" :title="statusLabel" :aria-label="statusLabel">
          <span v-if="summary.busy" class="mobile-activity-spinner" aria-hidden="true"></span>
          <span v-if="summary.outcomes.length" class="mobile-activity-outcomes">
            <span v-for="outcome in summary.outcomes" :key="outcome.status" :class="`status-${outcome.status}`">{{ outcome.text }}</span>
          </span>
          <span v-else-if="summary.busy" class="mobile-activity-live">running</span>
          <span v-else class="mobile-activity-check" aria-hidden="true">✓</span>
        </span>
        <span class="mobile-activity-chevron" aria-hidden="true">›</span>
      </span>
      <span class="mobile-activity-breakdown"><span v-for="operation in group.operations" :key="operation">{{ operation }}</span></span>
    </button>
    <div class="mobile-activity-list" :class="{ 'is-tail': !expanded }"><slot :items="visibleItems" /></div>
  </section>
</template>
