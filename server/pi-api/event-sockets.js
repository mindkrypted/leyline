import { WebSocket, WebSocketServer } from 'ws'
import { requestOriginAllowed } from './cors.js'

const HEARTBEAT_INTERVAL_MS = 30000

export function configureEventWebSocketServer(httpServer, api) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  let closed = false

  function upgrade(req, socket, head) {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/pi/events'
      && url.pathname !== '/api/pi/review/events') return
    if (!requestOriginAllowed(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const cwd = url.searchParams.get('cwd')
    if (url.pathname === '/api/pi/review/events' && !cwd) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      return
    }

    server.handleUpgrade(req, socket, head, (ws) => {
      ws.alive = true
      ws.on('error', () => ws.terminate())
      ws.on('message', (message) => {
        if (message.toString() === '{"type":"pong"}') ws.alive = true
      })
      try {
        if (url.pathname === '/api/pi/events') api.openEventStream(req, ws)
        else api.openGitReviewEventStream(cwd, ws)
      } catch {
        ws.close(1011, 'Event stream failed')
      }
    })
  }

  httpServer.on('upgrade', upgrade)
  const heartbeat = setInterval(() => {
    for (const ws of server.clients) {
      if (!ws.alive || ws.readyState !== WebSocket.OPEN) {
        ws.terminate()
        continue
      }
      ws.alive = false
      ws.send('{"type":"ping"}', (error) => {
        if (error) ws.terminate()
      })
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref?.()

  function close() {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    httpServer.off('upgrade', upgrade)
    httpServer.off('close', close)
    for (const ws of server.clients) ws.terminate()
    server.close()
  }

  httpServer.once('close', close)
  return close
}
