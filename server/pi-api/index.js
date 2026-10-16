import { backendConnectionsHandler, readNetworkAccessSetting } from '../backend-connections.js'
import { configureNetworkAccess, localServerUrl } from '../network-access.js'
import { createPiRuntimeApi } from './runtime.js'
import { createPiApiHandler } from './router.js'
import {
  configurePiWebSocketServer as configureTerminalWebSocketServer,
} from './terminal.js'

const runtime = createPiRuntimeApi()

export function piApi() {
  let closeNetworkAccess
  return {
    name: 'pi-api',
    closeBundle: () => Promise.all([closeNetworkAccess?.(), runtime.shutdownRuntime()]),
    configureServer(server) {
      configurePiWebSocketServer(server.httpServer)
      const protocol = server.config.server.https ? 'https' : 'http'
      closeNetworkAccess = configureNetworkAccess(server.httpServer, {
        enabled: readNetworkAccessSetting(),
        protocol,
      })
      server.httpServer.once('listening', () => {
        process.env.LEYLINE_SERVER_URL = localServerUrl(server.httpServer, protocol)
      })
      server.middlewares.use('/api/leyline', backendConnectionsHandler)
      server.middlewares.use('/api/pi', piApiHandler)
    },
  }
}

export function configurePiWebSocketServer(httpServer) {
  configureTerminalWebSocketServer(
    httpServer,
    runtime.activeRuntimeCwd,
    async (sessionId) => {
      const handle = await runtime.runtimeHandleForId(sessionId)
      return handle?.runtime.cwd
    },
  )
}

export const piApiHandler = createPiApiHandler(runtime)
export const shutdownPiRuntime = () => runtime.shutdownRuntime()
