<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { sourceDate, sourceLocation } from '../lib/format'

const props = defineProps({
  anchorRect: {
    type: Object,
    default: null,
  },
  source: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['close'])
const preview = ref(null)
const placement = ref('below')
const position = ref({})
const distinctEvidence = computed(() => {
  return props.source.evidence === props.source.claim
    ? ''
    : props.source.evidence || ''
})

onMounted(async () => {
  await positionPreview()
  window.addEventListener('pointerdown', closeFromOutside, true)
  window.addEventListener('resize', closeFromViewportChange)
  window.addEventListener('scroll', closeFromViewportChange, true)
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', closeFromOutside, true)
  window.removeEventListener('resize', closeFromViewportChange)
  window.removeEventListener('scroll', closeFromViewportChange, true)
})

async function positionPreview() {
  await nextTick()
  const element = preview.value
  if (!element) return
  if (window.innerWidth <= 760) {
    placement.value = 'sheet'
    position.value = {
      bottom: '10px',
      left: '10px',
      top: 'auto',
    }
    return
  }

  const margin = 14
  const gap = 10
  const rect = props.anchorRect || {
    bottom: window.innerHeight / 2,
    height: 0,
    left: window.innerWidth / 2,
    top: window.innerHeight / 2,
    width: 0,
  }
  const width = element.offsetWidth
  const height = element.offsetHeight
  const anchorCenter = rect.left + rect.width / 2
  const left = Math.min(
    Math.max(margin, rect.left),
    window.innerWidth - width - margin,
  )
  let top = rect.bottom + gap
  placement.value = 'below'
  if (top + height > window.innerHeight - margin) {
    const above = rect.top - height - gap
    if (above >= margin) {
      top = above
      placement.value = 'above'
    } else {
      top = Math.max(margin, window.innerHeight - height - margin)
    }
  }
  const arrowLeft = Math.min(
    Math.max(18, anchorCenter - left - 5),
    width - 28,
  )
  position.value = {
    '--citation-preview-arrow-left': `${arrowLeft}px`,
    left: `${left}px`,
    top: `${top}px`,
  }
}

function closeFromOutside(event) {
  if (preview.value?.contains(event.target)) return
  emit('close')
}

function closeFromViewportChange(event) {
  if (event.type === 'scroll' && event.target instanceof Element
    && preview.value?.contains(event.target)) return
  emit('close')
}
</script>

<template>
  <section
    ref="preview"
    class="research-citation-preview"
    :class="`is-${placement}`"
    :style="position"
    role="dialog"
    aria-modal="false"
    :aria-label="`Citation ${source.id} source preview`"
  >
    <header class="research-citation-preview-head">
      <b>{{ source.id }}</b>
      <span>
        {{ sourceLocation(source) }}
        <template v-if="sourceDate(source)"> · {{ sourceDate(source) }}</template>
      </span>
      <button type="button" aria-label="Close source preview" @click="emit('close')">
        ×
      </button>
    </header>
    <div class="research-citation-preview-body">
      <strong>{{ source.title }}</strong>
      <p v-if="source.claim" class="research-citation-preview-claim"><span class="research-citation-preview-field-label">Claim</span>{{ source.claim }}</p>
      <p v-if="distinctEvidence" class="research-citation-preview-evidence"><span class="research-citation-preview-field-label">Evidence</span>{{ distinctEvidence }}</p>
      <p v-if="source.exclusionReason" class="research-citation-preview-exclusion"><span class="research-citation-preview-field-label">Exclusion reason</span>{{ source.exclusionReason }}</p>
      <code v-if="source.path">{{ source.path }}</code>
      <a
        v-if="source.url"
        :href="source.url"
        target="_blank"
        rel="noopener noreferrer"
        @click="emit('close')"
      >Open source ↗</a>
      <a v-else-if="source.path" href="#" :data-local-file="encodeURIComponent(source.path)">Preview file</a>
    </div>
  </section>
</template>
