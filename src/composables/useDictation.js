import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { DEFAULT_DICTATION_SETTINGS, MAX_DICTATION_SECONDS, normalizeDictationSettings } from '../../lib/dictation.js'
import { createDictationAudio } from '../lib/dictation-audio.js'
import { createDictationClient } from '../lib/dictation-client.js'

const CLIENT_STORAGE_KEY = 'leyline.dictation.client.v1'
const clientSettingKeys = ['deviceId', 'mode', 'shortcut']
const hostSettingKeys = ['modelId', 'language', 'keepModelWarm', 'idleMinutes']

function readClientPreferences(platform, fallback = {}) {
  let stored
  try { stored = JSON.parse(window.localStorage.getItem(CLIENT_STORAGE_KEY)) } catch { stored = fallback }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {}
  const settings = normalizeDictationSettings({}, platform)
  for (const key of clientSettingKeys) {
    if (stored[key] === undefined) continue
    try { settings[key] = normalizeDictationSettings({ ...settings, [key]: stored[key] }, platform)[key] } catch {}
  }
  return {
    engine: ['browser', 'local'].includes(stored.engine) ? stored.engine : '',
    ...Object.fromEntries(clientSettingKeys.map(key => [key, settings[key]])),
  }
}

function browserRecognition() {
  if (window.leylineDictation || /\bElectron\//.test(navigator.userAgent)) return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function recognitionError(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone permission was denied'
  if (code === 'no-speech') return 'No speech was detected'
  if (code === 'audio-capture') return 'No microphone was found'
  if (code === 'network') return 'Browser speech recognition could not connect'
  return 'Browser speech recognition stopped'
}

export function useDictation(options) {
  const desktopBridge = window.leylineDictation
  const serverBridge = desktopBridge ? null : createDictationClient()
  const bridge = desktopBridge || serverBridge
  const platform = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform) ? 'darwin' : 'win32'
  const preferences = readClientPreferences(platform)
  const engine = ref(preferences.engine || (desktopBridge ? 'local' : 'browser'))
  const clientSettings = ref(Object.fromEntries(clientSettingKeys.map(key => [key, preferences[key]])))
  const desktopAvailable = computed(() => Boolean(desktopBridge))
  const browserAvailable = computed(() => Boolean(browserRecognition()))
  const settingsAvailable = computed(() => true)
  const connected = ref(false)
  const state = shallowRef(null)
  const localAvailable = computed(() => connected.value && state.value?.supported === true)
  const nativeAvailable = localAvailable
  const processingLocation = computed(() => desktopAvailable.value ? 'This device' : 'Leyline server')
  const phase = ref('idle')
  const sourceLabel = computed(() => phase.value === 'testing' ? 'Microphone test · This device' : engine.value === 'browser'
    ? 'Browser-managed speech recognition' : `Local dictation · ${processingLocation.value}`)
  const level = ref(0)
  const meter = shallowRef({ rms: 0, peak: 0 })
  const elapsed = ref(0)
  const error = ref('')
  const recoveryText = ref('')
  const finishingRequested = ref(false)
  const releasing = ref(false)
  const switchingEngine = ref(false)
  const changingSettings = ref(false)
  const inputs = ref([])
  const active = computed(() => ['preparing', 'listening', 'finishing', 'testing'].includes(phase.value))
  const clientBusy = computed(() => active.value || releasing.value || switchingEngine.value || changingSettings.value)
  const hostBusy = computed(() => connected.value && Boolean(state.value?.busy))
  const busy = computed(() => clientBusy.value || (engine.value === 'local' && hostBusy.value))
  const settings = computed(() => normalizeDictationSettings({
    ...(state.value?.settings || {}),
    ...(!desktopBridge ? clientSettings.value : {}),
  }, desktopBridge ? state.value?.platform || platform : platform))
  const models = computed(() => state.value?.models || [])
  const supported = computed(() => engine.value === 'browser' ? browserAvailable.value
    : state.value?.supported !== false && (desktopAvailable.value || typeof window.WebSocket === 'function'))
  const listening = computed(() => phase.value === 'listening')
  const buttonDisabled = computed(() => !supported.value || finishingRequested.value || releasing.value || switchingEngine.value || changingSettings.value
    || options.submitting?.() || (!active.value && !options.canStart()))
  const title = computed(() => {
    if (!supported.value) return 'Dictation is unavailable'
    if (phase.value === 'testing') return 'Stop microphone test · This device'
    if (active.value) return `${phase.value === 'finishing' ? 'Finishing dictation' : 'Finish dictation'} · ${sourceLabel.value}`
    if (engine.value === 'local' && !connected.value) return `Reconnect local dictation · ${processingLocation.value}`
    return engine.value === 'local' ? `Start local dictation · ${processingLocation.value}` : 'Start browser-managed speech recognition'
  })
  let operation = null
  let cleanup = null
  let unsubscribe
  let disposed = false
  let heldCode = ''
  let stateVersion = 0
  let settingsLoaded = false
  let errorVersion = 0
  let lastNativeError = ''
  let visibleNativeError = ''
  let ownerVersion = 0
  let recordingFailed = false
  let engineVersion = 0

  function currentClientPreferences() {
    return readClientPreferences(platform, { engine: engine.value, ...clientSettings.value })
  }

  function syncClientPreferences() {
    if (desktopBridge) return
    const latest = currentClientPreferences()
    clientSettings.value = Object.fromEntries(clientSettingKeys.map(key => [key, latest[key]]))
  }

  function saveClientPreferences(patch) {
    const next = { ...currentClientPreferences(), ...patch }
    try {
      window.localStorage.setItem(CLIENT_STORAGE_KEY, JSON.stringify(next))
    } catch {}
    if (!desktopBridge) clientSettings.value = Object.fromEntries(clientSettingKeys.map(key => [key, next[key]]))
  }

  async function setEngine(value) {
    if (!['browser', 'local'].includes(value) || disposed) return false
    const version = ++engineVersion
    switchingEngine.value = true
    try {
      await cancel()
      if (disposed || version !== engineVersion || cleanup || releasing.value) return false
      engine.value = value
      recordingFailed = false
      setError('')
      phase.value = 'idle'
      saveClientPreferences({ engine: value })
      if (value === 'local' && (!settingsLoaded || !connected.value)) void refresh()
      return !disposed && version === engineVersion
    } finally {
      if (version === engineVersion) switchingEngine.value = false
    }
  }

  function setError(message) {
    error.value = message
    errorVersion++
    visibleNativeError = ''
  }

  function snapshot(value, expectedErrorVersion = errorVersion, expectedEngineVersion = engineVersion) {
    const next = value?.state || value?.snapshot || value
    if (!next || typeof next.supported !== 'boolean' || !next.settings || disposed) return
    state.value = next
    connected.value = true
    stateVersion++
    const message = typeof next.error === 'string' ? next.error : ''
    const changed = message !== lastNativeError
    lastNativeError = message
    if (engine.value === 'local' && expectedEngineVersion === engineVersion && changed && message && expectedErrorVersion === errorVersion
      && (!error.value || error.value === visibleNativeError)) {
      setError(message)
      visibleNativeError = message
    }
  }

  async function refresh() {
    if (disposed) return state.value
    const version = stateVersion
    const errors = errorVersion
    const context = engineVersion
    const op = operation
    try {
      const next = await bridge.getState()
      if (!disposed && context === engineVersion) {
        if (version === stateVersion) snapshot(next, errors, context)
        settingsLoaded = connected.value
        return connected.value ? state.value : null
      }
      return null
    } catch (cause) {
      if (!disposed && context === engineVersion && operation === op && errors === errorVersion && version === stateVersion) {
        setError(cause.message || 'Dictation state is unavailable')
      }
      return null
    }
  }

  async function nativeAction(method, value) {
    if (disposed) return false
    const context = engineVersion
    const selectedEngine = engine.value
    const relevant = () => !disposed && context === engineVersion && selectedEngine === engine.value
    if ((!settingsLoaded || !connected.value) && !await refresh()) return false
    if (!relevant()) return false
    setError('')
    const errors = errorVersion
    const version = stateVersion
    try {
      const result = await bridge[method](value)
      if (version === stateVersion) snapshot(result, errors, context)
      return result
    } catch (cause) {
      if (relevant()) setError(cause.message || 'Dictation settings could not change')
      return false
    }
  }

  async function listInputs() {
    const errors = errorVersion
    const context = engineVersion
    const op = operation
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices()
      if (!disposed) inputs.value = (devices || []).filter(device => device.kind === 'audioinput').map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }))
    } catch (cause) {
      if (!disposed && context === engineVersion && operation === op && errors === errorVersion) setError(cause.message || 'Microphones could not be listed')
    }
    return inputs.value
  }

  function current(op) {
    return operation === op && !op.cancelled && !disposed
  }

  function cancelNative(op) {
    if (!op.bridge || !op.nativeStarted) return Promise.resolve()
    return Promise.resolve().then(() => op.bridge.cancel({
      requestId: op.requestId,
      ...(op.captureId ? { captureId: op.captureId } : {}),
    }))
  }

  function cancel(nextPhase = 'idle') {
    const op = operation
    heldCode = ''
    if (!op) return cleanup || Promise.resolve()
    operation = null
    op.cancelled = true
    op.cancelDone(false)
    clearInterval(op.clock)
    op.pending.length = 0
    try { op.recognition?.abort() } catch {}
    op.browserDone?.()
    finishingRequested.value = true
    phase.value = 'finishing'
    level.value = 0
    meter.value = { rms: 0, peak: 0 }
    elapsed.value = 0
    releasing.value = true
    const localReleased = Promise.resolve().then(() => op.audio?.cancel()).then(() => {
      releasing.value = false
    })
    const released = Promise.allSettled([localReleased, cancelNative(op)]).then(results => {
      const failure = results.find(result => result.status === 'rejected')
      if (failure) throw failure.reason
    })
    let timeout
    const pending = Promise.race([
      released,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Microphone cleanup timed out. Wait for cleanup before recording again.')), 3000)
      }),
    ]).catch(cause => {
      if (cleanup !== pending || disposed) return
      if (!error.value) setError(cause.message || 'Microphone cleanup failed')
      if (op.ownerVersion === ownerVersion) recordingFailed = true
      nextPhase = 'error'
    }).finally(() => {
      clearTimeout(timeout)
      if (cleanup !== pending) return
      cleanup = null
      finishingRequested.value = false
      if (!disposed) phase.value = nextPhase === 'error' && error.value && op.ownerVersion === ownerVersion ? 'error' : 'idle'
    })
    cleanup = pending
    return pending
  }

  function fail(op, cause) {
    if (!current(op)) return
    const text = op.finalText ?? op.text.join(' ')
    if (!op.committed && String(text || '').trim()) recoveryText.value = String(text)
    recordingFailed = true
    setError(cause.message || 'Dictation failed')
    void cancel('error')
  }

  function clock(op) {
    op.startedAt = performance.now()
    op.clock = setInterval(() => {
      if (!current(op)) return
      elapsed.value = Math.min(op.maxSeconds, (performance.now() - op.startedAt) / 1000)
      if (elapsed.value >= op.maxSeconds) {
        if (op.purpose === 'test') void stopTest()
        else void finish()
      }
    }, 100)
  }

  async function send(op) {
    if (op.sending) return op.sending
    op.sending = (async () => {
      while (current(op) && op.pending.length) {
        const pcm = op.pending.shift()
        await op.bridge.pushAudio({ captureId: op.captureId, sequence: op.sequence++, pcm })
      }
    })().catch(cause => fail(op, cause)).finally(() => {
      op.sending = null
      if (current(op) && op.pending.length) void send(op)
    })
    return op.sending
  }

  function enqueue(op, pcm) {
    if (!current(op) || op.purpose !== 'dictation') return
    if (op.pending.length >= 50) {
      fail(op, new Error('Dictation could not keep up with microphone audio. Please try again.'))
      return
    }
    op.pending.push(pcm)
    void send(op)
  }

  function startBrowser(op) {
    const Recognition = browserRecognition()
    if (!Recognition) throw new Error('Browser speech recognition is unavailable')
    const recognition = new Recognition()
    op.recognition = recognition
    op.browserEnd = new Promise(resolve => { op.browserDone = resolve })
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = op.browserLanguage
    recognition.onstart = () => {
      if (!current(op)) { recognition.abort(); return }
      if (phase.value !== 'finishing') phase.value = 'listening'
      clock(op)
    }
    recognition.onresult = event => {
      if (!current(op)) return
      for (let index = event.resultIndex; index < event.results.length; index++) {
        if (event.results[index].isFinal) op.text[index] = event.results[index][0]?.transcript || ''
      }
    }
    recognition.onerror = event => {
      if (current(op)) fail(op, new Error(recognitionError(event.error)))
    }
    recognition.onend = () => {
      op.browserEnded = true
      op.browserDone()
      if (current(op) && phase.value !== 'finishing') void finish()
    }
    recognition.start()
  }

  async function start(purpose = 'dictation') {
    if (disposed || operation || cleanup || releasing.value || switchingEngine.value || changingSettings.value || options.submitting?.()) return false
    syncClientPreferences()
    if (purpose === 'dictation' && (!supported.value || !options.canStart())) return false
    const captured = purpose === 'dictation' ? options.captureDraft() : null
    if (purpose === 'dictation' && !captured) return false
    const op = {
      purpose, captured, ownerVersion, pending: [], sequence: 0,
      maxSeconds: purpose === 'test' ? 10 : MAX_DICTATION_SECONDS, text: [],
      engine: engine.value,
      bridge: (desktopBridge && purpose === 'test') || (engine.value === 'local' && purpose === 'dictation') ? bridge : null,
      settings: { ...settings.value, shortcut: { ...settings.value.shortcut } },
      browserLanguage: navigator.language || 'en-US',
    }
    op.cancelledPromise = new Promise(resolve => { op.cancelDone = resolve })
    operation = op
    recordingFailed = false
    phase.value = 'preparing'
    setError('')
    level.value = 0
    meter.value = { rms: 0, peak: 0 }
    elapsed.value = 0
    const preparing = (async () => {
      if (window.isSecureContext === false) throw new Error('Microphone access requires HTTPS or localhost. Open Leyline over HTTPS to use dictation.')
      if (op.engine === 'browser' && purpose === 'dictation') {
        startBrowser(op)
        return
      }
      if (op.bridge) {
        if (!window.crypto?.randomUUID) throw new Error('Secure dictation identifiers are unavailable in this browser. Use HTTPS or localhost and a supported browser.')
        op.requestId = window.crypto.randomUUID()
        const available = await refresh()
        if (!current(op)) return
        if (!available) throw new Error(error.value || 'Dictation state is unavailable')
        op.settings = normalizeDictationSettings({
          ...op.settings,
          ...Object.fromEntries(hostSettingKeys.map(key => [key, available.settings[key]])),
        }, desktopBridge ? available.platform || platform : platform)
        if (available.supported === false) throw new Error('Local dictation is unavailable on this platform')
        if (available.busy) throw new Error('The microphone is still in use. Wait for cleanup and try again.')
        if (purpose === 'dictation' && !available.models?.some(model => model.id === op.settings.modelId && model.installed)) {
          void cancel()
          options.openSettings()
          return
        }
        op.nativeStarted = true
        const result = await op.bridge.start({ requestId: op.requestId, purpose })
        op.captureId = result.captureId
        if (!current(op)) { void cancelNative(op).catch(() => {}); return }
        if (result.sampleRate !== 16000) throw new Error('The dictation engine requires an unsupported sample rate')
      }
      op.audio = createDictationAudio({
        deviceId: op.settings.deviceId,
        maxSeconds: op.maxSeconds,
        onAudio: purpose === 'dictation' ? pcm => enqueue(op, pcm) : null,
        onLevel: (value, reading) => {
          if (!current(op)) return
          level.value = value
          meter.value = reading
        },
        onLimit: () => {
          if (!current(op)) return
          if (purpose === 'test') void stopTest()
          else void finish()
        },
        onError: cause => fail(op, cause),
      })
      if (!await op.audio.ready || !current(op)) return
      if (phase.value !== 'finishing') phase.value = purpose === 'test' ? 'testing' : 'listening'
      clock(op)
      void listInputs()
    })().catch(cause => fail(op, cause))
    op.ready = Promise.race([preparing, op.cancelledPromise])
    await op.ready
    return current(op)
  }

  function finish({ focusFrom } = {}) {
    const op = operation
    if (!op) return Promise.resolve(!cleanup && !recordingFailed)
    if (op.purpose === 'test') return stopTest().then(() => false)
    if (op.finishing) return op.finishing
    let restoreFocus = Boolean(focusFrom?.closest('form')?.contains(op.captured.input))
    const focusChanged = event => {
      if (event.target !== focusFrom && event.target !== document.body) restoreFocus = false
    }
    const focusMoved = () => { restoreFocus = false }
    if (restoreFocus) {
      document.addEventListener('focusin', focusChanged, true)
      document.addEventListener('pointerdown', focusMoved, true)
      window.addEventListener('blur', focusMoved)
    }
    finishingRequested.value = true
    const finishing = (async () => {
      await op.ready
      if (!current(op)) return false
      if (op.engine === 'local') {
        await new Promise(resolve => setTimeout(resolve, 200))
        if (!current(op)) return false
        const closed = op.audio.close()
        phase.value = 'finishing'
        await closed
        if (!current(op)) return false
        clearInterval(op.clock)
        level.value = 0
        meter.value = { rms: 0, peak: 0 }
        while (current(op) && (op.pending.length || op.sending)) await send(op)
        if (!current(op)) return false
        const result = await op.bridge.finish(op.captureId)
        if (!current(op)) return false
        op.finalText = result.text
      } else {
        phase.value = 'finishing'
        if (!op.browserEnded) op.recognition.stop()
        let timeout
        try {
          await Promise.race([
            op.browserEnd,
            op.cancelledPromise,
            new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('Browser speech recognition did not finish')), 5000) }),
          ])
        } finally { clearTimeout(timeout) }
        if (!current(op)) return false
        op.finalText = op.text.join(' ')
      }
      const cleaned = String(op.finalText || '').trim()
      if (!cleaned) throw new Error('No speech was detected. Your draft did not change.')
      if (!options.commitDraft(op.captured, cleaned, () => restoreFocus)) {
        throw new Error('The draft changed during dictation. The recognized text is saved for recovery; your draft did not change.')
      }
      op.committed = true
      operation = null
      clearInterval(op.clock)
      finishingRequested.value = false
      phase.value = 'idle'
      level.value = 0
      meter.value = { rms: 0, peak: 0 }
      heldCode = ''
      return true
    })().catch(cause => { fail(op, cause); return false })
    op.finishing = Promise.race([finishing, op.cancelledPromise]).finally(() => {
      document.removeEventListener('focusin', focusChanged, true)
      document.removeEventListener('pointerdown', focusMoved, true)
      window.removeEventListener('blur', focusMoved)
    })
    return op.finishing
  }

  function stopTest() {
    return operation?.purpose === 'test' ? cancel() : cleanup || Promise.resolve()
  }

  function toggle(intent) {
    if (cleanup || releasing.value || switchingEngine.value || changingSettings.value) return Promise.resolve(false)
    if (operation?.purpose === 'test') return stopTest()
    if (active.value) return finish(intent)
    return start()
  }

  function dismissError() {
    recordingFailed = false
    setError('')
    if (phase.value === 'error') phase.value = 'idle'
  }

  function dismissRecovery() {
    recoveryText.value = ''
  }

  function handleKeydown(event) {
    if (!supported.value || event.repeat || event.isComposing || !options.shortcutAllowed(event)) return false
    if (!operation) syncClientPreferences()
    const preferences = operation?.settings || settings.value
    const shortcut = preferences.shortcut
    if ((event.metaKey || event.ctrlKey) && event.code === 'KeyK') return false
    if (!shortcut || event.code !== shortcut.code || event.metaKey !== Boolean(shortcut.meta)
      || event.ctrlKey !== Boolean(shortcut.ctrl) || event.altKey !== Boolean(shortcut.alt)
      || event.shiftKey !== Boolean(shortcut.shift)) return false
    event.preventDefault()
    event.stopPropagation()
    if (heldCode || cleanup || releasing.value || switchingEngine.value || changingSettings.value || finishingRequested.value || options.submitting?.()) return true
    if (preferences.mode === 'hold') {
      heldCode = event.code
      if (!operation) void start()
    } else void toggle()
    return true
  }

  function handleKeyup(event) {
    if (!heldCode) return
    const shortcut = operation?.settings?.shortcut || settings.value.shortcut
    if (event.code === heldCode || !event.metaKey && shortcut.meta
      || !event.ctrlKey && shortcut.ctrl || !event.altKey && shortcut.alt
      || !event.shiftKey && shortcut.shift) {
      heldCode = ''
      if (operation?.purpose === 'dictation') void finish()
    }
  }

  function loseFocus() {
    if (operation) void cancel()
    heldCode = ''
  }

  function visibilityChanged() {
    if (document.hidden) loseFocus()
  }

  function focusChanged(event) {
    if (operation?.purpose === 'dictation' && !options.focusAllowed(event)) void cancel()
  }

  watch(options.owner, () => {
    ownerVersion++
    recordingFailed = false
    if (phase.value === 'error') phase.value = 'idle'
    void cancel()
  }, { flush: 'sync' })
  onMounted(() => {
    unsubscribe = bridge.subscribe(value => {
      if (value?.type === 'disconnect') {
        connected.value = false
        settingsLoaded = false
        if (state.value) state.value = { ...state.value, busy: null, owned: false }
        stateVersion++
        if (operation?.bridge === bridge) fail(operation, new Error(value.error || 'Local dictation disconnected'))
        else if (engine.value === 'local' && !disposed) setError(value.error || 'Local dictation disconnected')
        return
      }
      snapshot(value)
    })
    if (engine.value === 'local') void refresh()
    window.addEventListener('blur', loseFocus)
    window.addEventListener('pagehide', loseFocus)
    window.addEventListener('keyup', handleKeyup, true)
    document.addEventListener('visibilitychange', visibilityChanged)
    document.addEventListener('focusin', focusChanged)
  })
  onBeforeUnmount(() => {
    void cancel()
    disposed = true
    unsubscribe?.()
    serverBridge?.close()
    window.removeEventListener('blur', loseFocus)
    window.removeEventListener('pagehide', loseFocus)
    window.removeEventListener('keyup', handleKeyup, true)
    document.removeEventListener('visibilitychange', visibilityChanged)
    document.removeEventListener('focusin', focusChanged)
  })

  return {
    engine, setEngine, browserAvailable, settingsAvailable, localAvailable, desktopAvailable, processingLocation, sourceLabel,
    nativeAvailable, connected, state, phase, level, meter, elapsed, error, active, busy, clientBusy, hostBusy, releasing, settings, models, inputs,
    supported, listening, title, buttonDisabled, recoveryText, refresh, listInputs,
    updateSettings: async patch => {
      if (disposed) return false
      if (operation || cleanup || releasing.value || switchingEngine.value || changingSettings.value) {
        setError('Stop dictation before changing its settings')
        return false
      }
      changingSettings.value = true
      try {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)
          || Object.keys(patch).some(key => !Object.hasOwn(DEFAULT_DICTATION_SETTINGS, key))) throw new Error('Invalid dictation settings')
        if (patch.shortcut !== undefined && (!patch.shortcut || typeof patch.shortcut !== 'object' || Array.isArray(patch.shortcut))) {
          throw new Error('Invalid dictation shortcut')
        }
        syncClientPreferences()
        const next = normalizeDictationSettings({
          ...settings.value,
          ...patch,
          shortcut: patch.shortcut === undefined ? settings.value.shortcut : { ...settings.value.shortcut, ...patch.shortcut },
        }, platform)
        if ((platform !== 'darwin' && next.shortcut.meta)
          || ((next.shortcut.meta || next.shortcut.ctrl) && !next.shortcut.alt && ['KeyG', 'KeyY'].includes(next.shortcut.code))) {
          throw new Error('This shortcut conflicts with an application or system command')
        }
        if (desktopBridge) return await nativeAction('updateSettings', patch)
        const hostPatch = Object.fromEntries(hostSettingKeys.filter(key => Object.hasOwn(patch, key)).map(key => [key, next[key]]))
        if (Object.keys(hostPatch).length && !await nativeAction('updateSettings', hostPatch)) return false
        if (disposed) return false
        const clientPatch = Object.fromEntries(clientSettingKeys.filter(key => Object.hasOwn(patch, key)).map(key => [key, next[key]]))
        if (Object.keys(clientPatch).length) saveClientPreferences(clientPatch)
        if (!Object.keys(hostPatch).length) setError('')
        return true
      } catch (cause) {
        if (!disposed) setError(cause.message || 'Dictation settings could not change')
        return false
      } finally {
        changingSettings.value = false
      }
    },
    downloadModel: id => nativeAction('downloadModel', id),
    cancelDownload: id => nativeAction('cancelDownload', id),
    removeModel: id => nativeAction('removeModel', id),
    testMicrophone: () => start('test'), stopTest, toggle, finish, cancel, dismissError, dismissRecovery, handleKeydown,
  }
}
