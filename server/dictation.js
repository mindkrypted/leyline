import { randomUUID } from 'node:crypto'
import { getDictationModel, MAX_DICTATION_SECONDS, normalizeDictationSettings } from '../lib/dictation.js'
import { createDictationStorage } from './dictation-storage.js'
import { createSpeechProcess } from './dictation-worker.js'
const sampleRate = 16000
const maxSamples = sampleRate * MAX_DICTATION_SECONDS
const startupTimeout = 180000
const ingressTimeout = 120000
const finalizationTimeout = 120000
const maxStartRequests = 16384
const supported = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64'].includes(`${process.platform}-${process.arch}`)

function object(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !keys.includes(key))) throw new Error('Invalid dictation request')
}

function identifier(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

export function createDictationCore({ spawnWorker, validOwner, sameOwner = (a, b) => a === b, requestPermission = async () => {}, onState = () => {}, storageOptions }) {
  const removing = new Set()
  let lease
  let closed = false
  let closing
  let idleTimer
  let error = ''
  let engine = { status: 'idle', modelId: '', error: '' }
  const storage = createDictationStorage(broadcast, message => {
    error = message
    broadcast()
  }, storageOptions)
  const speech = createSpeechProcess(spawnWorker, message => {
    error = message
    engine = { status: 'error', modelId: engine.modelId, error: message }
    if (lease) void invalidate(lease)
    else void speech.stop().then(broadcast)
    broadcast()
  })

  function snapshot(owner) {
    return {
      supported,
      platform: process.platform,
      settings: storage.settings,
      models: storage.models(),
      engine: { ...engine },
      busy: Boolean(lease),
      owned: Boolean(lease && owner && sameOwner(lease.owner, owner)),
      error,
    }
  }

  function broadcast() {
    if (closed) return
    onState(snapshot)
  }

  async function initialize(owner) {
    if (!supported) throw new Error('Native dictation is not supported on this platform')
    await storage.initialize()
    await storage.refresh()
    if (closed || !validOwner(owner)) throw new Error('The dictation workspace is no longer available')
  }

  function assertLease(current) {
    if (closed || lease !== current || current.cancelled || !validOwner(current.owner)) {
      throw new Error('Dictation was cancelled')
    }
  }

  function isCurrent(current) {
    return !closed && lease === current && !current.cancelled && validOwner(current.owner)
  }

  function waitForLease(current, operation) {
    return new Promise((resolve, reject) => {
      const aborted = () => reject(new Error('Dictation was cancelled'))
      if (current.abort.signal.aborted) {
        operation.catch(() => {})
        aborted()
        return
      }
      current.abort.signal.addEventListener('abort', aborted, { once: true })
      operation.then(resolve, reject).finally(() => {
        current.abort.signal.removeEventListener('abort', aborted)
      })
    })
  }

  function ownedLease(owner, captureId) {
    if (!lease || lease.cancelled || !sameOwner(lease.owner, owner) || lease.captureId !== captureId) {
      throw new Error('This workspace does not own the dictation capture')
    }
    return lease
  }

  function scheduleIdle() {
    clearTimeout(idleTimer)
    if (closed || lease || engine.status !== 'ready') return
    const { keepModelWarm, idleMinutes, modelId } = storage.settings
    if (!keepModelWarm || modelId !== engine.modelId) {
      void unload()
    } else if (idleMinutes > 0) {
      idleTimer = setTimeout(() => { if (!lease) void unload() }, idleMinutes * 60000)
    }
  }

  async function unload() {
    clearTimeout(idleTimer)
    if (lease) return
    engine = { status: 'idle', modelId: '', error: '' }
    const stopped = speech.stop()
    broadcast()
    await stopped
  }

  function clearCaptureTimers(current) {
    clearTimeout(current.startupTimer)
    clearTimeout(current.ingressTimer)
    clearTimeout(current.recordingTimer)
  }

  function expireCapture(current, message) {
    if (lease !== current || current.cancelled) return
    error = message
    void invalidate(current)
  }

  function watchIngress(current) {
    clearTimeout(current.ingressTimer)
    current.ingressTimer = setTimeout(() => {
      expireCapture(current, 'Dictation stopped receiving audio or a finish request')
    }, ingressTimeout)
  }

  async function invalidate(current) {
    if (lease !== current) return
    if (current.cancelling) return current.cancelling
    current.cancelled = true
    current.abort.abort()
    current.phase = 'cancelling'
    clearCaptureTimers(current)
    current.cancelling = (async () => {
      try {
        if (current.purpose === 'dictation') {
          await speech.stop()
          if (engine.status !== 'error') engine = { status: 'idle', modelId: '', error: '' }
        }
      } finally {
        await current.modelLock?.release()
        current.modelLock = null
        if (lease === current) lease = null
        broadcast()
        scheduleIdle()
      }
    })()
    return current.cancelling
  }

  async function start(owner, input) {
    object(input, ['requestId', 'purpose'])
    if (!identifier(input.requestId) || !['dictation', 'test'].includes(input.purpose)) {
      throw new Error('Invalid dictation start request')
    }
    if (lease) throw new Error('Another dictation capture is already active')
    if (owner.requests.has(input.requestId)) throw new Error('This dictation request was already used')
    if (owner.requests.size >= maxStartRequests) {
      throw new Error('Dictation request limit reached. Reconnect or reload this workspace before recording again.')
    }
    owner.requests.add(input.requestId)
    const current = {
      owner,
      requestId: input.requestId,
      captureId: randomUUID(),
      purpose: input.purpose,
      phase: 'starting',
      sequence: 0,
      samples: 0,
      pending: 0,
      cancelled: false,
      abort: new AbortController(),
    }
    lease = current
    clearTimeout(idleTimer)
    current.startupTimer = setTimeout(() => {
      expireCapture(current, 'Dictation startup timed out')
    }, startupTimeout)
    error = ''
    broadcast()
    try {
      await waitForLease(current, initialize(owner))
      assertLease(current)
      current.settings = normalizeDictationSettings(storage.settings, process.platform)
      const model = getDictationModel(current.settings.modelId)
      if (current.purpose === 'dictation') {
        if (removing.has(model.id) || !storage.installed.has(model.id)) {
          throw new Error('Download the selected dictation model before recording')
        }
        await waitForLease(current, storage.modelLock(model, () => {
          expireCapture(current, 'The dictation model lock expired. Retry dictation.')
        }).then(async lock => {
          if (!isCurrent(current)) {
            await lock.release()
            throw new Error('Dictation was cancelled')
          }
          current.modelLock = lock
        }))
        assertLease(current)
        current.modelLock.check()
        const verified = await waitForLease(current, storage.verifyCached(model, current.abort.signal))
        assertLease(current)
        if (!verified) {
          storage.installed.delete(model.id)
          throw new Error('The local dictation model failed its integrity check. Remove it and download it again.')
        }
      }
      await waitForLease(current, requestPermission())
      assertLease(current)
      if (current.purpose === 'dictation') {
        current.modelLock.check()
        engine = { status: 'loading', modelId: model.id, error: '' }
        broadcast()
        await speech.request('start', {
          captureId: current.captureId,
          path: storage.path(model),
          settings: current.settings,
        }, 120000, () => isCurrent(current))
        assertLease(current)
        current.modelLock.check()
        await current.modelLock.release()
        current.modelLock = null
        assertLease(current)
        engine = { status: 'ready', modelId: model.id, error: '' }
      }
      assertLease(current)
      current.phase = 'recording'
      clearTimeout(current.startupTimer)
      current.recordingTimer = setTimeout(() => {
        expireCapture(current, 'Dictation did not receive a finish request before its watchdog expired')
      }, MAX_DICTATION_SECONDS * 1000 + ingressTimeout)
      watchIngress(current)
      broadcast()
      return { captureId: current.captureId, sampleRate }
    } catch (failure) {
      if (lease === current && !current.cancelled) {
        error = failure.message
        if (engine.status === 'loading') engine = { status: 'error', modelId: engine.modelId, error }
      }
      await invalidate(current)
      throw failure
    }
  }

  async function pushAudio(owner, input) {
    object(input, ['captureId', 'sequence', 'pcm'])
    const current = ownedLease(owner, input.captureId)
    if (current.phase !== 'recording' || current.purpose !== 'dictation') throw new Error('Dictation is not accepting audio')
    if (!(input.pcm instanceof Float32Array) || input.pcm.length < 1 || input.pcm.length > 16384
      || !Number.isSafeInteger(input.sequence) || input.sequence !== current.sequence) {
      throw new Error('Invalid dictation audio frame or sequence')
    }
    if (current.pending >= 4) throw new Error('Dictation audio queue is full')
    for (const sample of input.pcm) {
      if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('Invalid dictation audio sample')
    }
    const pcm = input.pcm.slice(0, Math.min(input.pcm.length, maxSamples - current.samples))
    current.sequence += 1
    current.samples += pcm.length
    watchIngress(current)
    if (!pcm.length) return { sequence: input.sequence }
    current.pending += 1
    try {
      const acknowledgement = await speech.request('push', { ...input, pcm }, 30000, () => isCurrent(current))
      assertLease(current)
      return acknowledgement
    } catch (failure) {
      if (lease === current && !current.cancelled) {
        error = failure.message
        engine = { status: 'error', modelId: engine.modelId, error }
        await invalidate(current)
      }
      throw failure
    } finally {
      current.pending -= 1
    }
  }

  async function finish(owner, captureId) {
    const current = ownedLease(owner, captureId)
    if (current.phase !== 'recording') throw new Error('Dictation is not ready to finish')
    clearCaptureTimers(current)
    current.phase = 'finishing'
    broadcast()
    try {
      const result = current.purpose === 'test'
        ? { text: '', modelId: current.settings.modelId }
        : await speech.request('finish', { captureId }, finalizationTimeout, () => isCurrent(current))
      assertLease(current)
      lease = null
      broadcast()
      scheduleIdle()
      return result
    } catch (failure) {
      if (lease === current && !current.cancelled) {
        error = failure.message
        engine = { status: 'error', modelId: engine.modelId, error }
        await invalidate(current)
      }
      throw failure
    }
  }

  async function cancel(owner, input) {
    object(input, ['requestId', 'captureId'])
    if ((!input.requestId && !input.captureId)
      || (input.requestId !== undefined && !identifier(input.requestId))
      || (input.captureId !== undefined && !identifier(input.captureId))) throw new Error('Invalid dictation cancellation')
    if (lease) {
      if (!sameOwner(lease.owner, owner)) throw new Error('This workspace does not own the dictation capture')
      if ((input.requestId && lease.requestId !== input.requestId)
        || (input.captureId && lease.captureId !== input.captureId)) throw new Error('Dictation capture does not match')
      await invalidate(lease)
    }
    return snapshot(owner)
  }

  const operations = {
    async getState(owner) {
      if (supported) await initialize(owner)
      return snapshot(owner)
    },
    async updateSettings(owner, patch) {
      object(patch, ['modelId', 'language', 'deviceId', 'mode', 'shortcut', 'keepModelWarm', 'idleMinutes'])
      if (patch.shortcut !== undefined) object(patch.shortcut, ['code', 'meta', 'ctrl', 'alt', 'shift'])
      if (lease) throw new Error('Stop dictation or the microphone test before changing dictation settings')
      await initialize(owner)
      if (lease) throw new Error('Stop dictation or the microphone test before changing dictation settings')
      storage.saveSettings(patch)
      scheduleIdle()
      broadcast()
      return snapshot(owner)
    },
    async downloadModel(owner, modelId) {
      await initialize(owner)
      const model = getDictationModel(modelId)
      if (!model) throw new Error('Unknown dictation model')
      if (removing.has(model.id)) throw new Error('The dictation model is being removed')
      error = ''
      storage.download(model)
      return snapshot(owner)
    },
    async cancelDownload(owner, modelId) {
      await initialize(owner)
      const model = getDictationModel(modelId)
      if (!model) throw new Error('Unknown dictation model')
      await storage.cancelDownload(model)
      return snapshot(owner)
    },
    async removeModel(owner, modelId) {
      await initialize(owner)
      const model = getDictationModel(modelId)
      if (!model) throw new Error('Unknown dictation model')
      if (removing.has(model.id)) throw new Error('The dictation model is being removed')
      if (lease && (lease.settings?.modelId === model.id || !lease.settings || engine.modelId === model.id)) {
        throw new Error('Stop dictation before removing its model')
      }
      removing.add(model.id)
      try {
        if (engine.modelId === model.id) await unload()
        await storage.remove(model)
      } finally {
        removing.delete(model.id)
        broadcast()
      }
      return snapshot(owner)
    },
    start, pushAudio, finish, cancel,
  }

  async function invoke(owner, method, input) {
    if (closed || !validOwner(owner)) throw new Error('The dictation workspace is no longer available')
    if (!Object.hasOwn(operations, method)) throw new Error('Unknown dictation method')
    return operations[method](owner, input)
  }

  function disconnect(owner) {
    if (lease && sameOwner(lease.owner, owner)) return invalidate(lease)
    return Promise.resolve()
  }

  function close() {
    if (closing) return closing
    closed = true
    clearTimeout(idleTimer)
    closing = (async () => {
      if (lease) await invalidate(lease)
      await speech.stop()
      await storage.close()
    })()
    return closing
  }

  return { invoke, snapshot, disconnect, close, get capture() { return lease } }
}
