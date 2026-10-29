export const ULTRAFAST_COMMAND = 'leyline-ultrafast'
export const ULTRAFAST_STATUS_KEY = 'leyline-ultrafast'
export const SERVICE_TIER_COMMAND = 'leyline-service-tier'
export const SERVICE_TIER_STATUS_KEY = 'leyline-service-tier'
export const SERVICE_TIERS = ['standard', 'fast', 'ultrafast']

const FAST_MODEL_IDS = [
  'gpt-6-astra',
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
]

function supportsServiceTierApi(model) {
  return (model?.provider === 'openai' && model.api === 'openai-responses')
    || (model?.provider === 'openai-codex' && model.api === 'openai-codex-responses')
}

export function supportsUltrafast(model) {
  return ['gpt-6-astra', 'gpt-6.1-sol'].includes(model?.id) && supportsServiceTierApi(model)
}

export function supportsUltrafastWithAuth(model, subscription) {
  return supportsUltrafast(model) && !(model.provider === 'openai' && subscription)
}

export function supportedServiceTiers(model, subscription) {
  const tiers = ['standard']
  if (FAST_MODEL_IDS.includes(model?.id) && supportsServiceTierApi(model)
    && !(model.provider === 'openai' && subscription)) tiers.push('fast')
  if (supportsUltrafastWithAuth(model, subscription)) tiers.push('ultrafast')
  return tiers
}

export function serviceTierFromStatuses(statuses) {
  const tier = statuses?.[SERVICE_TIER_STATUS_KEY]
  if (SERVICE_TIERS.includes(tier)) return tier
  return statuses?.[ULTRAFAST_STATUS_KEY] === 'on' ? 'ultrafast' : 'standard'
}
