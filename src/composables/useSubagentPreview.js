import { computed, ref, watch } from 'vue'
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
  const projection = useLiveTurnProjection({
    onIntent(intent) {
      if (intent.type === 'surface-error') runtimeError.value = intent.message
    },
  })
  const toolGroups = new Map()
  const messageIds = new Map()
  let groupSequence = 0
  const items = computed(() => {
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
  let refresh = () => {}

  function rememberMessage(item) {
    const id = activityEntry(item).id
    const key = messageIds.get(item.id) || messageIds.get(id) || item.id
    messageIds.set(item.id, key)
    messageIds.set(id, key)
  }

  watch([() => session.value?.id, () => session.value?.path], ([id], previous, onCleanup) => {
    projection.clearSession()
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
    projection.selectSession(id)

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
        const detail = await fetchSessionDetail(child, { signal: controller.signal })
        if (disposed || revision !== requestRevision) return
        if (rebase) {
          projection.setPersistedDetail(detail)
          for (const item of projection.liveItems.value.filter(item => item.persistedEntry?.role === 'assistant').slice(-80)) rememberMessage(item)
          projection.selectSession(id)
          projection.setPersistedDetail(detail)
          if (snapshot) projection.setRuntimeState(snapshot.state, snapshot.snapshotRevision)
          for (const data of replay) projection.handle({ kind: 'runtime', ...data })
          replay = []
          rebase = false
          if (connection.value === 'settled') {
            projection.setAgentRunning(false)
            projection.finishTools(status.value === 'stopped' ? 'aborted' : 'completed')
          }
        }
        projection.setPersistedDetail(detail)
        error.value = ''
      } catch (failure) {
        if (disposed || revision !== requestRevision || failure.name === 'AbortError') return
        error.value = failure.message
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
            projection.setRuntimeState(data.state, data.snapshotRevision)
          } else if (type === 'runtime_event' && data.activeSessionId === id) {
            if (rebase) {
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
      disposed = true
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
    refresh: () => refresh(),
    runtimeError,
    started,
  }
}
