export const subagentStatuses = {
  completed: { label: 'Completed', path: 'm4 8 2.5 2.5L12 5' },
  running: { label: 'Running', path: 'M8 4.5V8l2.5 1.5' },
  queued: { label: 'Queued', path: 'M5 6h6M5 10h6' },
  stopped: { label: 'Stopped', path: 'M6 6h4v4H6Z' },
  failed: { label: 'Failed', path: 'm6 6 4 4m0-4-4 4' },
  'not-started': { label: 'Not started', path: 'M5 8h6' },
  unknown: { label: 'Unknown', path: 'M6.5 6a1.5 1.5 0 0 1 3 .5c0 1-1.5 1-1.5 2.5M8 11.5h.01' },
}

export function subagentStatus(result, active = false) {
  if (result.status === 'not-started') return 'not-started'
  if (result.status === 'unknown') return 'unknown'
  if (result.stopReason === 'aborted' || ['stopped', 'aborted'].includes(result.status)) return 'stopped'
  if (['error', 'failed'].includes(result.status)
    || result.stopReason === 'error'
    || result.error
    || (typeof result.exitCode === 'number' && result.exitCode > 0)) return 'failed'
  if (['done', 'completed'].includes(result.status)) return 'completed'
  if (['queued', 'running'].includes(result.status)) return active ? result.status : 'unknown'
  if (result.exitCode === -1) return active ? 'running' : 'unknown'
  if (result.exitCode === 0) return 'completed'
  return 'unknown'
}

export function subagentSummary(entry, liveStatus = '') {
  const details = entry.subagentDetails
  const active = liveStatus
    ? ['preparing', 'running'].includes(liveStatus)
    : details?.background === true
  const results = details?.results || []
  const counts = new Map()
  for (const result of results) {
    const status = subagentStatus(result, active)
    counts.set(status, (counts.get(status) || 0) + 1)
  }
  return {
    active,
    unavailable: details?.resultsUnavailable === true || counts.has('unknown'),
    counts: Object.entries(subagentStatuses).flatMap(([status, { label }]) => {
      const count = counts.get(status)
      return count ? [{ status, count, text: `${count} ${label.toLowerCase()}` }] : []
    }),
  }
}
