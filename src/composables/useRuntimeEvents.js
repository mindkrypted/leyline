import { computed, ref } from 'vue'
import { backendHttpUrl } from '../lib/backend'

const transientRuntimeEventTypes = new Set([
  'message_update',
  'tool_execution_update',
])

export function useRuntimeEvents({
  onActiveSession,
  onRuntimeEvent,
  onRuntimeRoster,
  onRuntimeRemoved,
  onExtensionUi,
  onExtensionError,
  onReconnect,
} = {}) {
  const runtimeEvents = ref([])
  const eventStreamError = ref('')
  const eventStreamConnected = ref(false)
  const eventLog = computed(() =>
    [...runtimeEvents.value]
      .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))
      .slice(0, 20),
  )
  let eventSource
  let eventSessionId = ''
  let streamOpened = false
  const traceSubscribers = new Set()

  function publishTraceNotice(notice) {
    for (const listener of traceSubscribers) listener(notice)
  }

  function subscribeTraces(listener) {
    traceSubscribers.add(listener)
    return () => traceSubscribers.delete(listener)
  }

  function openEventStream() {
    eventSource?.close()
    eventSource = undefined
    eventStreamConnected.value = false

    const params = new URLSearchParams({ sessionId: eventSessionId })
    const source = new EventSource(
      backendHttpUrl(`/api/pi/events?${params}`),
    )
    eventSource = source

    source.addEventListener('active_session', (event) => {
      if (eventSource !== source) return
      const data = parseEvent(event, 'active session')
      if (data) onActiveSession?.(data)
    })

    source.addEventListener('runtime_event', (event) => {
      if (eventSource !== source) return
      const data = parseEvent(event, 'runtime')
      if (!data) return
      if (data.event?.type === 'trace_updated' || data.event?.type === 'trace_config') {
        publishTraceNotice({ ...data.event, activeSessionId: data.event.sessionId })
        return
      }
      if (!transientRuntimeEventTypes.has(data.event?.type)) {
        appendRuntimeEvent(data)
      }
      onRuntimeEvent?.(data)
    })

    for (const type of ['trace_updated', 'trace_config']) {
      source.addEventListener(type, (event) => {
        if (eventSource !== source || !traceSubscribers.size) return
        try {
          const data = JSON.parse(event.data)
          publishTraceNotice({ ...data, type, activeSessionId: data.sessionId })
        } catch (error) {
          console.warn(`Invalid ${type} notice: ${error.message}`)
        }
      })
    }

    source.addEventListener('runtime_roster', (event) => {
      if (eventSource !== source) return
      const data = parseEvent(event, 'runtime roster')
      if (data) onRuntimeRoster?.(data)
    })

    source.addEventListener('runtime_removed', (event) => {
      if (eventSource !== source) return
      const data = parseEvent(event, 'removed runtime')
      if (data) onRuntimeRemoved?.(data)
    })

    source.addEventListener('extension_ui', (event) => {
      if (eventSource !== source) return
      const data = parseEvent(event, 'extension UI')
      if (!data) return
      appendRuntimeEvent({ ...data, type: 'extension_ui' })
      onExtensionUi?.(data)
    })

    source.addEventListener('extension_error', (event) => {
      if (eventSource !== source) return
      const data = parseEvent(event, 'extension error')
      if (!data) return
      appendRuntimeEvent({ ...data, type: 'extension_error' })
      onExtensionError?.(data)
    })

    source.onopen = () => {
      if (eventSource !== source) return
      const reconnected = streamOpened
      streamOpened = true
      eventStreamConnected.value = true
      eventStreamError.value = ''
      appendRuntimeEvent({ type: 'connected' })
      if (reconnected) {
        publishTraceNotice({ type: 'reconnect' })
        onReconnect?.()
      }
    }

    source.onerror = () => {
      if (eventSource !== source) return
      eventStreamConnected.value = false
      eventStreamError.value = 'Runtime event stream disconnected'
      appendRuntimeEvent({ type: 'disconnected' })
      console.warn('pi event stream disconnected')
    }
  }

  function setEventSessionId(sessionId) {
    const next = String(sessionId || '')
    if (next === eventSessionId) return
    eventSessionId = next
    if (eventSource) openEventStream()
  }

  function parseEvent(event, label) {
    try {
      return JSON.parse(event.data)
    } catch (error) {
      const message = `Invalid ${label} event: ${error.message}`
      eventStreamError.value = message
      appendRuntimeEvent({ type: 'error', message })
      return null
    }
  }

  function closeEventStream() {
    eventSource?.close()
    eventSource = undefined
    eventStreamConnected.value = false
  }

  function appendRuntimeEvent(event) {
    runtimeEvents.value = [
      ...runtimeEvents.value.slice(-99),
      { ...event, loggedAt: new Date().toISOString() },
    ]
  }

  return {
    appendRuntimeEvent,
    closeEventStream,
    eventLog,
    eventStreamConnected,
    eventStreamError,
    openEventStream,
    runtimeEvents,
    setEventSessionId,
    subscribeTraces,
  }
}
