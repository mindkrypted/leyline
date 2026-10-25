import { mobileToolStatus } from './tool-activity.js'

const SUBAGENT_MODEL_SOURCES = {
  call: 'this call',
  inherited: 'inherited',
  session: 'session override',
  project: 'project override',
  global: 'global default',
  definition: 'agent definition',
}

export function subagentTasks(entry) {
  if (entry.subagentDetails?.results?.length) return entry.subagentDetails.results
  const args = entry.args || {}
  const tasks = args.tasks || args.chain || (args.agent ? [args] : [])
  return tasks.map(({ model, thinking, ...task }) => ({
    ...task,
    requestedModel: model ?? args.model,
    requestedThinking: thinking ?? args.thinking,
    status: 'unknown',
    messages: [],
  }))
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

export function subagentModelChips(task, live = null) {
  const requestedModel = subagentRequestedArg(task?.requestedModel)
  const requestedThinking = subagentRequestedArg(task?.requestedThinking)
  const effectiveModel = live?.model?.id
    ? { id: live.model.id, provider: live.model.provider || '', name: live.model.name || '' }
    : task?.model
      ? { id: task.model, provider: task.modelProvider || '', name: task.modelName || '' }
      : requestedModel
        ? { id: requestedModel, provider: '', name: '' }
        : null
  const thinking = live?.thinkingLevel || task?.thinkingLevel || requestedThinking || ''
  let model = null
  if (effectiveModel) {
    const source = subagentModelSource(task, requestedModel, effectiveModel)
    model = {
      code: effectiveModel.provider ? `${effectiveModel.provider}/${effectiveModel.id}` : effectiveModel.id,
      title: subagentModelTitle(effectiveModel, source),
      source,
    }
  }
  return {
    model,
    thinking: thinking ? { level: thinking } : null,
  }
}

function subagentRequestedArg(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function subagentModelSource(task, requested, effective) {
  const stamped = SUBAGENT_MODEL_SOURCES[task?.modelSource]
  if (stamped) return stamped
  if (requested && requested !== 'inherit'
    && (!effective || subagentModelMatches(requested, effective))) return 'this call'
  if (requested === 'inherit') {
    return effective?.id === 'inherit' ? 'this call' : 'inherited'
  }
  return ''
}

function subagentModelMatches(requested, effective) {
  if (requested === effective.id) return true
  if (effective.provider) return requested === `${effective.provider}/${effective.id}`
  const separator = requested.indexOf('/')
  return separator > 0 && requested.slice(separator + 1) === effective.id
}

function subagentModelTitle(effective, source) {
  if (!effective.name && !effective.provider) return ''
  const parts = [effective.name, effective.provider ? `${effective.provider}/${effective.id}` : effective.id]
  if (source) parts.push(`from ${source}`)
  return parts.filter(Boolean).join(' · ')
}
