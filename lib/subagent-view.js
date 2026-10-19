import { mobileToolStatus } from './tool-activity.js'

export function subagentTasks(entry) {
  if (entry.subagentDetails?.results?.length) return entry.subagentDetails.results
  const args = entry.args || {}
  const tasks = args.tasks || args.chain || (args.agent ? [args] : [])
  return tasks.map(task => ({ ...task, status: 'unknown', messages: [] }))
}

export function subagentTaskTitle(result, index = 0) {
  return (result.title || result.research?.title || result.task || result.agent || `Task ${index + 1}`)
    .split(/\r?\n/).find(line => line.trim())?.trim() || `Task ${index + 1}`
}

export function subagentCallTitle(entry) {
  const tasks = subagentTasks(entry)
  if (tasks.length === 1) return subagentTaskTitle(tasks[0])
  if (tasks.length > 1) {
    if (entry.researchThreads) return `${tasks.length} research threads`
    const mode = entry.subagentDetails?.mode || entry.subagentMode || entry.args?.mode
    return mode === 'chain' || entry.args?.chain
      ? `${tasks.length} tasks in sequence`
      : `${tasks.length} parallel tasks`
  }
  return entry.code || 'Task details'
}

export function subagentOutput(result) {
  if (result.research?.summary) return result.research.summary
  for (const message of [...(result.messages || [])].reverse()) {
    if (!['assistant', 'error'].includes(message.role)) continue
    const text = typeof message.content === 'string' ? message.content
      : Array.isArray(message.content) ? message.content.map(block => block.text || '').join('\n') : ''
    if (text.trim()) return text.trim()
  }
  return ''
}

export function subagentFallback(entry, toolStatus = '') {
  const status = mobileToolStatus(entry, toolStatus)
  if (['preparing', 'running', 'reading result'].includes(status)) return { status: 'running', label: 'Running' }
  if (status === 'stopped') return { status: 'stopped', label: 'Stopped' }
  if (['error', 'failed'].includes(status)) return { status: 'failed', label: 'Failed' }
  return { status: 'unknown', label: 'Results unavailable' }
}

export function subagentEmptyText(status) {
  return {
    running: 'The child session is running. No text result is available yet.',
    queued: 'This task is queued and has not started.',
    completed: 'This task completed without a text result.',
    stopped: 'This task was stopped. No text result is available.',
    failed: 'This task failed before it returned a text result.',
    'not-started': 'This task did not start.',
    unknown: 'No final result was recorded. This task’s outcome is unknown.',
  }[status] || 'No text result is available.'
}
