import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { activityEntry, groupToolActivity } from '../../lib/tool-activity.js'
import { openEventSocket } from '../lib/event-socket'
import { fetchSessionDetail } from '../lib/pi-api'
import { useLiveTurnProjection } from './useLiveTurnProjection'

export function useSubagentPreview(session, status) {
  const started = ref(false)
  const loading = ref(false)
  const connection = ref('')
  const error = ref('')
  const runtimeError = ref('')
  const ready = ref(false)
  const cached = shallowRef(null)
  const cache = new Map()
  const cacheLimit = 4 * 1024 * 1024
  const projection = useLiveTurnProjection({
    onIntent(intent) {
      if (intent.type === 'surface-error') runtimeError.value = intent.message
    },
  })
  const toolGroups = new Map()
  const messageIds = new Map()
  let groupSequence = 0
  let assistantSequence = 0
  const projectedItems = computed(() => {
    const tail = [
      ...projection.entries.value,
      ...projection.liveItems.value,
    ].filter(item => {
      const entry = activityEntry(item)
      return entry.type === 'tool'
        || entry.type === 'assistant'
        || (entry.type === 'message' && entry.role === 'assistant')
    }).slice(-80)
    const retainedMessages = new Set()
    for (const item of tail) {
      const entry = activityEntry(item)
      if (entry.type === 'tool') continue
      rememberMessage(item)
      retainedMessages.add(item.id)
      retainedMessages.add(entry.id)
    }
    for (const key of messageIds.keys()) if (!retainedMessages.has(key)) messageIds.delete(key)
    const rows = groupToolActivity(tail)
    const retainedTools = new Set()
    const usedGroups = new Set()
    for (const row of rows) {
      if (row.type !== 'tool-activity') continue
      const keys = row.items.map(item => activityEntry(item).toolCallId || item.id)
      const previous = keys.map(key => toolGroups.get(key)).filter(Boolean)
      const group = previous.find(group => !usedGroups.has(group.id)) || {
        id: `subagent-tool-group-${++groupSequence}`,
        sourceId: previous[0]?.id,
      }
      row.id = group.id
      row.sourceGroupId = group.sourceId
      usedGroups.add(group.id)
      for (const key of keys) {
        toolGroups.set(key, group)
        retainedTools.add(key)
      }
    }
    for (const key of toolGroups.keys()) if (!retainedTools.has(key)) toolGroups.delete(key)
    return rows
  })
  const items = computed(() => ready.value ? projectedItems.value : cached.value?.items || [])
  const available = computed(() => ready.value || Boolean(cached.value))
  let refresh = () => {}

  function savePreview(key, detail, events, anchor) {
    if (!ready.value || !started.value) return
    const snapshot = {
      items: projectedItems.value,
      messages: [...messageIds],
      groups: [...toolGroups],
      sequence: groupSequence,
      detail: { entries: (detail?.entries || []).filter(entry => entry.type === 'tool' || entry.role === 'assistant').slice(-80) },
      events,
      anchor,
    }
    if (!snapshot.items.length) return
    let bytes = 0
    try {
      bytes = JSON.stringify(snapshot, (_, value) => {
        if (typeof value === 'string') bytes += value.length * 2
        if (bytes > cacheLimit) throw new RangeError('Preview cache limit')
        return value
      }).length * 2
    } catch {
      return
    }
    if (bytes > cacheLimit) return
    cache.delete(key)
    cache.set(key, { snapshot, bytes })
    let total = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    while (cache.size > 4 || total > cacheLimit) {
      const oldest = cache.keys().next().value
      total -= cache.get(oldest).bytes
      cache.delete(oldest)
    }
  }

  onScopeDispose(() => cache.clear())

  function rememberMessage(item) {
    const id = activityEntry(item).id
    const key = messageIds.get(item.id) || messageIds.get(id) || item.id
    messageIds.set(item.id, key)
    messageIds.set(id, key)
  }

  watch([() => session.value?.id, () => session.value?.path], ([id, path], previous, onCleanup) => {
    projection.clearSession()
    ready.value = false
    cached.value = null
    started.value = false
    loading.value = false
    connection.value = ''
    error.value = ''
    runtimeError.value = ''
    toolGroups.clear()
    messageIds.clear()
    groupSequence = 0
    refresh = () => {}
    if (!id) return

    const child = { ...session.value }
    const cacheKey = JSON.stringify([id, path])
    const previousPreview = status.value === 'running' ? cache.get(cacheKey) : null
    if (previousPreview) {
      cached.value = previousPreview.snapshot
      cache.delete(cacheKey)
      cache.set(cacheKey, previousPreview)
      for (const [key, value] of cached.value.messages) messageIds.set(key, value)
      for (const [key, value] of cached.value.groups) toolGroups.set(key, value)
      groupSequence = cached.value.sequence
    }
    let disposed = false
    let socket
    let controller
    let refreshTimer
    let initialTimer
    let requestRevision = 0
    let refreshQueued = false
    let snapshotRevision = -1
    let lastRefresh = 0
    let opened = false
    let rebase = false
    let replay = []
    let snapshot
    let detail = previousPreview?.snapshot.detail
    let anchor = previousPreview?.snapshot.anchor
    let events = [...(previousPreview?.snapshot.events || [])]
    let restored = Boolean(previousPreview)
    let assistantId = ''
    let restoreFrame
    projection.selectSession(id)
    if (restored) {
      projection.setPersistedDetail(detail)
      for (const frame of events) {
        if (frame.type === 'active_session') projection.setRuntimeState(frame.data.state, frame.data.snapshotRevision)
        else {
          projection.handle({ kind: 'runtime', ...frame.data })
          const event = frame.data.event
          if (event?.message?.role === 'assistant') assistantId = event.type === 'message_end' ? '' : event.message.entryId || ''
        }
      }
      projection.setPersistedDetail(detail)
      restoreFrame = requestAnimationFrame(() => {
        if (disposed) return
        ready.value = true
        cached.value = null
      })
    }

    function rememberEvent(type, data) {
      const previous = events.at(-1)
      if (previous?.type === type && (type === 'active_session'
        || (['message_update', 'tool_execution_update'].includes(data.event?.type)
          && previous.data.event?.type === data.event.type
          && previous.data.event.toolCallId === data.event.toolCallId
          && previous.data.event.message?.timestamp === data.event.message?.timestamp))) events.pop()
      events.push({ type, data })
      if (events.length > 128) events.shift()
    }

    async function load() {
      if (disposed) return
      clearTimeout(refreshTimer)
      refreshTimer = undefined
      if (controller) {
        refreshQueued = true
        return
      }
      refreshQueued = false
      controller = new AbortController()
      const revision = requestRevision
      lastRefresh = Date.now()
      loading.value = true
      try {
        const freshDetail = await fetchSessionDetail(child, { signal: controller.signal })
        if (disposed || revision !== requestRevision) return
        if (restored) {
          const index = anchor ? freshDetail.entries.findIndex(entry => entry.id === anchor) : -1
          if ((anchor && index < 0)
            || freshDetail.entries.slice(index + 1).some(entry => entry.type === 'message' && entry.role === 'assistant')) rebase = true
        }
        detail = freshDetail
        anchor = detail.entries.at(-1)?.id
        restored = false
        if (rebase) {
          projection.setPersistedDetail(detail)
          for (const item of projection.liveItems.value.filter(item => item.persistedEntry?.role === 'assistant').slice(-80)) rememberMessage(item)
          projection.selectSession(id)
          projection.setPersistedDetail(detail)
          if (snapshot) projection.setRuntimeState(snapshot.state, snapshot.snapshotRevision)
          for (const data of replay) projection.handle({ kind: 'runtime', ...data })
          events = snapshot ? [{ type: 'active_session', data: snapshot }] : []
          for (const data of replay) rememberEvent('runtime_event', data)
          replay = []
          rebase = false
          if (connection.value === 'settled') {
            projection.setAgentRunning(false)
            projection.finishTools(status.value === 'stopped' ? 'aborted' : 'completed')
          }
        }
        projection.setPersistedDetail(detail)
        const savedIds = new Set(detail.entries.map(entry => entry.id))
        for (const item of projection.liveItems.value) {
          if (item.type === 'assistant' && item.persistedEntry) savedIds.add(item.id)
        }
        events = events.filter(frame => frame.type !== 'runtime_event'
          || frame.data.event?.message?.role !== 'assistant'
          || !savedIds.has(frame.data.event.message.entryId))
        ready.value = true
        cached.value = null
        error.value = ''
      } catch (failure) {
        if (disposed || revision !== requestRevision || failure.name === 'AbortError') return
        error.value = failure.message
        ready.value = true
        cached.value = null
      } finally {
        controller = undefined
        if (!disposed) {
          loading.value = refreshQueued
          if (refreshQueued) scheduleRefresh()
        }
      }
    }

    function scheduleRefresh() {
      if (disposed) return
      if (controller) {
        refreshQueued = true
        return
      }
      if (refreshTimer) return
      refreshTimer = setTimeout(load, Math.max(150, 500 - (Date.now() - lastRefresh)))
    }

    function closeSocket() {
      clearTimeout(initialTimer)
      socket?.close()
      socket = undefined
    }

    function settle() {
      if (connection.value !== 'settled') requestRevision++
      if (rebase || connection.value === 'reconnecting'
        || projection.liveItems.value.some(item => item.streaming)) {
        rebase = true
        replay = []
        snapshot = undefined
      }
      closeSocket()
      connection.value = 'settled'
      projection.setAgentRunning(false)
      projection.finishTools(status.value === 'stopped' ? 'aborted' : 'completed')
      void load()
    }

    function start() {
      if (started.value || disposed) return
      started.value = true
      loading.value = true
      connection.value = 'connecting'
      const params = new URLSearchParams({ sessionId: id })
      socket = openEventSocket(`/api/pi/events?${params}`, {
        onOpen() {
          if (disposed) return
          clearTimeout(initialTimer)
          requestRevision++
          snapshotRevision = -1
          rebase = opened
          replay = []
          snapshot = undefined
          opened = true
          connection.value = 'live'
          void load()
        },
        onDisconnect() {
          if (disposed) return
          connection.value = 'reconnecting'
        },
        onEvent(type, data) {
          if (disposed || !data) return
          if (type === 'active_session' && data.id === id) {
            if (typeof data.snapshotRevision === 'number') {
              if (data.snapshotRevision <= snapshotRevision) return
              snapshotRevision = data.snapshotRevision
            }
            snapshot = data
            rememberEvent(type, data)
            projection.setRuntimeState(data.state, data.snapshotRevision)
          } else if (type === 'runtime_event' && data.activeSessionId === id) {
            const event = data.event
            if (event?.message?.role === 'assistant'
              && ['message_start', 'message_update', 'message_end'].includes(event.type)) {
              const nativeId = event.message.entryId || event.entryId || event.message.id || event.id
              if (event.type === 'message_start') assistantId = ''
              assistantId = nativeId || assistantId || `subagent-assistant-${++assistantSequence}`
              data = { ...data, event: { ...event, message: { ...event.message, entryId: assistantId } } }
              if (event.type === 'message_end') assistantId = ''
            }
            rememberEvent(type, data)
            if (rebase || restored) {
              const previous = replay.at(-1)?.event
              const event = data.event
              if (['message_update', 'tool_execution_update'].includes(event?.type)
                && previous?.type === event.type
                && previous.toolCallId === event.toolCallId
                && previous.message?.timestamp === event.message?.timestamp) replay.pop()
              replay.push(data)
              if (replay.length > 128) replay.shift()
            }
            projection.handle({ kind: 'runtime', ...data })
            if (data.event?.type === 'message_start' && data.event.message?.role === 'assistant') runtimeError.value = ''
            if (['message_end', 'tool_execution_end', 'agent_end', 'agent_settled', 'compaction_end'].includes(data.event?.type)) scheduleRefresh()
          } else if ((type === 'runtime_removed' && data.id === id)
            || (type === 'runtime_roster' && !data.sessionIds?.includes(id))) {
            settle()
          }
        },
      })
      initialTimer = setTimeout(load, 250)
    }

    refresh = load
    const stopStatus = watch(status, value => {
      if (value === 'running') start()
      else if (started.value) settle()
    }, { immediate: true })

    onCleanup(() => {
      savePreview(cacheKey, detail, [...events], anchor)
      disposed = true
      cancelAnimationFrame(restoreFrame)
      stopStatus()
      closeSocket()
      clearTimeout(refreshTimer)
      controller?.abort()
      projection.dispose()
    })
  }, { immediate: true })

  return {
    activity: projection.liveActivity,
    compacting: projection.compactingContext,
    connection,
    error,
    items,
    itemKey: item => `${session.value?.id || ''}:${messageIds.get(activityEntry(item).id) || item.id}`,
    loading,
    ready: available,
    refresh: () => refresh(),
    runtimeError,
    started,
  }
}
