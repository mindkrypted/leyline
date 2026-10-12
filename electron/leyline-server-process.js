import { startLeylineServer } from '../server/leyline-server.js'

const parentPort = process.parentPort
let leylineServer
let starting
let stopping

if (!parentPort) {
  throw new Error('Leyline backend must run as an Electron utility process')
}

parentPort.on('message', (event) => {
  if (event.data?.type !== 'close') return
  void stopServer().then(() => process.exit(0), error => {
    console.error('Could not stop the Leyline backend', error)
    process.exit(1)
  })
})

try {
  starting = startLeylineServer().then(server => { leylineServer = server })
  await starting
  if (!stopping) parentPort.postMessage({ type: 'ready', url: leylineServer.url })
} catch (error) {
  console.error('Could not start the Leyline backend', error)
  parentPort.postMessage({
    type: 'startup-error',
    message: 'Could not start the Leyline backend. Check the backend log.',
  })
  setTimeout(() => process.exit(1), 0)
}

function stopServer() {
  if (stopping) return stopping
  stopping = (async () => {
    await starting?.catch(() => {})
    if (!leylineServer) return
    const closing = leylineServer.close()
    leylineServer.server.closeAllConnections?.()
    await closing
  })()
  return stopping
}
