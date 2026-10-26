export const MAX_DICTATION_SECONDS = 300

export const DICTATION_MODELS = Object.freeze([
  Object.freeze({
    id: 'parakeet-unified-en',
    name: 'Parakeet Unified English',
    description: 'Local English speech recognition with buffered streaming.',
    bytes: 477274496,
    languageOptions: Object.freeze([Object.freeze({ value: 'en', label: 'English' })]),
    streaming: true,
    filename: 'parakeet-unified-en-0.6b-Q4_K_M.gguf',
    url: 'https://leyline.download/models/parakeet-unified-en/843b1b175ace04f5a89d379c79e2518c0d065b25/parakeet-unified-en-0.6b-Q4_K_M.gguf',
    fallbackUrls: Object.freeze([
      'https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/843b1b175ace04f5a89d379c79e2518c0d065b25/parakeet-unified-en-0.6b-Q4_K_M.gguf',
    ]),
    sha256: 'a8bf3de2b393bd14ead5a858c3748d5e3b07a20fdeabdd3b498fba4f463fa929',
    license: 'NVIDIA Open Model License',
    licenseUrl: 'https://leyline.download/models/parakeet-unified-en/843b1b175ace04f5a89d379c79e2518c0d065b25/LICENSE',
  }),
  Object.freeze({
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    description: 'Local multilingual speech recognition after recording stops.',
    bytes: 536069696,
    languageOptions: Object.freeze([
      Object.freeze({ value: 'en', label: 'English' }),
      Object.freeze({ value: 'auto', label: 'Detect language' }),
    ]),
    streaming: false,
    filename: 'whisper-large-v3-turbo-Q4_K_M.gguf',
    url: 'https://huggingface.co/handy-computer/whisper-large-v3-turbo-gguf/resolve/18ada752005f5fddef499256f9a458d0b37a203a/whisper-large-v3-turbo-Q4_K_M.gguf',
    sha256: 'c6e172d0074f0fa9440b88247854b50643cd4bb58b8515c797bbed16d858c7df',
    license: 'MIT',
    licenseUrl: 'https://huggingface.co/handy-computer/whisper-large-v3-turbo-gguf/tree/18ada752005f5fddef499256f9a458d0b37a203a',
  }),
])

export const DEFAULT_DICTATION_SETTINGS = Object.freeze({
  modelId: 'parakeet-unified-en',
  language: 'en',
  deviceId: '',
  mode: 'toggle',
  shortcut: Object.freeze({ code: 'KeyD', meta: true, ctrl: false, alt: false, shift: true }),
  keepModelWarm: true,
  idleMinutes: 5,
})

const shortcutKeys = ['code', 'meta', 'ctrl', 'alt', 'shift']
const settingKeys = Object.keys(DEFAULT_DICTATION_SETTINGS)
const keyCode = /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/

function knownObject(input, keys, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`Invalid ${label}`)
  }
  if (Object.keys(input).some(key => !keys.includes(key))) {
    throw new Error(`Unknown ${label} field`)
  }
}

export function getDictationModel(modelId) {
  return DICTATION_MODELS.find(model => model.id === modelId) || null
}

export function normalizeDictationShortcut(input = {}, platform = 'darwin') {
  knownObject(input, shortcutKeys, 'dictation shortcut')
  const shortcut = {
    ...DEFAULT_DICTATION_SETTINGS.shortcut,
    meta: platform === 'darwin',
    ctrl: platform !== 'darwin',
    ...input,
  }
  if (typeof shortcut.code !== 'string' || !keyCode.test(shortcut.code)) {
    throw new Error('Use a letter, number, punctuation key, or function key')
  }
  for (const key of shortcutKeys.slice(1)) {
    if (typeof shortcut[key] !== 'boolean') throw new Error('Invalid shortcut modifier')
  }
  const functionKey = /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(shortcut.code)
  if (!shortcut.meta && !shortcut.ctrl && !functionKey) {
    throw new Error('The dictation shortcut must use Control or Command')
  }
  if ((!shortcut.meta && !shortcut.ctrl && /^F(?:1|[3-9]|1[0-2])$/.test(shortcut.code))
    || (shortcut.alt && /^F(?:4|10)$/.test(shortcut.code))
    || (shortcut.meta && (functionKey || shortcut.code === 'Space'))
    || ((shortcut.meta || shortcut.ctrl) && (
      ['KeyA', 'KeyC', 'KeyE', 'KeyF', 'KeyH', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT', 'KeyV', 'KeyW', 'KeyX', 'KeyZ', 'Comma', 'Space', 'Backquote', 'Slash', 'Period'].includes(shortcut.code)
      || /^Digit[0-9]$/.test(shortcut.code)
      || ['F4', 'F5', 'F11', 'F12'].includes(shortcut.code)
    ))
    || ((shortcut.meta || shortcut.ctrl) && !shortcut.shift && !shortcut.alt && shortcut.code === 'KeyD')
    || (shortcut.ctrl && shortcut.alt && ['KeyB', 'KeyD', 'KeyL', 'KeyT', 'KeyU'].includes(shortcut.code))) {
    throw new Error('This shortcut conflicts with an application or system command')
  }
  return shortcut
}

export function validateDictationShortcut(shortcut, platform = 'darwin') {
  try {
    normalizeDictationShortcut(shortcut, platform)
    return ''
  } catch (error) {
    return error.message
  }
}

export function normalizeDictationSettings(input = {}, platform = 'darwin') {
  knownObject(input, settingKeys, 'dictation settings')
  const settings = { ...DEFAULT_DICTATION_SETTINGS, ...input }
  const model = getDictationModel(settings.modelId)
  if (!model) throw new Error('Unknown dictation model')
  if (!model.languageOptions.some(option => option.value === settings.language)) {
    throw new Error('The selected model does not support this language')
  }
  if (typeof settings.deviceId !== 'string' || settings.deviceId.length > 512) {
    throw new Error('Invalid microphone device')
  }
  if (!['toggle', 'hold'].includes(settings.mode)) throw new Error('Invalid dictation mode')
  if (typeof settings.keepModelWarm !== 'boolean') throw new Error('Invalid model warm setting')
  if (!Number.isInteger(settings.idleMinutes) || settings.idleMinutes < 0 || settings.idleMinutes > 60) {
    throw new Error('Model idle time must be an integer from 0 to 60 minutes')
  }
  settings.shortcut = normalizeDictationShortcut(input.shortcut, platform)
  return settings
}

export function formatDictationShortcut(shortcut, platform = 'darwin') {
  const value = normalizeDictationShortcut(shortcut, platform)
  const key = value.code.replace(/^Key|^Digit/, '')
  const label = { Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' }[key] || key
  return [value.ctrl && 'Ctrl', value.alt && (platform === 'darwin' ? 'Option' : 'Alt'), value.shift && 'Shift', value.meta && (platform === 'darwin' ? 'Command' : 'Meta'), label].filter(Boolean).join('+')
}
