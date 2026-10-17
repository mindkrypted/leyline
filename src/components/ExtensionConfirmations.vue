<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { replyPiExtensionConfirmation } from '../lib/pi-api'

const props = defineProps({
  sessionId: { type: String, required: true },
  requests: { type: Array, required: true },
  notices: { type: Array, default: () => [] },
  disabled: Boolean,
})
const emit = defineEmits(['resize'])
const panel = ref(null)
const replies = ref({})
const dismissedNotices = ref(new Set())
const visibleNotices = computed(() => props.notices.filter((notice) => {
  return !dismissedNotices.value.has(notice.id)
}))
const visible = computed(() => props.requests.length > 0 || visibleNotices.value.length > 0)
let observer

watch(() => props.sessionId, () => {
  replies.value = {}
  dismissedNotices.value = new Set()
}, { flush: 'sync' })

watch(() => props.requests, (requests) => {
  const ids = new Set(requests.map((request) => request.id))
  for (const id of Object.keys(replies.value)) {
    if (!ids.has(id)) delete replies.value[id]
  }
})

function measurePanel() {
  emit('resize', visible.value ? Math.ceil(panel.value?.getBoundingClientRect().height || 0) : 0)
}

watch(visible, measurePanel, { flush: 'post' })

onMounted(() => {
  observer = new ResizeObserver(measurePanel)
  observer.observe(panel.value)
  measurePanel()
})

onUnmounted(() => {
  observer?.disconnect()
  emit('resize', 0)
})

async function reply(request, confirmed) {
  if (props.disabled || replies.value[request.id]?.busy) return
  const sessionId = props.sessionId
  replies.value[request.id] = { busy: true, error: '' }
  const replyState = replies.value[request.id]
  try {
    await replyPiExtensionConfirmation(sessionId, request.id, confirmed)
  } catch (error) {
    if (props.sessionId !== sessionId || replies.value[request.id] !== replyState
      || !props.requests.some((item) => item.id === request.id)) return
    replies.value[request.id] = { busy: false, error: error.message }
  }
}
</script>

<template>
  <section v-show="visible" ref="panel" class="extension-confirmations" aria-label="Extension confirmations">
    <p v-if="requests.length" class="confirmation-summary" role="status">
      {{ requests.length === 1 ? 'Confirmation required' : `${requests.length} confirmations required` }}
      <span v-if="disabled"> · Waiting for connection</span>
    </p>
    <section
      v-for="request in requests"
      :key="request.id"
      class="confirmation-card"
      :aria-labelledby="`confirmation-title-${request.id}`"
      :aria-describedby="`confirmation-message-${request.id}`"
      :aria-busy="Boolean(replies[request.id]?.busy)"
    >
      <h3 :id="`confirmation-title-${request.id}`">{{ request.title }}</h3>
      <p v-if="request.expiresAt != null" class="confirmation-deadline">
        Deadline <time :datetime="new Date(request.expiresAt).toISOString()">{{ new Date(request.expiresAt).toISOString() }}</time>
      </p>
      <p :id="`confirmation-message-${request.id}`" class="confirmation-message">{{ request.message }}</p>
      <p v-if="replies[request.id]?.error" class="confirmation-error" role="alert">
        {{ replies[request.id].error }}
      </p>
      <div class="confirmation-actions">
        <button
          type="button"
          :disabled="disabled || replies[request.id]?.busy"
          @click="reply(request, false)"
        >Cancel</button>
        <button
          type="button"
          class="confirmation-approve"
          :disabled="disabled || replies[request.id]?.busy"
          @click="reply(request, true)"
        >Confirm</button>
      </div>
    </section>
    <div v-for="notice in visibleNotices" :key="notice.id" class="confirmation-notice">
      <p role="status">{{ notice.message }}</p>
      <button type="button" @click="dismissedNotices.add(notice.id)">Dismiss</button>
    </div>
  </section>
</template>

<style scoped>
.extension-confirmations {
  --confirmation-gap: 34px;
  position: absolute;
  z-index: 6;
  bottom: calc(var(--composer-height) + var(--confirmation-gap));
  left: 50%;
  width: min(var(--content-max), calc(100% - 88px));
  max-height: min(320px, var(--confirmation-max-height, 38vh));
  max-height: min(320px, var(--confirmation-max-height, 38dvh));
  overflow: auto;
  transform: translateX(-50%);
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel-soft);
  padding: 12px 14px;
  color: var(--text);
  font-size: 12px;
  overscroll-behavior: contain;
}

:global(.terminal-open) .extension-confirmations {
  bottom: calc(var(--terminal-drawer-height) + var(--composer-height) + var(--confirmation-gap));
}

.confirmation-summary {
  margin: 0 0 8px;
  color: var(--muted-strong);
  font-size: 11px;
}

.confirmation-card + .confirmation-card {
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.confirmation-message {
  margin: 6px 0 10px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.confirmation-deadline {
  color: var(--muted-strong);
  overflow-wrap: anywhere;
}

.confirmation-notice {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.confirmation-card + .confirmation-notice,
.confirmation-notice + .confirmation-notice {
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.confirmation-notice p {
  flex: 1;
  min-width: 0;
  margin: 0;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.confirmation-notice button {
  flex-shrink: 0;
}

.confirmation-error {
  color: #d99a9a;
}

.confirmation-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

button {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
  padding: 6px 12px;
  color: var(--text);
  font-size: 12px;
}

.confirmation-approve {
  border-color: var(--accent-border);
}

button:focus-visible {
  outline: 2px solid var(--accent-border);
  outline-offset: 2px;
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (min-width: 521px) and (max-width: 760px) {
  .extension-confirmations {
    width: min(var(--content-max), calc(100% - 64px));
  }
}

@media (max-width: 520px) {
  .extension-confirmations {
    --confirmation-gap: 22px;
    width: calc(100% - 20px);
  }
}
</style>
