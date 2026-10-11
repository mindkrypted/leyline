import { calculateCost, cleanupSessionResources } from '@earendil-works/pi-ai'
import {
  supportsUltrafastWithAuth,
  ULTRAFAST_COMMAND,
  ULTRAFAST_STATUS_KEY,
} from '../../../lib/ultrafast.js'

export default function (pi) {
  let enabled = false
  let enabledModel
  let resetPending = false
  let cleanupPending = false
  let requestBoundaryAvailable = false
  let compacting = false
  let headerRequest
  const responses = new Map()

  function available(ctx, model) {
    return Boolean(model) && supportsUltrafastWithAuth(
      model,
      ctx.modelRegistry.isUsingOAuth(model),
    )
  }

  function publish(ctx) {
    ctx.ui.setStatus(ULTRAFAST_STATUS_KEY, enabled ? 'on' : 'off')
  }

  function flushCleanup(ctx) {
    if (!cleanupPending) return
    cleanupPending = false
    cleanupSessionResources(ctx.sessionManager.getSessionId())
  }

  function requestCleanup(ctx) {
    cleanupPending = true
    if (ctx.isIdle()) flushCleanup(ctx)
  }

  function disable(ctx) {
    const cleanup = enabled || enabledModel
    enabled = false
    enabledModel = undefined
    resetPending = false
    publish(ctx)
    if (cleanup) requestCleanup(ctx)
  }

  function reset(_event, ctx) {
    if (enabled && ctx.signal) {
      resetPending = true
      return
    }
    disable(ctx)
  }

  pi.on('session_start', (_event, ctx) => {
    enabled = false
    enabledModel = undefined
    resetPending = false
    cleanupPending = false
    compacting = false
    headerRequest = undefined
    responses.clear()
    publish(ctx)
  })
  pi.on('model_select', reset)
  pi.on('session_before_compact', () => { compacting = true })
  function finishCompaction(_event, ctx) {
    compacting = false
    flushCleanup(ctx)
  }
  pi.on('session_compact', finishCompaction)
  pi.on('session_compact_failed', finishCompaction)
  pi.on('session_tree', reset)
  pi.on('turn_start', (_event, ctx) => {
    if (resetPending) disable(ctx)
    flushCleanup(ctx)
  })
  pi.on('turn_end', (_event, ctx) => {
    if (resetPending) disable(ctx)
    headerRequest = undefined
    flushCleanup(ctx)
  })
  pi.on('agent_settled', (_event, ctx) => {
    if (resetPending) disable(ctx)
    headerRequest = undefined
    flushCleanup(ctx)
  })
  pi.on('session_shutdown', () => {
    enabled = false
    enabledModel = undefined
    resetPending = false
    cleanupPending = false
    requestBoundaryAvailable = false
    compacting = false
    headerRequest = undefined
    responses.clear()
  })

  pi.registerCommand(ULTRAFAST_COMMAND, {
    description: 'Set Ultrafast from the Leyline composer',
    handler: async (args, ctx) => {
      if (!['on', 'off'].includes(args)
        || (args === 'on' && !available(ctx, ctx.model))) return
      if (args === 'off') {
        disable(ctx)
        return
      }
      if (!requestBoundaryAvailable) {
        ctx.ui.notify('Ultrafast requires the Leyline request boundary.', 'warning')
        return
      }
      if (!enabled) requestCleanup(ctx)
      enabled = true
      enabledModel = ctx.model
      resetPending = false
      publish(ctx)
    },
  })

  pi.on('cache_warming_decision', () => {
    if (enabled) return { action: 'stop' }
  })

  pi.on('before_provider_headers', ({ headers }, ctx) => {
    if (!headerRequest?.enabled || compacting || ctx.signal !== headerRequest.signal) return
    const { model } = headerRequest
    if (model.provider === 'openai-codex') {
      headers['x-codex-routing-hint'] = `model=${model.id};tier=ultrafast`
    } else if (model.id === 'gpt-6-astra') {
      headers['OpenAI-Service-Tier'] = 'ultrafast'
    }
  })

  pi.events.on('leyline:request-boundary-ready', () => {
    requestBoundaryAvailable = true
  })
  pi.events.on('leyline:provider-request', ({ model, options, ctx }) => {
    if (!requestBoundaryAvailable || !options.signal) return
    if (resetPending) disable(ctx)
    flushCleanup(ctx)
    headerRequest = undefined
    if (!available(ctx, model)) return
    const request = {
      model: { ...model, cost: { ...model.cost } },
      signal: options.signal,
      enabled: enabled && enabledModel?.provider === model.provider
        && enabledModel?.id === model.id,
    }
    headerRequest = request
    const onPayload = options.onPayload
    options.onPayload = async (payload, requestModel) => {
      const replacement = await onPayload?.(payload, requestModel)
      const current = replacement === undefined ? payload : replacement
      if (ctx.signal !== request.signal || requestModel.provider !== model.provider
        || requestModel.id !== model.id || current?.model !== model.id) return current
      request.tier = request.enabled ? 'ultrafast' : current.service_tier
      return request.enabled ? { ...current, service_tier: 'ultrafast' } : current
    }
    const onProviderStreamEvent = options.onProviderStreamEvent
    options.onProviderStreamEvent = async (data, requestModel) => {
      if (requestBoundaryAvailable && ctx.signal === request.signal
        && requestModel.provider === model.provider
        && requestModel.id === model.id
        && ['response.completed', 'response.done', 'response.incomplete'].includes(data?.type)
        && data.response?.id) {
        const tier = data.response.service_tier
        const ultrafast = tier === 'ultrafast'
          || (model.provider === 'openai-codex' && request.tier === 'ultrafast'
            && (!tier || tier === 'default'))
        if (ultrafast) {
          responses.set(data.response.id, request.model)
          if (responses.size > 16) responses.delete(responses.keys().next().value)
        }
      }
      await onProviderStreamEvent?.(data, requestModel)
    }
  })

  pi.on('message_end', ({ message }) => {
    if (message.role !== 'assistant') return
    headerRequest = undefined
    const model = responses.get(message.responseId)
    responses.delete(message.responseId)
    if (!model || message.provider !== model.provider || message.model !== model.id
      || !message.usage) return
    const usage = { ...message.usage, cost: { ...message.usage.cost } }
    calculateCost(model, usage)
    for (const key of Object.keys(usage.cost)) usage.cost[key] *= 6
    return { message: { ...message, usage } }
  })
}
