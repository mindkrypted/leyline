import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import {
  supportedServiceTiers,
  SERVICE_TIER_COMMAND,
  SERVICE_TIER_STATUS_KEY,
  SERVICE_TIERS,
  ULTRAFAST_COMMAND,
  ULTRAFAST_STATUS_KEY,
} from '../../../lib/ultrafast.js'

export default async function (pi) {
  const require = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'))
  const { calculateCost, cleanupSessionResources } = await import(pathToFileURL(require.resolve('@earendil-works/pi-ai', {
    conditions: new Set(['node', 'import']),
  })).href)
  let tier = 'standard'
  let tierModel
  let resetPending = false
  let cleanupPending = false
  let requestBoundaryAvailable = false
  let compacting = false
  let getProviderRequest
  let requests = new WeakMap()
  const responses = new Map()

  function availableTiers(ctx, model) {
    return supportedServiceTiers(model, model && ctx.modelRegistry.isUsingOAuth(model))
  }

  function publish(ctx) {
    ctx.ui.setStatus(SERVICE_TIER_STATUS_KEY, tier)
    ctx.ui.setStatus(ULTRAFAST_STATUS_KEY, tier === 'ultrafast' ? 'on' : 'off')
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
    const cleanup = tier !== 'standard' || tierModel
    tier = 'standard'
    tierModel = undefined
    resetPending = false
    publish(ctx)
    if (cleanup) requestCleanup(ctx)
  }

  function reset(_event, ctx) {
    requestCleanup(ctx)
    if (tier !== 'standard' && ctx.signal) {
      resetPending = true
      return
    }
    disable(ctx)
  }

  pi.on('session_start', (_event, ctx) => {
    tier = 'standard'
    tierModel = undefined
    resetPending = false
    cleanupPending = false
    compacting = false
    requests = new WeakMap()
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
    flushCleanup(ctx)
  })
  pi.on('agent_settled', (_event, ctx) => {
    if (resetPending) disable(ctx)
    flushCleanup(ctx)
  })
  pi.on('session_shutdown', () => {
    tier = 'standard'
    tierModel = undefined
    resetPending = false
    cleanupPending = false
    requestBoundaryAvailable = false
    compacting = false
    getProviderRequest = undefined
    requests = new WeakMap()
    responses.clear()
  })

  function setTier(nextTier, ctx) {
    if (!SERVICE_TIERS.includes(nextTier)) return
    if (nextTier === 'standard') {
      disable(ctx)
      return
    }
    if (!availableTiers(ctx, ctx.model).includes(nextTier)) return
    if (!requestBoundaryAvailable) {
      ctx.ui.notify('Service tiers require the Leyline request boundary.', 'warning')
      return
    }
    if (nextTier !== tier || tierModel?.provider !== ctx.model.provider
      || tierModel?.id !== ctx.model.id || tierModel?.api !== ctx.model.api) requestCleanup(ctx)
    tier = nextTier
    tierModel = { ...ctx.model }
    resetPending = false
    publish(ctx)
  }

  pi.registerCommand(SERVICE_TIER_COMMAND, {
    description: 'Set Standard, Fast, or Ultrafast from the Leyline composer',
    handler: async (args, ctx) => setTier(args, ctx),
  })
  pi.registerCommand(ULTRAFAST_COMMAND, {
    description: 'Set Ultrafast from the Leyline composer',
    handler: async (args, ctx) => {
      if (['on', 'off'].includes(args)) setTier(args === 'on' ? 'ultrafast' : 'standard', ctx)
    },
  })

  pi.on('cache_warming_decision', () => {
    if (tier !== 'standard') return { action: 'stop' }
  })

  pi.on('before_provider_headers', ({ headers }, ctx) => {
    const request = requests.get(getProviderRequest?.())
    if (!request || compacting || ctx.signal !== request.signal) return
    const { model, tier: requestTier } = request
    if (model.provider === 'openai-codex') {
      headers['x-codex-routing-hint'] = `model=${model.id}${requestTier === 'default' ? '' : `;tier=${requestTier}`}`
    } else if (model.id === 'gpt-6-astra') {
      headers['OpenAI-Service-Tier'] = requestTier === 'ultrafast' ? 'ultrafast' : null
    }
  })

  pi.events.on('leyline:request-boundary-ready', (currentRequest) => {
    getProviderRequest = currentRequest
    requestBoundaryAvailable = typeof currentRequest === 'function'
  })
  pi.events.on('leyline:provider-request', ({ model, options, ctx }) => {
    if (!requestBoundaryAvailable || !options.signal || ctx.signal !== options.signal || compacting) return
    if (resetPending) disable(ctx)
    flushCleanup(ctx)
    const tiers = availableTiers(ctx, model)
    if (tiers.length === 1) return
    const requestTier = tierModel?.provider === model.provider && tierModel?.id === model.id
      && tierModel?.api === model.api && tiers.includes(tier) ? tier : 'standard'
    const request = {
      model: { ...model, cost: { ...model.cost } },
      signal: options.signal,
      tier: requestTier === 'standard' ? 'default' : requestTier === 'fast' ? 'priority' : 'ultrafast',
    }
    requests.set(options, request)
    const onPayload = options.onPayload
    options.onPayload = async (payload, requestModel) => {
      const replacement = await onPayload?.(payload, requestModel)
      const current = replacement === undefined ? payload : replacement
      if (compacting || ctx.signal !== request.signal || requestModel.provider !== request.model.provider
        || requestModel.id !== request.model.id || requestModel.api !== request.model.api
        || current?.model !== request.model.id) return current
      return { ...current, service_tier: request.tier }
    }
    const onProviderStreamEvent = options.onProviderStreamEvent
    options.onProviderStreamEvent = async (data, requestModel) => {
      if (requestBoundaryAvailable && !compacting && ctx.signal === request.signal
        && requestModel.provider === request.model.provider
        && requestModel.id === request.model.id && requestModel.api === request.model.api
        && ['response.completed', 'response.done', 'response.incomplete'].includes(data?.type)
        && data.response?.id) {
        let responseTier = data.response.service_tier
        if (!responseTier || (responseTier === 'default' && request.model.provider === 'openai-codex')) {
          responseTier = request.model.provider === 'openai-codex' || request.tier === 'priority'
            ? request.tier : 'default'
        }
        if (['default', 'priority', 'fast', 'ultrafast'].includes(responseTier)) {
          const multiplier = responseTier === 'ultrafast' ? 6 : responseTier === 'default' ? 1
            : request.model.id === 'gpt-5.5' ? 2.5 : 2
          responses.set(data.response.id, { model: request.model, multiplier })
          if (responses.size > 16) responses.delete(responses.keys().next().value)
        }
      }
      await onProviderStreamEvent?.(data, requestModel)
    }
  })

  pi.on('message_end', ({ message }) => {
    if (message.role !== 'assistant') return
    const response = responses.get(message.responseId)
    responses.delete(message.responseId)
    if (!response || message.provider !== response.model.provider || message.model !== response.model.id
      || !message.usage) return
    const usage = { ...message.usage, cost: { ...message.usage.cost } }
    calculateCost(response.model, usage)
    for (const key of Object.keys(usage.cost)) usage.cost[key] *= response.multiplier
    return { message: { ...message, usage } }
  })
}
