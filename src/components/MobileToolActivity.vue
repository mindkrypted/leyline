<script setup>
import { computed } from 'vue'
import { activityStatus } from '../../lib/tool-activity.js'

const props = defineProps({
  group: { type: Object, required: true },
  expanded: Boolean,
})
const emit = defineEmits(['toggle'])

const busy = computed(() => props.group.items.some((item) => {
  const status = activityStatus(item)
  return status === 'preparing' || status === 'running' || status === 'reading result'
}))
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
        <span v-if="busy" class="mobile-activity-live"><span class="mobile-activity-spinner" aria-hidden="true"></span>running</span>
        <span v-else class="mobile-activity-check" aria-label="Completed">✓</span>
        <span class="mobile-activity-chevron" aria-hidden="true">›</span>
      </span>
      <span class="mobile-activity-breakdown"><span v-for="operation in group.operations" :key="operation">{{ operation }}</span></span>
    </button>
    <div class="mobile-activity-list" :class="{ 'is-tail': !expanded }"><slot :items="visibleItems" /></div>
  </section>
</template>
