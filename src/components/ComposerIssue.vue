<script setup>
import { computed, nextTick, ref, useId, watch } from 'vue'

const props = defineProps({
  issue: { type: Object, default: null },
  blockingMessage: { type: String, default: '' },
})
const emit = defineEmits(['dismiss', 'focus-composer'])
const root = ref(null)
const trigger = ref(null)
const dialog = ref(null)
const opened = ref(false)
const dialogId = useId()
const message = computed(() => props.issue?.message || props.blockingMessage)
const title = computed(() => props.issue?.kind === 'connection'
  ? 'Connection issue'
  : props.issue?.kind === 'image' || !props.issue ? 'Cannot send message' : 'Composer issue')

watch([() => props.issue?.id, message], async () => {
  const previousDialog = dialog.value
  const restoreFocus = opened.value && previousDialog?.contains(document.activeElement)
  opened.value = false
  if (!restoreFocus) return
  await nextTick()
  if (opened.value || (document.activeElement !== document.body
    && !previousDialog.contains(document.activeElement))) return
  if (message.value) trigger.value?.focus({ preventScroll: true })
  else emit('focus-composer')
})

async function toggleDetails() {
  if (dismissDetails()) return
  opened.value = true
  await nextTick()
  if (opened.value) dialog.value?.focus({ preventScroll: true })
}

function dismissDetails(restoreFocus = true) {
  if (!opened.value) return false
  opened.value = false
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
  return true
}

function closeOutside(event) {
  if (!event.composedPath().includes(root.value)) dismissDetails(false)
}

function dismissIssue() {
  const issue = props.issue
  dismissDetails(false)
  if (issue) emit('dismiss', issue)
}

defineExpose({ opened, dismissDetails, closeOutside })
</script>

<template>
  <span class="composer-issue-live" role="status" aria-live="polite" aria-atomic="true">{{ message }}</span>
  <Transition name="composer-reveal">
    <div v-if="message" ref="root" class="composer-issue">
      <div v-if="issue" class="composer-issue-chip">
        <button
          ref="trigger"
          class="composer-issue-toggle"
          type="button"
          aria-label="1 composer issue. Show details"
          aria-haspopup="dialog"
          :aria-controls="dialogId"
          :aria-expanded="opened"
          @click="toggleDetails"
        >
          <svg class="composer-issue-symbol" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.7v3.8M8 11.2h.01" /></svg>
          <span>1 issue</span>
          <svg class="composer-issue-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </button>
        <button class="composer-issue-close" type="button" aria-label="Dismiss composer issue" title="Dismiss issue" @click="dismissIssue">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </div>
      <button
        v-else
        ref="trigger"
        class="composer-issue-blocked"
        type="button"
        aria-haspopup="dialog"
        :aria-controls="dialogId"
        :aria-expanded="opened"
        :title="blockingMessage"
        @click="toggleDetails"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.7v3.8M8 11.2h.01" /></svg>
        <span>Send unavailable</span>
        <span class="composer-issue-details-label">Details</span>
      </button>
      <Transition name="composer-popover">
        <section
          v-if="opened"
          :id="dialogId"
          ref="dialog"
          class="composer-issue-popover"
          role="dialog"
          :aria-label="title"
          tabindex="-1"
        >
          <header class="composer-issue-heading">
            <svg class="composer-issue-symbol" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.7v3.8M8 11.2h.01" /></svg>
            <h3>{{ title }}</h3>
            <button class="composer-issue-close" type="button" aria-label="Close issue details" @click="dismissDetails()">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
            </button>
          </header>
          <p class="composer-issue-message">{{ message }}</p>
          <footer class="composer-issue-footer">
            <span>Your draft stays unchanged.</span>
            <button v-if="issue" class="composer-issue-dismiss" type="button" @click="dismissIssue">Dismiss</button>
            <button v-else class="composer-issue-dismiss" type="button" @click="dismissDetails()">Close</button>
          </footer>
        </section>
      </Transition>
    </div>
  </Transition>
</template>
