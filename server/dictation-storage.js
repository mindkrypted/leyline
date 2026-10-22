import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, lstat, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { DICTATION_MODELS, normalizeDictationSettings } from '../lib/dictation.js'

const hostKeys = ['modelId', 'language', 'keepModelWarm', 'idleMinutes']

export function createDictationStorage(onChange, onError, { host = false } = {}) {
  const settingsKey = host ? 'dictation.host-settings.v1' : 'dictation.settings.v1'
  const root = process.env.LEYLINE_MEMORY_DIR || join(homedir(), '.local', 'share', 'leyline')
  const directory = join(root, 'dictation', 'models')
  const installed = new Set()
  const fingerprints = new Map()
  const downloads = new Map()
  const abort = new AbortController()
  let db
  let initializing
  let closed = false
  let invalidSettingsValue
  let settings = normalizeDictationSettings({}, process.platform)

  const path = model => join(directory, model.filename)

  async function modelLock(model, onCompromised = () => {}) {
    let compromised = false
    let release
    try {
      release = await lockfile.lock(path(model), {
        realpath: false,
        retries: 0,
        stale: 120000,
        update: 10000,
        onCompromised: () => {
          compromised = true
          onCompromised()
        },
      })
    } catch {
      throw new Error('The dictation model is in use by another Leyline process. Retry the operation.')
    }
    return {
      check() {
        if (compromised || closed) throw new Error('The dictation model operation was cancelled')
      },
      release: () => release().catch(() => {}),
    }
  }

  const fingerprint = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`

  async function refresh() {
    for (const model of DICTATION_MODELS) {
      if (closed) throw new Error('Dictation is shutting down')
      let info
      try {
        info = await lstat(path(model))
      } catch (failure) {
        if (failure.code !== 'ENOENT') throw new Error('Could not inspect the local dictation model')
      }
      if (!info?.isFile() || info.size !== model.bytes) {
        installed.delete(model.id)
        fingerprints.delete(model.id)
      } else if (fingerprints.get(model.id) !== fingerprint(info)) {
        if (await verify(model)) installed.add(model.id)
        else installed.delete(model.id)
      }
    }
  }

  async function verify(model, signal) {
    const verificationSignal = AbortSignal.any([abort.signal, AbortSignal.timeout(30000), ...(signal ? [signal] : [])])
    let file
    try {
      verificationSignal.throwIfAborted()
      const info = await lstat(path(model))
      if (!info.isFile() || info.size !== model.bytes) return false
      file = await open(path(model), constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      verificationSignal.throwIfAborted()
      const opened = await file.stat()
      if (!opened.isFile() || opened.size !== model.bytes) return false
      const identity = fingerprint(opened)
      fingerprints.set(model.id, identity)
      const hash = createHash('sha256')
      let bytes = 0
      for await (const chunk of file.createReadStream({ autoClose: false, signal: verificationSignal })) {
        bytes += chunk.length
        if (bytes > model.bytes) return false
        hash.update(chunk)
      }
      return bytes === model.bytes && hash.digest('hex') === model.sha256 && fingerprint(await file.stat()) === identity
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ELOOP') return false
      throw new Error('Could not verify the local dictation model')
    } finally {
      await file?.close()
    }
  }

  function readSettings(database = db) {
    const stored = database.prepare('SELECT value FROM leyline_settings WHERE key = ?').get(settingsKey)
    try {
      const next = normalizeDictationSettings(stored ? JSON.parse(stored.value) : {}, process.platform)
      invalidSettingsValue = undefined
      return next
    } catch {
      if (invalidSettingsValue !== stored.value) {
        invalidSettingsValue = stored.value
        onError('Saved dictation settings are invalid. Default settings are in use.')
      }
      return normalizeDictationSettings({}, process.platform)
    }
  }

  function initialize() {
    if (closed) return Promise.reject(new Error('Dictation is shutting down'))
    if (initializing) return initializing
    initializing = (async () => {
      let database
      try {
        await mkdir(directory, { recursive: true })
        if (closed) throw new Error('Dictation is shutting down')
        const { DatabaseSync } = await import('node:sqlite')
        if (closed) throw new Error('Dictation is shutting down')
        database = new DatabaseSync(join(root, 'memory.sqlite'))
        database.exec('PRAGMA busy_timeout = 2000')
        database.exec('CREATE TABLE IF NOT EXISTS leyline_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)')
        const nextSettings = readSettings(database)
        const nextInstalled = new Set()
        for (const model of DICTATION_MODELS) {
          if (closed) throw new Error('Dictation is shutting down')
          if (await verify(model)) nextInstalled.add(model.id)
        }
        if (closed) throw new Error('Dictation is shutting down')
        db = database
        settings = nextSettings
        installed.clear()
        for (const id of nextInstalled) installed.add(id)
      } catch (failure) {
        try { database?.close() } catch {}
        initializing = null
        throw failure
      }
    })()
    return initializing
  }

  function saveSettings(patch) {
    if (closed) throw new Error('Dictation is shutting down')
    if (host && Object.keys(patch).some(key => !hostKeys.includes(key))) {
      throw new Error('Browser dictation can update only host model settings')
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      const stored = readSettings()
      const next = normalizeDictationSettings({
        ...stored,
        ...patch,
        shortcut: patch.shortcut === undefined ? stored.shortcut : { ...stored.shortcut, ...patch.shortcut },
      }, process.platform)
      db.prepare('INSERT INTO leyline_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .run(settingsKey, JSON.stringify(host ? Object.fromEntries(hostKeys.map(key => [key, next[key]])) : next), Date.now())
      db.exec('COMMIT')
      settings = next
      return settings
    } catch (failure) {
      db.exec('ROLLBACK')
      throw failure
    }
  }

  function models() {
    return DICTATION_MODELS.map(model => ({
      ...model,
      installed: installed.has(model.id),
      downloading: downloads.has(model.id),
      progress: downloads.get(model.id)?.progress || 0,
    }))
  }

  function download(model) {
    if (closed) throw new Error('Dictation is shutting down')
    if (downloads.has(model.id) || installed.has(model.id)) return
    const controller = new AbortController()
    const job = { controller, progress: 0 }
    downloads.set(model.id, job)
    job.promise = (async () => {
      const temporary = join(directory, `${model.filename}.${randomUUID()}.part`)
      let file
      let reader
      let lock
      let idleTimer
      let lastNotice = 0
      const deadline = setTimeout(() => controller.abort('timeout'), 30 * 60 * 1000)
      const resetIdle = () => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => controller.abort('timeout'), 30000)
      }
      try {
        lock = await modelLock(model)
        controller.signal.throwIfAborted()
        lock.check()
        if (await verify(model, controller.signal)) {
          installed.add(model.id)
          return
        }
        resetIdle()
        const response = await fetch(model.url, { signal: controller.signal })
        if (!response.ok || !response.body || new URL(response.url).protocol !== 'https:') {
          throw new Error('Could not download the dictation model')
        }
        const contentLength = response.headers.get('content-length')
        if (contentLength && Number(contentLength) !== model.bytes) {
          throw new Error('The dictation model download has an unexpected size')
        }
        file = await open(temporary, 'wx', 0o600)
        reader = response.body.getReader()
        const hash = createHash('sha256')
        let bytes = 0
        while (true) {
          resetIdle()
          const { done, value } = await reader.read()
          if (done) break
          if (controller.signal.aborted) throw new Error('Dictation model download cancelled')
          bytes += value.byteLength
          if (bytes > model.bytes) throw new Error('The dictation model download is too large')
          hash.update(value)
          let offset = 0
          while (offset < value.byteLength) {
            const result = await file.write(value, offset, value.byteLength - offset)
            if (!result.bytesWritten) throw new Error('Could not write the dictation model')
            offset += result.bytesWritten
          }
          job.progress = bytes / model.bytes
          if (Date.now() - lastNotice >= 150) {
            lastNotice = Date.now()
            onChange()
          }
        }
        if (bytes !== model.bytes || hash.digest('hex') !== model.sha256) {
          throw new Error('The dictation model download failed its integrity check')
        }
        await file.sync()
        await file.close()
        file = null
        if (controller.signal.aborted || closed) throw new Error('Dictation model download cancelled')
        lock.check()
        await rename(temporary, path(model))
        if (controller.signal.aborted || closed) {
          await rm(path(model), { force: true })
          throw new Error('Dictation model download cancelled')
        }
        installed.add(model.id)
      } catch (error) {
        const timedOut = controller.signal.reason === 'timeout'
        if (!closed && (!controller.signal.aborted || timedOut)) {
          onError(timedOut ? 'The dictation model download timed out. Retry the download.' : error.message?.startsWith('The dictation model') ? error.message : 'Could not download the dictation model')
        }
      } finally {
        clearTimeout(deadline)
        clearTimeout(idleTimer)
        await reader?.cancel().catch(() => {})
        await file?.close().catch(() => {})
        await rm(temporary, { force: true }).catch(() => {})
        await lock?.release()
        downloads.delete(model.id)
        if (!closed) onChange()
      }
    })()
    onChange()
  }

  async function cancelDownload(model) {
    const job = downloads.get(model.id)
    if (!job) return
    job.controller.abort()
    await job.promise
  }

  async function remove(model) {
    await cancelDownload(model)
    const lock = await modelLock(model)
    try {
      lock.check()
      await rm(path(model), { force: true }).catch(() => { throw new Error('Could not remove the local dictation model') })
      installed.delete(model.id)
    } finally {
      await lock.release()
    }
  }

  async function close() {
    closed = true
    abort.abort()
    for (const job of downloads.values()) job.controller.abort()
    await Promise.allSettled([...downloads.values()].map(job => job.promise))
    await initializing?.catch(() => {})
    db?.close()
    db = null
  }

  return {
    initialize, refresh, path, verify, modelLock, models, saveSettings, download, cancelDownload, remove, close,
    get settings() {
      if (db) settings = readSettings()
      return settings
    },
    get installed() { return installed },
  }
}
