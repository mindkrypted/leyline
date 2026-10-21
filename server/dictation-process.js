import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { getDictationModel, MAX_DICTATION_SECONDS } from '../lib/dictation.js'

const port = process.parentPort
if (!port && !process.send) throw new Error('Dictation must run as a child process')
const send = message => {
  if (port) port.postMessage(message)
  else if (process.connected) process.send(message, error => { if (error) process.exit(1) })
}

const sampleRate = 16000
const maxSamples = sampleRate * MAX_DICTATION_SECONDS
let binding
let model
let modelId = ''
let capture
let queue = Promise.resolve()
let queued = 0

async function nativeBinding() {
  if (binding) return binding
  const tuple = {
    'darwin-arm64': 'darwin-arm64-metal',
    'darwin-x64': 'darwin-x64-cpu',
    'linux-x64': 'linux-x64-cpu-vulkan',
    'linux-arm64': 'linux-arm64-cpu-vulkan',
    'win32-x64': 'win32-x64-cpu-vulkan',
  }[`${process.platform}-${process.arch}`]
  if (!tuple) throw new Error('Native dictation is not supported on this platform')
  const require = createRequire(import.meta.url)
  const directory = dirname(require.resolve(`@transcribe-cpp/${tuple}/package.json`))
    .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
  const library = join(directory, process.platform === 'darwin' ? 'libtranscribe.dylib' : process.platform === 'win32' ? 'transcribe.dll' : 'libtranscribe.so')
  if (!existsSync(library) || !existsSync(join(directory, 'contract.json'))) {
    throw new Error('Native dictation libraries are not installed')
  }
  process.env.TRANSCRIBE_LIBRARY = library
  binding = await import('transcribe-cpp')
  binding.setLogHandler(() => {})
  return binding
}

function releaseCapture() {
  if (!capture) return
  capture.abort.abort()
  capture.stream?.reset()
  capture.session?.dispose()
  capture.pcm = null
  capture = null
}

function hasSpeech(pcm, minimumVoicedSamples = sampleRate * 0.2) {
  let voiced = 0
  let peak = 0
  for (let offset = 0; offset < pcm.length; offset += 320) {
    const end = Math.min(offset + 320, pcm.length)
    let energy = 0
    for (let i = offset; i < end; i += 1) {
      energy += pcm[i] * pcm[i]
      peak = Math.max(peak, Math.abs(pcm[i]))
    }
    if (energy / (end - offset) >= 0.000036) voiced += end - offset
  }
  return peak >= 0.02 && voiced >= minimumVoicedSamples
}

async function start(input) {
  if (capture) throw new Error('Dictation is already active')
  const catalog = getDictationModel(input.settings.modelId)
  if (!catalog) throw new Error('Unknown dictation model')
  const native = await nativeBinding()
  if (modelId !== catalog.id) {
    model?.dispose()
    model = null
    modelId = ''
    model = await native.TranscribeModel.load(input.path, { backend: 'auto' })
    if (model.capabilities.nativeSampleRate !== sampleRate) {
      model.dispose()
      model = null
      throw new Error('The dictation model requires an unsupported sample rate')
    }
    modelId = catalog.id
  }
  capture = {
    id: input.captureId,
    settings: input.settings,
    pcm: new Float32Array(maxSamples),
    samples: 0,
    sequence: 0,
    stream: null,
    session: null,
    abort: new AbortController(),
  }
  if (catalog.streaming && model.capabilities.supportsStreaming) {
    try {
      capture.session = model.createSession()
      capture.stream = await capture.session.stream({
        language: input.settings.language,
        commitPolicy: 'stable_prefix',
        family: { kind: 'parakeet_buffered', leftMs: 5600, chunkMs: 1040, rightMs: 1040 },
      })
    } catch {
      capture.session?.dispose()
      capture.session = null
    }
  }
  return { modelId }
}

async function push(input) {
  if (!capture || input.captureId !== capture.id) throw new Error('Dictation capture is no longer active')
  const pcm = input.pcm
  if (!(pcm instanceof Float32Array) || !pcm.length || pcm.length > 16384
    || input.sequence !== capture.sequence || capture.samples + pcm.length > maxSamples) {
    throw new Error('Invalid dictation audio frame')
  }
  for (const sample of pcm) {
    if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('Invalid dictation audio sample')
  }
  capture.sequence += 1
  capture.pcm.set(pcm, capture.samples)
  capture.samples += pcm.length
  if (capture.stream) {
    try {
      await capture.stream.feed(pcm)
    } catch {
      capture.stream.reset()
      capture.session?.dispose()
      capture.stream = null
      capture.session = null
    }
  }
  return { sequence: input.sequence }
}

async function offline(pcm, current) {
  const nativeLimit = model.capabilities.maxAudioMs
  const chunkSeconds = Number.isFinite(nativeLimit) && nativeLimit > 0
    ? Math.min(30, nativeLimit / 1000) : 30
  const chunkSamples = Math.max(1, Math.floor(chunkSeconds * sampleRate))
  const parts = []
  for (let offset = 0; offset < pcm.length; offset += chunkSamples) {
    const chunk = pcm.subarray(offset, Math.min(offset + chunkSamples, pcm.length))
    if (!hasSpeech(chunk, 1)) continue
    const result = await model.transcribe(chunk, {
      language: current.settings.language,
      signal: current.abort.signal,
    })
    if (result.aborted || result.truncated) throw new Error('Dictation did not finish')
    parts.push(result.text.trim())
  }
  return parts.filter(Boolean).join(' ')
}

async function finish(input) {
  if (!capture || capture.id !== input.captureId) throw new Error('Dictation capture is no longer active')
  const current = capture
  try {
    const pcm = current.pcm.subarray(0, current.samples)
    current.pcm = null
    if (!hasSpeech(pcm)) return { text: '', modelId }
    let text = ''
    if (current.stream) {
      try {
        await current.stream.finalize()
        text = current.stream.snapshot.text.trim()
      } catch {
        text = ''
      } finally {
        current.stream.reset()
        current.session?.dispose()
        current.stream = null
        current.session = null
      }
    }
    if (!text) text = await offline(pcm, current)
    if (text.length > 100000) throw new Error('Dictation output is too large')
    return { text, modelId }
  } finally {
    releaseCapture()
  }
}

const operations = { start, push, finish }
const errors = {
  start: 'Could not load the native dictation model',
  push: 'Could not process dictation audio',
  finish: 'Could not transcribe dictation audio',
}

function receive(data) {
  if (!data || !Object.hasOwn(operations, data.operation) || typeof data.id !== 'string') return
  if (queued >= 8) {
    send({ id: data.id, error: 'Dictation audio queue is full' })
    return
  }
  queued += 1
  queue = queue.then(async () => {
    try {
      const value = await operations[data.operation](data.input)
      send({ id: data.id, value })
    } catch {
      send({ id: data.id, error: errors[data.operation] })
    } finally {
      queued -= 1
    }
  })
}

if (port) port.on('message', ({ data }) => receive(data))
else {
  process.on('message', receive)
  process.once('disconnect', () => process.exit(0))
}

send({ type: 'ready' })
