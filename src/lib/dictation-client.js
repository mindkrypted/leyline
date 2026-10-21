const MAX_PENDING = 16
const MAX_BUFFERED_BYTES = 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const timeouts = { getState: 15000, start: 190000, pushAudio: 35000, finish: 130000 }

export function createDictationClient() {
  const pending = new Map()
  const listeners = new Set()
  let socket
  let connecting
  let stateRequest
  let capture
  let nextId = 0
  let closed = false

  function emit(value) {
    for (const listener of listeners) {
      try { listener(value) } catch {}
    }
  }

  function disconnect(cause, current = socket) {
    if (!current || socket !== current) return
    socket = undefined
    capture = undefined
    connecting?.reject(cause)
    connecting = undefined
    for (const call of pending.values()) {
      clearTimeout(call.timer)
      call.reject(cause)
    }
    pending.clear()
    try { current.close() } catch {}
    emit({ type: 'disconnect', error: cause.message })
  }

  function connect() {
    if (closed) return Promise.reject(new Error('The dictation connection is closed'))
    if (socket?.readyState === 1) return Promise.resolve(socket)
    if (connecting) return connecting.promise
    const url = new URL('/api/leyline/dictation', window.location.href)
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    let current
    try {
      current = new WebSocket(url.href)
    } catch {
      return Promise.reject(new Error('Could not connect to Leyline server dictation. Retry from Dictation settings.'))
    }
    socket = current
    let resolve
    let reject
    const promise = new Promise((done, fail) => { resolve = done; reject = fail })
    const timer = setTimeout(() => {
      disconnect(new Error('Leyline server dictation connection timed out. Retry from Dictation settings.'), current)
    }, 10000)
    connecting = {
      promise,
      reject: cause => { clearTimeout(timer); reject(cause) },
    }
    current.addEventListener('open', () => {
      if (socket !== current || closed) return
      clearTimeout(timer)
      connecting = undefined
      resolve(current)
    })
    current.addEventListener('message', event => {
      if (socket !== current || closed) return
      try {
        if (typeof event.data !== 'string' || event.data.length > MAX_BUFFERED_BYTES) throw new Error('Invalid dictation response')
        const frame = JSON.parse(event.data)
        if (frame?.type === 'state') {
          emit(frame.value)
          return
        }
        if (!Number.isInteger(frame?.id) || frame.id < 1 || frame.id > 0xffffffff
          || typeof frame.ok !== 'boolean') throw new Error('Invalid dictation response')
        const call = pending.get(frame.id)
        if (!call) return
        pending.delete(frame.id)
        clearTimeout(call.timer)
        if (frame.ok) call.resolve(frame.value)
        else call.reject(new Error(typeof frame.error === 'string' ? frame.error : 'Leyline server dictation failed'))
      } catch {
        disconnect(new Error('Leyline server dictation sent an invalid response. Retry from Dictation settings.'), current)
      }
    })
    const lost = () => disconnect(new Error('Leyline server dictation disconnected. The recording was cancelled. Retry to reconnect.'), current)
    current.addEventListener('error', lost)
    current.addEventListener('close', lost)
    return promise
  }

  function request(method, input, binary) {
    if (closed || !socket || socket.readyState !== 1) {
      return Promise.reject(new Error('Leyline server dictation is disconnected. Refresh Dictation settings to reconnect.'))
    }
    if (pending.size >= MAX_PENDING) return Promise.reject(new Error('Too many pending dictation requests'))
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      const cause = new Error('Dictation could not keep up with microphone audio. Retry the recording.')
      disconnect(cause)
      return Promise.reject(cause)
    }
    do { nextId = nextId >= 0xffffffff ? 1 : nextId + 1 } while (pending.has(nextId))
    const id = nextId
    const current = socket
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        disconnect(new Error('Leyline server dictation request timed out. Retry from Dictation settings.'), current)
      }, timeouts[method] || 30000)
      pending.set(id, { resolve, reject, timer })
      try {
        if (binary) {
          new DataView(binary).setUint32(0, id, true)
          current.send(binary)
        } else current.send(JSON.stringify({ id, method, input }))
      } catch {
        disconnect(new Error('Could not send audio or settings to Leyline server dictation.'), current)
      }
    })
  }

  function getState() {
    if (!stateRequest) {
      stateRequest = connect().then(() => request('getState')).finally(() => { stateRequest = undefined })
    }
    return stateRequest
  }

  async function start(input) {
    if (capture) throw new Error('A dictation capture is already active')
    const current = { requestId: input?.requestId, captureId: '', sequence: 0 }
    capture = current
    try {
      const result = await request('start', input)
      if (capture !== current) throw new Error('Dictation was cancelled')
      if (!UUID.test(result?.captureId) || result?.sampleRate !== 16000) {
        const cause = new Error('Leyline server dictation returned an invalid capture')
        disconnect(cause)
        throw cause
      }
      current.captureId = result.captureId
      return result
    } catch (cause) {
      if (capture === current) capture = undefined
      throw cause
    }
  }

  async function pushAudio(input) {
    const { captureId, sequence, pcm } = input || {}
    if (!capture?.captureId || capture.captureId !== captureId || !UUID.test(captureId)
      || !Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff || sequence !== capture.sequence
      || !(pcm instanceof Float32Array) || pcm.length < 1 || pcm.length > 16384) {
      throw new Error('Invalid dictation audio frame or sequence')
    }
    const binary = new ArrayBuffer(44 + pcm.length * 4)
    const view = new DataView(binary)
    view.setUint32(4, sequence, true)
    for (let index = 0; index < 36; index++) view.setUint8(8 + index, captureId.charCodeAt(index))
    for (let index = 0; index < pcm.length; index++) {
      if (!Number.isFinite(pcm[index]) || Math.abs(pcm[index]) > 1) throw new Error('Invalid dictation audio sample')
      view.setFloat32(44 + index * 4, pcm[index], true)
    }
    capture.sequence++
    return request('pushAudio', undefined, binary)
  }

  async function finish(id) {
    const current = capture
    if (!current?.captureId || current.captureId !== id) throw new Error('This recording is no longer available')
    const result = await request('finish', id)
    if (capture !== current) throw new Error('Dictation was cancelled')
    capture = undefined
    return result
  }

  async function cancel(input) {
    const current = capture
    if (!current) return
    if (!input || (!input.requestId && !input.captureId)
      || (input.requestId && input.requestId !== current.requestId)
      || (input.captureId && input.captureId !== current.captureId)) throw new Error('Dictation capture does not match')
    const connection = socket
    try {
      const result = await request('cancel', input)
      if (capture === current) capture = undefined
      return result
    } catch (cause) {
      if (socket !== connection || !connection) return
      const online = connection.readyState === 1
      disconnect(cause, connection)
      if (online) throw cause
    }
  }

  function pagehide() {
    disconnect(new Error('The dictation page was closed. The recording was cancelled.'))
  }

  window.addEventListener('pagehide', pagehide)

  return {
    getState,
    updateSettings: patch => request('updateSettings', patch),
    downloadModel: id => request('downloadModel', id),
    cancelDownload: id => request('cancelDownload', id),
    removeModel: id => request('removeModel', id),
    start, pushAudio, finish, cancel,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new Error('A dictation state handler is required')
      if (closed) return () => {}
      if (listeners.size >= 32) throw new Error('Too many dictation state subscriptions')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      if (closed) return
      closed = true
      window.removeEventListener('pagehide', pagehide)
      disconnect(new Error('The dictation connection was closed'))
      listeners.clear()
    },
  }
}
