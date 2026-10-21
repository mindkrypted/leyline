import { randomUUID } from 'node:crypto'

export function createSpeechProcess(spawnWorker, onFailure) {
  let child
  let ready
  let stopping
  const pending = new Map()

  function rejectPending(message) {
    for (const call of pending.values()) {
      clearTimeout(call.timer)
      call.reject(new Error(message))
    }
    pending.clear()
  }

  function spawn() {
    const worker = spawnWorker()
    child = worker
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native dictation startup timed out')), 10000)
      const onMessage = message => {
        if (message?.type !== 'ready') return
        clearTimeout(timer)
        worker.off('message', onMessage)
        resolve()
      }
      worker.on('message', onMessage)
      worker.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('Native dictation stopped'))
      })
    })
    worker.on('message', message => {
      const call = pending.get(message?.id)
      if (!call) return
      pending.delete(message.id)
      clearTimeout(call.timer)
      if (message.error) call.reject(new Error(message.error))
      else call.resolve(message.value)
    })
    worker.on('exit', () => {
      if (child !== worker) return
      child = null
      ready = null
      rejectPending('Native dictation stopped')
      if (!stopping) onFailure('The native dictation process stopped unexpectedly')
    })
    worker.on('error', () => {
      if (child === worker && !stopping) onFailure('The native dictation process failed')
    })
  }

  async function request(operation, input, timeout, isCurrent) {
    await stopping
    if (!isCurrent()) throw new Error('Dictation was cancelled')
    if (!child) spawn()
    const worker = child
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Native dictation operation timed out'))
        onFailure('Native dictation operation timed out')
      }, timeout)
      pending.set(id, { resolve, reject, timer })
      const failed = () => {
        if (!pending.has(id)) return
        pending.delete(id)
        clearTimeout(timer)
        reject(new Error('Could not contact native dictation'))
        onFailure('Could not contact native dictation')
      }
      ready.then(() => {
        if (!pending.has(id)) return
        if (!isCurrent()) {
          pending.delete(id)
          clearTimeout(timer)
          reject(new Error('Dictation was cancelled'))
          return
        }
        try {
          const message = { id, operation, input }
          if (worker.postMessage) worker.postMessage(message)
          else worker.send(message, error => { if (error) failed() })
        } catch {
          failed()
        }
      }, error => {
        if (!pending.has(id)) return
        pending.delete(id)
        clearTimeout(timer)
        reject(error)
        onFailure(error.message)
      })
    })
  }

  function stop() {
    if (stopping) return stopping
    const worker = child
    if (!worker) return Promise.resolve()
    rejectPending('Dictation was cancelled')
    stopping = new Promise(resolve => {
      let timer
      const done = () => {
        clearTimeout(timer)
        worker.off('exit', done)
        if (child === worker) {
          child = null
          ready = null
        }
        resolve()
      }
      worker.once('exit', done)
      timer = setTimeout(() => {
        try { if (worker.pid) process.kill(worker.pid, 'SIGKILL') } catch {}
        done()
      }, 2000)
      try { worker.kill() } catch {}
    }).finally(() => { stopping = null })
    return stopping
  }

  return { request, stop }
}
