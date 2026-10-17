import { subagentSummary } from './subagent-status.js'

export function activityEntry(item) {
  return item.persistedEntry || item.resultEntry || item
}

export function mobileToolStatus(entry, status = '') {
  if (status === 'aborted' || entry.cancelled || entry.stopReason === 'aborted') return 'stopped'
  if (entry.isError && /^(?:Operation aborted|This operation was aborted)$|(?:^|\n)Command aborted\s*$/.test((entry.text || '').trim())) return 'stopped'
  if (status === 'reading') return 'reading result'
  if (status && status !== 'completed') return status
  if (entry.toolOutcome) return entry.toolOutcome
  if (entry.isError) return 'error'
  return 'completed'
}

export function activityStatus(item) {
  const entry = activityEntry(item)
  if ((item.status === 'completed' || (!item.status && entry.persisted === false))
    && !item.persistedEntry && !item.finalResultReceived && !item.terminalLiveResultReceived) return 'unknown'
  return mobileToolStatus(entry, item.status)
}

function isCompleted(item) {
  const entry = activityEntry(item)
  if (entry.type !== 'tool' || entry.parentToolCallId || item.parentToolCallId) return false
  if (activityStatus(item) !== 'completed') return false
  if (entry.toolName === 'subagent') {
    const outcome = subagentSummary(entry, item.status)
    return !outcome.active && !outcome.unavailable && outcome.counts.length === 1
      && outcome.counts[0].status === 'completed'
  }
  return true
}

export function groupToolActivity(items) {
  const rows = []
  let pending = []
  function flush() {
    if (pending.length > 1) {
      const first = activityEntry(pending[0])
      rows.push({ id: `activity-${first.toolCallId || first.id}`, type: 'tool-activity', items: pending, operations: activityOperations(pending) })
    } else rows.push(...pending)
    pending = []
  }
  for (const item of items) {
    if (isCompleted(item)) pending.push(item)
    else {
      flush()
      rows.push(item)
    }
  }
  flush()
  return rows
}

export function activityOperations(items) {
  const counts = new Map()
  for (const item of items) {
    const name = activityEntry(item).toolName || 'other'
    const operation = { read: 'read', 'read-skill': 'read', edit: 'edit', write: 'write', bash: 'command', grep: 'search', find: 'search', ls: 'listing', subagent: 'subagent call' }[name] || 'other call'
    counts.set(operation, (counts.get(operation) || 0) + 1)
  }
  return [...counts].map(([operation, count]) => {
    const label = count === 1 ? operation : operation === 'search' ? 'searches' : `${operation}s`
    return `${count} ${label}`
  })
}
