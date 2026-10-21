import { DEFAULT_DICTATION_SETTINGS, DICTATION_MODELS } from '../../lib/dictation.js'

export const docsDictation = {
  supported: true,
  platform: 'darwin',
  settings: { ...DEFAULT_DICTATION_SETTINGS, shortcut: { ...DEFAULT_DICTATION_SETTINGS.shortcut } },
  models: DICTATION_MODELS.map(({ id, name, description, bytes, languageOptions, streaming, license, licenseUrl }) => ({
    id,
    name,
    description,
    bytes,
    languageOptions,
    streaming,
    license,
    licenseUrl,
    installed: id === DEFAULT_DICTATION_SETTINGS.modelId,
    downloading: false,
    progress: 0,
  })),
  engine: { status: 'ready', modelId: DEFAULT_DICTATION_SETTINGS.modelId, error: '' },
  busy: false,
  owned: false,
  processingLocation: 'server',
}

export const docsDictationClient = {
  engine: 'local',
  deviceId: '',
  mode: 'toggle',
  shortcut: { ...DEFAULT_DICTATION_SETTINGS.shortcut },
}

export const docsDictationMeters = Array.from({ length: 31 }, (_, index) => {
  const envelope = 0.5 + 0.5 * Math.sin(Math.PI * index / 30)
  const variation = 0.5 + 0.5 * Math.sin((index * 17 + 11) * 2.399963229728653)
  const rms = 0.025 + envelope * (0.008 + variation * 0.04)
  return { rms, peak: rms + 0.015 + variation * 0.06 }
})
