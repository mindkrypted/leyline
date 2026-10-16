import { createConnection, createServer } from 'node:net'
import { networkInterfaces } from 'node:os'

let binding

export function configureNetworkAccess(server, { enabled = false, protocol = 'http' } = {}) {
  const state = {
    server, protocol, listener: null, connections: new Set(), closing: new Set(),
    pending: Promise.resolve(), closed: false, error: '',
  }
  binding = state
  const restore = () => {
    if (enabled && !state.closed) void change(state, () => startListener(state)).catch(() => {})
  }
  if (server.listening) restore()
  else server.once('listening', restore)
  server.once('close', () => { void closeBinding(state) })
  return () => {
    server.off('listening', restore)
    return closeBinding(state)
  }
}

export async function networkAccessStatus() {
  const state = binding
  await state?.pending
  return statusFor(state)
}

export function setNetworkAccess(enabled, persist, response) {
  const state = binding
  if (!state) return Promise.reject(new Error('Network access is unavailable'))
  return change(state, async () => {
    if (state.closed || !state.server.listening) throw new Error('The local server is unavailable')
    if (enabled) {
      const wasEnabled = !!state.listener
      await startListener(state)
      try {
        persist()
      } catch (error) {
        if (!wasEnabled) await stopListener(state)
        throw error
      }
    } else {
      persist()
      await stopListener(state, response)
    }
    state.error = ''
    return statusFor(state)
  })
}

function change(state, action) {
  const result = state.pending.then(action)
  state.pending = result.catch((error) => { state.error = error.message })
  return result
}

function statusFor(state) {
  const origin = state?.server.address()
  const address = state?.listener?.address()
  const enabled = !!address && typeof address === 'object'
  const hosts = enabled ? Object.values(networkInterfaces()).flat()
    .filter((item) => item?.family === 'IPv4' && !item.internal)
    .map((item) => item.address) : []
  return {
    available: !!origin && typeof origin === 'object' && !state.closed,
    enabled,
    port: enabled ? address.port : null,
    urls: [...new Set(hosts)].map((host) => `${state.protocol}://${host}:${address.port}`),
    directAccess: !!origin && typeof origin === 'object'
      && origin.address !== '::1' && !origin.address.replace(/^::ffff:/, '').startsWith('127.'),
    error: state?.error || '',
  }
}

async function startListener(state) {
  if (state.closed) throw new Error('Network access is closed')
  if (state.listener) return
  const address = state.server.address()
  if (!address || typeof address !== 'object') throw new Error('The local server is unavailable')
  const host = localHost(address.address)
  const listener = createServer({ allowHalfOpen: true, pauseOnConnect: true }, (client) => {
    if (state.closed || state.listener !== listener) return client.destroy()
    const upstream = createConnection({ host, port: address.port, allowHalfOpen: true })
    const connection = { client, upstream, listener, close }
    function close() {
      client.destroy()
      upstream.destroy()
      state.connections.delete(connection)
    }
    state.connections.add(connection)
    client.setNoDelay(true)
    upstream.setNoDelay(true)
    upstream.setTimeout(10000, close)
    upstream.once('connect', () => upstream.setTimeout(0))
    client.on('error', close)
    upstream.on('error', close)
    client.once('close', close)
    upstream.once('close', () => {
      if (upstream.readableEnded) client.end()
      else close()
    })
    client.pipe(upstream).pipe(client)
  })
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '0.0.0.0', () => {
      listener.off('error', reject)
      resolve()
    })
  })
  state.listener = listener
  listener.on('error', (error) => {
    state.error = error.message
    if (state.listener === listener) void stopListener(state)
  })
  if (state.closed || !state.server.listening) {
    await stopListener(state)
    throw new Error('The local server is unavailable')
  }
}

function stopListener(state, response) {
  const listener = state.listener
  if (!listener) return Promise.resolve()
  state.listener = null
  const socket = response?.req?.socket ?? response?.socket
  const caller = socket && !response.destroyed && [...state.connections].find(({ upstream, listener: owner }) => {
    return owner === listener && upstream.localPort === socket.remotePort && upstream.localAddress === socket.remoteAddress
  })
  const closing = new Promise((resolve) => listener.close(resolve))
  state.closing.add(closing)
  void closing.then(() => state.closing.delete(closing))
  for (const connection of state.connections) {
    if (connection.listener !== listener) continue
    if (connection !== caller) connection.close()
  }
  if (!caller) return closing
  if (response.req?.httpVersionMajor !== 2) response.setHeader('Connection', 'close')
  const timeout = setTimeout(caller.close, 1000)
  timeout.unref()
  caller.client.once('close', () => clearTimeout(timeout))
  return Promise.resolve()
}

function closeBinding(state) {
  if (state.disposing) return state.disposing
  state.closed = true
  state.disposing = state.pending.then(async () => {
    const closing = stopListener(state)
    for (const connection of state.connections) connection.close()
    await closing
    await Promise.all(state.closing)
    if (binding === state) binding = undefined
  })
  return state.disposing
}

function localHost(host) {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '::1'
  return host
}

export function localServerUrl(server, protocol = 'http') {
  const address = server.address()
  const host = localHost(address.address)
  return `${protocol}://${host.includes(':') ? `[${host}]` : host}:${address.port}`
}
