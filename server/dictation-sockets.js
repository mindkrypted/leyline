import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { createDictationCore } from './dictation.js'

const endpoint = '/api/leyline/dictation'
const processPath = fileURLToPath(new URL('./dictation-process.js', import.meta.url))
const methods = new Set(['getState', 'updateSettings', 'downloadModel', 'cancelDownload', 'removeModel', 'start', 'finish', 'cancel'])
const hostKeys = ['modelId', 'language', 'keepModelWarm', 'idleMinutes']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bindings = new WeakMap()

function normalizedOrigin(value) {
  try {
    const input = value.trim()
    if (input.includes('*') || !/^https?:\/\/[^/\\?#@\s]+\/?$/i.test(input)) return ''
    return new URL(input).origin
  } catch {
    return ''
  }
}

function requestOriginAllowed(req, protocol) {
  try {
    const host = req.headers.host
    const originHeader = req.headers.origin
    if (typeof host !== 'string' || typeof originHeader !== 'string' || /[/\\?#@\s]/.test(host)) return false
    const expected = new URL(`${protocol || (req.socket.encrypted ? 'https' : 'http')}://${host}`)
    const origin = normalizedOrigin(originHeader)
    if (!origin || origin !== originHeader) return false
    if (origin === expected.origin) return true
    return String(process.env.LEYLINE_SERVER_ALLOWED_ORIGINS || '')
      .split(',')
      .some(value => normalizedOrigin(value) === origin)
  } catch {
    return false
  }
}

function requestId(id) {
  return Number.isInteger(id) && id > 0 && id <= 0xffffffff
}

export function configureDictationWebSocketServer(httpServer, { protocol } = {}) {
  if (bindings.has(httpServer)) return bindings.get(httpServer)
  const server = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false })
  const owners = new Map()
  const cleanups = new Set()
  let core
  let closed = false
  let closing
  let pendingCount = 0

  const snapshot = value => ({ ...value, processingLocation: 'server' })

  function send(ws, value) {
    if (ws.readyState !== WebSocket.OPEN) return
    if (ws.bufferedAmount > 512 * 1024) return ws.terminate()
    try {
      ws.send(JSON.stringify(value), error => { if (error) ws.terminate() })
    } catch {
      ws.terminate()
    }
  }

  function service() {
    if (closed) throw new Error('Dictation is shutting down')
    if (!core) core = createDictationCore({
      spawnWorker: () => fork(processPath, [], {
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        execArgv: [],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      }),
      validOwner: owner => !closed && owner.active && owners.get(owner.ws) === owner,
      storageOptions: { host: true },
      onState(getSnapshot) {
        for (const [ws, owner] of owners) {
          if (owner.active) send(ws, { type: 'state', value: snapshot(getSnapshot(owner)) })
        }
      },
    })
    return core
  }

  function disconnect(owner) {
    if (owner.cleanup) return owner.cleanup
    owner.active = false
    for (const id of owner.pending) {
      send(owner.ws, { id, ok: false, error: 'The dictation connection closed' })
    }
    pendingCount -= owner.pending.size
    owner.pending.clear()
    owner.cleanup = (core?.disconnect(owner) || Promise.resolve()).finally(() => {
      owners.delete(owner.ws)
      cleanups.delete(owner.cleanup)
    })
    cleanups.add(owner.cleanup)
    return owner.cleanup
  }

  function audio(owner, data) {
    if (data.length < 48 || (data.length - 44) % 4 || data.length > 44 + 16384 * 4) {
      throw new Error('Invalid dictation audio frame')
    }
    const captureId = data.toString('utf8', 8, 44)
    const sequence = data.readUInt32LE(4)
    if (!uuid.test(captureId)) throw new Error('Invalid dictation capture identifier')
    const current = core?.capture
    if (!current || current.owner !== owner || current.captureId !== captureId || current.cancelled) {
      throw new Error('This connection does not own the dictation capture')
    }
    if (current.phase !== 'recording' || sequence !== current.sequence) throw new Error('Invalid dictation audio sequence')
    const pcm = new Float32Array((data.length - 44) / 4)
    for (let index = 0; index < pcm.length; index += 1) {
      const value = data.readFloatLE(44 + index * 4)
      if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error('Invalid dictation audio sample')
      pcm[index] = value
    }
    return service().invoke(owner, 'pushAudio', { captureId, sequence, pcm })
  }

  async function command(owner, method, input) {
    const current = service()
    if (method === 'updateSettings') {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !hostKeys.includes(key))) {
        throw new Error('Browser dictation can update only host model settings')
      }
    }
    if (method === 'start') {
      const settings = current.snapshot(owner).settings
      if (!owner.settings || settings.modelId !== owner.settings.modelId || settings.language !== owner.settings.language) {
        throw new Error('Dictation settings changed. Get the current state before recording.')
      }
    }
    const value = await current.invoke(owner, method, input)
    if (method === 'getState' || method === 'updateSettings') owner.settings = { ...value.settings }
    return ['getState', 'updateSettings', 'downloadModel', 'cancelDownload', 'removeModel', 'cancel'].includes(method)
      ? snapshot(value) : value
  }

  async function receive(owner, data, binary) {
    if (!owner.active || closed) return
    let id
    let method
    let input
    try {
      if (binary) {
        if (data.length < 4) throw new Error('Invalid dictation audio frame')
        id = data.readUInt32LE(0)
      } else {
        const message = JSON.parse(data.toString('utf8'))
        if (!message || typeof message !== 'object' || Array.isArray(message)
          || Object.keys(message).some(key => !['id', 'method', 'input'].includes(key))) {
          throw new Error('Invalid dictation command')
        }
        id = message.id
        method = message.method
        input = message.input
      }
      if (!requestId(id) || owner.pending.has(id)) {
        owner.ws.close(1008, 'Invalid or duplicate dictation request identifier')
        void disconnect(owner)
        return
      }
      if (!binary && !methods.has(method)) throw new Error('Unknown dictation method')
      if (owner.pending.size >= 16 || pendingCount >= 128) throw new Error('Too many pending dictation commands')
    } catch (failure) {
      if (requestId(id)) send(owner.ws, { id, ok: false, error: failure.message || 'Invalid dictation command' })
      else {
        owner.ws.close(1008, 'Invalid dictation command')
        void disconnect(owner)
      }
      return
    }
    owner.pending.add(id)
    pendingCount += 1
    try {
      const value = await (binary ? audio(owner, data) : command(owner, method, input))
      if (owner.active) send(owner.ws, { id, ok: true, value })
    } catch (failure) {
      if (owner.active) send(owner.ws, { id, ok: false, error: failure.message || 'Dictation failed' })
    } finally {
      if (owner.pending.delete(id)) pendingCount -= 1
    }
  }

  function upgrade(req, socket, head) {
    let pathname
    try { pathname = new URL(req.url, 'http://localhost').pathname } catch { return }
    if (pathname !== endpoint) return
    const destroySocket = () => socket.destroy()
    socket.on('error', destroySocket)
    if (!requestOriginAllowed(req, protocol)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n', destroySocket)
      return
    }
    if (closed || owners.size >= 16) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n', destroySocket)
      return
    }
    server.handleUpgrade(req, socket, head, ws => {
      const owner = { ws, active: true, alive: true, requests: new Set(), pending: new Set() }
      owners.set(ws, owner)
      ws.on('error', () => { void disconnect(owner); ws.terminate() })
      ws.once('close', () => { void disconnect(owner) })
      ws.on('pong', () => { owner.alive = true })
      ws.on('message', (data, binary) => { void receive(owner, data, binary) })
    })
  }

  httpServer.on('upgrade', upgrade)
  const heartbeat = setInterval(() => {
    for (const [ws, owner] of owners) {
      if (!owner.active || !owner.alive || ws.readyState !== WebSocket.OPEN) {
        void disconnect(owner)
        ws.terminate()
        continue
      }
      owner.alive = false
      ws.ping(undefined, undefined, error => { if (error) ws.terminate() })
    }
  }, 30000)
  heartbeat.unref()

  function close() {
    if (closing) return closing
    closed = true
    clearInterval(heartbeat)
    httpServer.off('upgrade', upgrade)
    httpServer.off('close', close)
    closing = (async () => {
      const sockets = []
      for (const [ws, owner] of owners) {
        void disconnect(owner)
        sockets.push(new Promise(resolve => {
          const timer = setTimeout(() => { ws.terminate(); resolve() }, 1000)
          ws.once('close', () => { clearTimeout(timer); resolve() })
          ws.close(1001, 'Dictation service closed')
        }))
      }
      await Promise.allSettled([core?.close(), ...cleanups, ...sockets])
      await new Promise(resolve => server.close(resolve))
    })()
    return closing
  }

  bindings.set(httpServer, close)
  httpServer.once('close', close)
  return close
}
