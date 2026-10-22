import { subagentSummary } from './subagent-status.js'
import { skillReadName } from './transcript-projection.js'

export function activityEntry(item) {
  return item.persistedEntry || item.resultEntry || item
}

export function singleSubagentEntry(group) {
  const entry = group.items.length === 1 ? activityEntry(group.items[0]) : null
  return entry?.toolName === 'subagent' ? entry : null
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

export function toolStatusTone(status) {
  if (['preparing', 'running', 'reading result'].includes(status)) return 'running'
  if (['stopped', 'unknown'].includes(status)) return status
  if (['error', 'failed', 'aborted'].includes(status)) return 'error'
  return 'completed'
}

export function activityStatus(item) {
  const entry = activityEntry(item)
  if ((item.status === 'completed' || (!item.status && entry.persisted === false))
    && !item.persistedEntry && !item.finalResultReceived && !item.terminalLiveResultReceived) return 'unknown'
  const status = mobileToolStatus(entry, item.status)
  if (status === 'completed' && entry.toolName === 'subagent') {
    const outcome = subagentSummary(entry)
    if (outcome.active && (!outcome.counts.length
      || outcome.counts.some(count => count.status === 'running' || count.status === 'queued'))) return 'running'
  }
  return status
}

export function activitySummary(items) {
  const counts = new Map()
  let busy = false
  let hasSubagents = false
  for (const item of items) {
    const entry = activityEntry(item)
    const status = activityStatus(item)
    const outcome = entry.toolName === 'subagent' ? subagentSummary(entry, status) : null
    const tasks = outcome?.counts || []
    if (outcome) hasSubagents = true
    for (const task of tasks) {
      if (['completed', 'running', 'queued'].includes(task.status)) {
        counts.set(task.status, (counts.get(task.status) || 0) + task.count)
      }
    }
    const statuses = new Set([status, ...tasks.map(count => count.status)])
    if (['preparing', 'running', 'reading result', 'queued'].includes(status)
      || (outcome?.active && (!tasks.length || statuses.has('running') || statuses.has('queued')))) busy = true
    if (outcome?.unavailable || (outcome && !tasks.length && status === 'completed')) statuses.add('unknown')
    if (tasks.length && !statuses.has('failed')
      && (statuses.has('stopped') || statuses.has('not-started'))) statuses.delete('error')
    if (statuses.has('failed')) statuses.add('error')
    for (const key of ['error', 'stopped', 'not-started', 'unknown']) {
      if (!statuses.has(key)) continue
      const taskCount = tasks.reduce((total, count) => {
        const matches = count.status === key || (key === 'error' && count.status === 'failed')
        return matches ? total + count.count : total
      }, 0)
      counts.set(key, (counts.get(key) || 0) + Math.max(1, taskCount))
    }
  }
  return {
    busy,
    hasSubagents,
    outcomes: ['completed', 'running', 'queued', 'error', 'stopped', 'not-started', 'unknown'].flatMap((status) => {
      const count = counts.get(status)
      return count ? [{
        status,
        text: `${count} ${status === 'error' ? (count === 1 ? 'error' : 'errors') : status.replace('-', ' ')}`,
      }] : []
    }),
  }
}

export function groupToolActivity(items) {
  const rows = []
  let pending = []
  function flush() {
    if (pending.length > 0) {
      const first = activityEntry(pending[0])
      rows.push({ id: `activity-${first.toolCallId || first.id}`, type: 'tool-activity', items: pending, operations: activityOperations(pending) })
    }
    pending = []
  }
  for (const item of items) {
    const entry = activityEntry(item)
    if (entry.type === 'tool') {
      if (!entry.parentToolCallId && !item.parentToolCallId) pending.push(item)
    } else {
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
    const entry = activityEntry(item)
    const name = entry.toolName || 'other'
    const operation = skillReadName(entry) ? 'skill'
      : { read: 'read', edit: 'edit', write: 'write', bash: 'command', grep: 'search', find: 'search', ls: 'listing', subagent: 'subagent call' }[name] || 'other call'
    counts.set(operation, (counts.get(operation) || 0) + 1)
  }
  return [...counts].map(([operation, count]) => {
    const label = count === 1 ? operation : operation === 'search' ? 'searches' : `${operation}s`
    return `${count} ${label}`
  })
}
