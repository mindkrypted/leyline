import { backendHttpUrl } from './backend'

export function createTraceClient(connection, subscribeTraces) {
  const base = backendHttpUrl('/api/pi/traces', { ...connection })
  const controllers = new Set()
  const subscriptions = new Set()
  let disposed = false

  async function request(path, { signal, method = 'GET', body } = {}) {
    if (disposed) throw new DOMException('Trace view closed', 'AbortError')
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    controllers.add(controller)
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        signal: controller.signal,
        ...(body === undefined ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Trace request failed (${response.status})`)
      if (disposed || controller.signal.aborted) throw new DOMException('Trace view closed', 'AbortError')
      return data
    } finally {
      controllers.delete(controller)
      signal?.removeEventListener('abort', abort)
    }
  }

  function subscribe(listener, config = false) {
    if (disposed) return () => {}
    const remove = subscribeTraces((notice) => {
      if (disposed) return
      if (notice.type === 'reconnect' || (notice.type === 'trace_config') === config) listener(notice)
    })
    const detach = () => {
      remove()
      subscriptions.delete(detach)
    }
    subscriptions.add(detach)
    return detach
  }

  return {
    list(params, options) {
      return request(`?${new URLSearchParams(params)}`, options)
    },
    async get(id, { signal, observationOffset, observationLimit, scoreOffset, scoreLimit } = {}) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries({ observationOffset, observationLimit, scoreOffset, scoreLimit })) {
        if (value !== undefined && value !== null) params.set(key, value)
      }
      return (await request(`/${encodeURIComponent(id)}${params.size ? `?${params}` : ''}`, { signal })).trace
    },
    async setBookmarked(id, bookmarked, options) {
      return (await request(`/${encodeURIComponent(id)}`, { ...options, method: 'PATCH', body: { bookmarked } })).trace
    },
    getConfig(options) {
      return request('/config', options)
    },
    setConfig(enabled, options) {
      return request('/config', { ...options, method: 'PUT', body: { enabled } })
    },
    subscribe: (listener) => subscribe(listener),
    subscribeConfig: (listener) => subscribe(listener, true),
    dispose() {
      disposed = true
      for (const controller of controllers) controller.abort()
      for (const detach of subscriptions) detach()
    },
  }
}
