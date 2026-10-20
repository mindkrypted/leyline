import { createConnection, createServer } from 'node:net'
import { networkInterfaces } from 'node:os'

let binding

export function configureNetworkAccess(server, { enabled = false, port = 0, protocol = 'http', persist } = {}) {
  const state = {
    server, protocol, persist, configuredPort: port, listener: null, connections: new Set(), closing: new Set(),
    pending: Promise.resolve(), closed: false, error: '',
  }
  binding = state
  const restore = () => {
    if (enabled && !state.closed) void change(state, async () => {
      state.listener = await startListener(state, port)
    }).catch(() => {})
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

export function setNetworkAccess({ enabled, port }, response) {
  const state = binding
  if (!state) return Promise.reject(new Error('Network access is unavailable'))
  return change(state, async () => {
    if (state.closed || !state.server.listening) throw new Error('The local server is unavailable')
    const configuredPort = port ?? state.configuredPort
    const previous = state.listener
    const nextEnabled = enabled ?? !!previous
    let listener = previous
    if (nextEnabled && (!listener || (configuredPort !== state.configuredPort && configuredPort !== listener.address()?.port))) {
      listener = await startListener(state, configuredPort)
    }
    try {
      state.persist({ enabled: nextEnabled, port: configuredPort })
    } catch (error) {
      if (listener !== previous) await stopListener(state, listener)
      throw error
    }
    state.configuredPort = configuredPort
    state.listener = nextEnabled ? listener : null
    if (previous && previous !== state.listener) await stopListener(state, previous, response)
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
    configuredPort: state?.configuredPort ?? 0,
    urls: [...new Set(hosts)].map((host) => `${state.protocol}://${host}:${address.port}`),
    directAccess: !!origin && typeof origin === 'object'
      && origin.address !== '::1' && !origin.address.replace(/^::ffff:/, '').startsWith('127.'),
    error: state?.error || '',
  }
}

async function startListener(state, port) {
  if (state.closed) throw new Error('Network access is closed')
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
    const failed = (error) => {
      if (error.code === 'EADDRINUSE') reject(new Error(`Port ${port} is already in use.`))
      else if (error.code === 'EACCES') reject(new Error(`Permission denied for port ${port}.`))
      else reject(error)
    }
    listener.once('error', failed)
    listener.listen(port, '0.0.0.0', () => {
      listener.off('error', failed)
      resolve()
    })
  })
  listener.on('error', (error) => {
    if (state.listener !== listener) return
    state.error = error.message
    void stopListener(state, listener)
  })
  if (state.closed || !state.server.listening) {
    await stopListener(state, listener)
    throw new Error('The local server is unavailable')
  }
  return listener
}

function stopListener(state, listener = state.listener, response) {
  if (!listener) return Promise.resolve()
  if (state.listener === listener) state.listener = null
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
