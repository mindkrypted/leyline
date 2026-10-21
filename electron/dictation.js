import { fileURLToPath } from 'node:url'
import { ipcMain, systemPreferences, utilityProcess } from 'electron'
import { createDictationCore } from '../server/dictation.js'

const processPath = fileURLToPath(new URL('./dictation-process.js', import.meta.url))
const prefix = 'leyline:dictation:'
const methods = ['getState', 'updateSettings', 'downloadModel', 'cancelDownload', 'removeModel', 'start', 'pushAudio', 'finish', 'cancel']

function normalizeOrigin(value) {
  try {
    const origin = new URL(value).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

export function createDictationService(isWorkspaceUrl) {
  const windows = new Map()
  const sessions = new Set()
  let closed = false
  let closing
  const core = createDictationCore({
    spawnWorker: () => utilityProcess.fork(processPath, [], {
      serviceName: 'Leyline Dictation',
      stdio: 'ignore',
    }),
    validOwner,
    sameOwner: (a, b) => a.webContents === b.webContents && a.document === b.document && a.frame === b.frame,
    async requestPermission() {
      if (process.platform !== 'darwin') return
      const granted = await systemPreferences.askForMediaAccess('microphone')
      if (!granted) throw new Error('Microphone access was denied. Allow Leyline microphone access in system settings.')
    },
    onState: broadcast,
  })

  function validOwner(owner) {
    try {
      return !closed && windows.get(owner.webContents.id) === owner.record
        && owner.document === owner.record.document
        && !owner.webContents.isDestroyed()
        && owner.record.trusted
        && !owner.record.pendingNavigation
        && owner.frame === owner.record.frame
        && owner.frame === owner.webContents.mainFrame
        && !owner.frame.detached
    } catch {
      return false
    }
  }

  function ownerFor(event) {
    const record = windows.get(event.sender.id)
    const owner = { record, webContents: event.sender, frame: event.senderFrame, document: record?.document, requests: record?.requests }
    if (!record || !validOwner(owner)) throw new Error('Dictation is available only in a trusted Leyline workspace')
    return owner
  }

  function broadcast() {
    if (closed) return
    for (const record of windows.values()) {
      const owner = { record, webContents: record.webContents, frame: record.webContents.mainFrame, document: record.document }
      if (!validOwner(owner)) continue
      try { record.webContents.send(`${prefix}state`, core.snapshot(owner)) } catch {}
    }
  }

  for (const name of methods) {
    ipcMain.handle(`${prefix}${name}`, async (event, input) => {
      try {
        const value = await core.invoke(ownerFor(event), name, input)
        return { ok: true, value }
      } catch (failure) {
        return { ok: false, error: failure.message || 'Dictation failed' }
      }
    })
  }

  function permissionOwner(webContents, details) {
    const lease = core.capture
    if (!lease || lease.cancelled || lease.phase !== 'recording' || webContents !== lease.owner.webContents
      || details.isMainFrame !== true || !validOwner(lease.owner)) return false
    return details.requestingUrl === lease.owner.frame.url
  }

  function registerWindow(window, url) {
    if (closed) return
    const webContents = window.webContents
    const record = {
      webContents, origin: new URL(url).origin, document: 0,
      frame: null, processId: null, routingId: null,
      trusted: false, pendingNavigation: false, requests: new Set(),
    }
    windows.set(webContents.id, record)
    const invalidateCapture = () => {
      const owner = core.capture?.owner
      if (owner?.webContents === webContents) void core.disconnect(owner)
    }
    const invalidateDocument = () => {
      record.document += 1
      record.frame = null
      record.processId = null
      record.routingId = null
      record.trusted = false
      record.pendingNavigation = false
      record.requests.clear()
      invalidateCapture()
    }
    const settleNavigation = () => {
      if (!record.pendingNavigation || webContents.isDestroyed() || webContents.isLoadingMainFrame()) return
      const frame = webContents.mainFrame
      if (frame !== record.frame || frame.detached
        || frame.processId !== record.processId || frame.routingId !== record.routingId) return
      record.pendingNavigation = false
      broadcast()
    }
    webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
      if (!isMainFrame || inPlace) return
      record.pendingNavigation = true
      invalidateCapture()
    })
    webContents.on('did-frame-navigate', (_event, loadedUrl, _code, _status, isMainFrame, processId, routingId) => {
      if (!isMainFrame) return
      invalidateDocument()
      const frame = webContents.mainFrame
      if (frame.processId !== processId || frame.routingId !== routingId || frame.detached) return
      record.frame = frame
      record.processId = processId
      record.routingId = routingId
      record.trusted = isWorkspaceUrl(loadedUrl, record.origin)
    })
    const navigationFailed = (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) settleNavigation()
    }
    webContents.on('did-fail-provisional-load', navigationFailed)
    webContents.on('did-fail-load', navigationFailed)
    webContents.on('did-stop-loading', settleNavigation)
    webContents.on('render-process-gone', invalidateDocument)
    webContents.on('destroyed', () => {
      invalidateDocument()
      windows.delete(webContents.id)
    })
    window.on('close', invalidateDocument)
    const session = webContents.session
    if (sessions.has(session)) return
    sessions.add(session)
    const workspacePermission = (sender, details) => {
      const known = sender && windows.get(sender.id)
      return known && details.isMainFrame === true
        && details.requestingUrl === sender.mainFrame.url
        && validOwner({ record: known, webContents: sender, frame: sender.mainFrame, document: known.document })
    }
    session.setPermissionCheckHandler((sender, permission, origin, details) => {
      if (['clipboard-sanitized-write', 'fullscreen'].includes(permission)) {
        return Boolean(workspacePermission(sender, details) && normalizeOrigin(origin) === windows.get(sender.id).origin)
      }
      if (permission !== 'media' || details.mediaType !== 'audio') return false
      return permissionOwner(sender, details) && normalizeOrigin(origin) === core.capture.owner.record.origin
    })
    session.setPermissionRequestHandler((sender, permission, callback, details) => {
      const allowed = ['clipboard-sanitized-write', 'fullscreen'].includes(permission)
        ? workspacePermission(sender, details)
        : permission === 'media' && details.mediaTypes?.length === 1
          && details.mediaTypes[0] === 'audio' && permissionOwner(sender, details)
          && (!details.securityOrigin || normalizeOrigin(details.securityOrigin) === core.capture.owner.record.origin)
      callback(Boolean(allowed))
    })
    session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  }

  function close() {
    if (closing) return closing
    closed = true
    for (const name of methods) ipcMain.removeHandler(`${prefix}${name}`)
    closing = core.close().finally(() => windows.clear())
    return closing
  }

  return { registerWindow, close }
}
