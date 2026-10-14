import { ref } from 'vue'
import {
  fetchPinnedSessions,
  pinLeylineSession,
  prunePinnedSessions,
  unpinLeylineSession,
} from '../lib/leyline-api'

const PRUNE_BATCH_SIZE = 500

export function usePinnedSessions() {
  const pinnedIds = ref(new Set())
  const pinnedVersion = ref(0)
  const pendingIds = ref(new Set())
  const loading = ref(false)
  const loadedConnectionId = ref('')
  const loadRevision = ref(0)
  const error = ref('')
  let loadToken = 0
  let opQueue = Promise.resolve()

  function enqueue(operation) {
    const run = opQueue.then(operation, operation)
    opQueue = run.catch(() => {})
    return run
  }

  function setPins(ids) {
    const next = new Set(ids)
    if (next.size === pinnedIds.value.size
      && [...next].every((id) => pinnedIds.value.has(id))) return
    pinnedIds.value = next
    pinnedVersion.value += 1
  }

  function setPending(sessionId, pending) {
    const next = new Set(pendingIds.value)
    if (pending) next.add(sessionId)
    else next.delete(sessionId)
    pendingIds.value = next
  }

  async function load(connectionId) {
    const target = String(connectionId || '').trim()
    if (!target) return
    const token = ++loadToken
    if (loadedConnectionId.value !== target) {
      loadedConnectionId.value = ''
      setPins([])
    }
    return enqueue(async () => {
      if (token !== loadToken) return
      loading.value = true
      error.value = ''
      try {
        const data = await fetchPinnedSessions(target)
        if (token !== loadToken) return
        loadedConnectionId.value = target
        setPins(pinnedList(data))
        loadRevision.value += 1
      } catch (loadError) {
        if (token !== loadToken) return
        loadedConnectionId.value = ''
        error.value = loadError.message
      } finally {
        if (token === loadToken) loading.value = false
      }
    })
  }

  async function toggle(connectionId, sessionId) {
    const target = String(connectionId || '').trim()
    const id = String(sessionId || '').trim()
    if (!target || !id) return
    if (loading.value || loadedConnectionId.value !== target) return
    if (pendingIds.value.has(id)) return
    const wasPinned = pinnedIds.value.has(id)
    setPending(id, true)
    error.value = ''
    try {
      const data = await enqueue(async () => {
        return wasPinned
          ? unpinLeylineSession(target, id)
          : pinLeylineSession(target, id)
      })
      if (loadedConnectionId.value !== target) return
      setPins(pinnedList(data))
    } catch (toggleError) {
      if (loadedConnectionId.value === target) error.value = toggleError.message
    } finally {
      setPending(id, false)
    }
  }

  async function prune(connectionId, sessionIds) {
    const target = String(connectionId || '').trim()
    const ids = [...new Set(
      (Array.isArray(sessionIds) ? sessionIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    )]
    if (!target || !ids.length) return
    try {
      for (let index = 0; index < ids.length; index += PRUNE_BATCH_SIZE) {
        const batch = ids.slice(index, index + PRUNE_BATCH_SIZE)
        const data = await enqueue(async () => {
          return prunePinnedSessions(target, batch)
        })
        if (loadedConnectionId.value !== target) return
        setPins(pinnedList(data))
      }
    } catch (pruneError) {
      if (loadedConnectionId.value === target) error.value = pruneError.message
    }
  }

  async function pruneUnknown(connectionId, knownIds) {
    const target = String(connectionId || '').trim()
    if (!target || loadedConnectionId.value !== target) return
    const known = new Set(
      [...knownIds].map((id) => String(id || '').trim()).filter(Boolean),
    )
    const unknown = [...pinnedIds.value].filter((id) => !known.has(id))
    if (!unknown.length) return
    await prune(target, unknown)
  }

  function isPinned(sessionId) {
    return pinnedIds.value.has(sessionId)
  }

  function pinnedList(data) {
    return Array.isArray(data?.pinnedIds)
      ? data.pinnedIds.map((id) => String(id || '').trim()).filter(Boolean)
      : []
  }

  function dispose() {
    loadToken += 1
    opQueue = Promise.resolve()
  }

  return {
    dispose,
    error,
    isPinned,
    load,
    loadedConnectionId,
    loadRevision,
    loading,
    pendingIds,
    pinnedIds,
    pinnedVersion,
    prune,
    pruneUnknown,
    toggle,
  }
}
