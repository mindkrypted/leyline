import { backendWebSocketUrl } from './backend'

export function openEventSocket(path, { onOpen, onEvent, onDisconnect, onError } = {}) {
  const url = backendWebSocketUrl(path)
  let socket
  let closed = false
  let retryDelay = 1000
  let retryTimer
  let heartbeatTimer

  function retry() {
    if (closed) return
    retryTimer = setTimeout(connect, retryDelay + Math.random() * 500)
    retryDelay = Math.min(retryDelay * 2, 15000)
  }

  function disconnect(current) {
    if (closed || socket !== current) return
    socket = undefined
    clearTimeout(heartbeatTimer)
    current.close()
    retry()
    onDisconnect?.()
  }

  function watchHeartbeat(current, timeout = 65000) {
    clearTimeout(heartbeatTimer)
    heartbeatTimer = setTimeout(() => disconnect(current), timeout)
  }

  function connect() {
    if (closed) return
    let current
    try {
      current = new WebSocket(url)
    } catch {
      retry()
      onDisconnect?.()
      return
    }
    socket = current
    watchHeartbeat(current, 10000)

    current.addEventListener('open', () => {
      if (closed || socket !== current) return
      retryDelay = 1000
      watchHeartbeat(current)
      onOpen?.()
    })
    current.addEventListener('message', (event) => {
      if (closed || socket !== current) return
      watchHeartbeat(current)
      let frame
      try {
        frame = JSON.parse(event.data)
        if (typeof frame?.type !== 'string') throw new Error('Event type is missing')
      } catch (error) {
        onError?.(error)
        return
      }
      if (frame.type === 'ping') {
        if (current.readyState === WebSocket.OPEN) current.send('{"type":"pong"}')
        return
      }
      onEvent?.(frame.type, frame.data)
    })
    current.addEventListener('error', () => disconnect(current))
    current.addEventListener('close', () => disconnect(current))
  }

  connect()

  return {
    close() {
      if (closed) return
      closed = true
      clearTimeout(retryTimer)
      clearTimeout(heartbeatTimer)
      const current = socket
      socket = undefined
      current?.close()
    },
  }
}
