const { contextBridge, ipcRenderer } = require('electron')

const prefix = 'leyline:dictation:'
const subscribers = new Set()

async function invoke(method, input) {
  let response
  try {
    response = await ipcRenderer.invoke(`${prefix}${method}`, input)
  } catch {
    throw new Error('The native dictation bridge is unavailable')
  }
  if (!response?.ok) throw new Error(response?.error || 'Dictation failed')
  return response.value
}

ipcRenderer.on(`${prefix}state`, (_event, state) => {
  for (const handler of subscribers) {
    try { handler(state) } catch {}
  }
})

contextBridge.exposeInMainWorld('leylineDevTools', Object.freeze({
  inspectElement(x, y) {
    const point = { x: Math.round(Number(x)), y: Math.round(Number(y)) }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    ipcRenderer.send('leyline:devtools:inspect-element', point)
  },
}))

contextBridge.exposeInMainWorld('leylineDictation', Object.freeze({
  getState: () => invoke('getState'),
  updateSettings: patch => invoke('updateSettings', patch),
  downloadModel: modelId => invoke('downloadModel', modelId),
  cancelDownload: modelId => invoke('cancelDownload', modelId),
  removeModel: modelId => invoke('removeModel', modelId),
  start: input => invoke('start', input),
  async pushAudio(input) {
    if (!input || !(input.pcm instanceof Float32Array) || input.pcm.length < 1 || input.pcm.length > 16384) {
      throw new Error('Invalid dictation audio frame')
    }
    return invoke('pushAudio', input)
  },
  finish: captureId => invoke('finish', captureId),
  cancel: input => invoke('cancel', input),
  subscribe(handler) {
    if (typeof handler !== 'function') throw new Error('A dictation state handler is required')
    if (subscribers.size >= 32) throw new Error('Too many dictation state subscriptions')
    subscribers.add(handler)
    return () => subscribers.delete(handler)
  },
}))
