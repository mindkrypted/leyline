<script setup>
defineProps({
  group: { type: Object, required: true },
  expanded: Boolean,
})
const emit = defineEmits(['toggle'])
</script>

<template>
  <section class="mobile-activity-card" :class="{ 'is-expanded': expanded }">
    <button class="mobile-activity-summary" type="button" :aria-expanded="expanded" @click="emit('toggle', group)">
      <span class="mobile-activity-heading"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 4.5-9 4.5-9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" /></svg><strong>{{ group.items.length }} tool calls</strong><span class="mobile-activity-check" aria-label="Completed">✓</span><span class="mobile-activity-chevron" aria-hidden="true">›</span></span>
      <span class="mobile-activity-breakdown"><span v-for="operation in group.operations" :key="operation">{{ operation }}</span></span>
    </button>
    <div v-if="expanded" class="mobile-activity-list"><slot /></div>
  </section>
</template>
