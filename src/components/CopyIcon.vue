<script setup>
defineProps({ copied: Boolean })
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path v-if="copied" d="m5 12 4 4L19 6" />
    <template v-else>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </template>
  </svg>
</template>
