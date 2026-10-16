import { BACKEND_API_VERSION, backendDisplayAddress, backendHttpUrl } from './backend'

export function fetchBackendConnections() {
  return shellRequest('/api/leyline/connections', 'Failed to load backend connections')
}

export function createBackendConnection(name, url) {
  return shellRequest('/api/leyline/connections', 'Failed to save backend connection', {
    method: 'POST',
    body: { name, url },
  })
}

export function updateBackendConnection(id, name, url) {
  return shellRequest(
    `/api/leyline/connections/${encodeURIComponent(id)}`,
    'Failed to update backend connection',
    {
      method: 'PATCH',
      body: { name, url },
    },
  )
}

export function deleteBackendConnection(id) {
  return shellRequest(
    `/api/leyline/connections/${encodeURIComponent(id)}`,
    'Failed to remove backend connection',
    { method: 'DELETE' },
  )
}

export function setDefaultBackendConnection(id) {
  return shellRequest(
    '/api/leyline/connections/default',
    'Failed to set the default backend',
    {
      method: 'PUT',
      body: { id },
    },
  )
}

export function fetchNetworkAccess() {
  return shellRequest('/api/leyline/network-access', 'Failed to load network access settings')
}

export function saveNetworkAccess(enabled) {
  return shellRequest('/api/leyline/network-access', 'Failed to save network access settings', {
    method: 'PUT',
    body: { enabled },
  })
}

export function getLeylineSetting(key) {
  return shellRequest(
    `/api/leyline/settings/${encodeURIComponent(key)}`,
    'Failed to load the setting',
  )
}

export function setLeylineSetting(key, value) {
  return shellRequest(
    `/api/leyline/settings/${encodeURIComponent(key)}`,
    'Failed to save the setting',
    {
      method: 'PUT',
      body: { value },
    },
  )
}

export function fetchPinnedSessions(connectionId) {
  const params = new URLSearchParams({ connectionId })
  return shellRequest(
    `/api/leyline/pinned-sessions?${params}`,
    'Failed to load pinned sessions',
  )
}

export function pinLeylineSession(connectionId, sessionId) {
  return shellRequest(
    '/api/leyline/pinned-sessions',
    'Failed to pin session',
    {
      method: 'POST',
      body: { connectionId, sessionId },
    },
  )
}

export function unpinLeylineSession(connectionId, sessionId) {
  const params = new URLSearchParams({ connectionId, sessionId })
  return shellRequest(
    `/api/leyline/pinned-sessions?${params}`,
    'Failed to unpin session',
    { method: 'DELETE' },
  )
}

export function prunePinnedSessions(connectionId, sessionIds) {
  return shellRequest(
    '/api/leyline/pinned-sessions/prune',
    'Failed to update pinned sessions',
    {
      method: 'POST',
      body: { connectionId, sessionIds },
    },
  )
}

export async function fetchBackendInfo(connection) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 6000)
  const address = backendDisplayAddress(connection)

  try {
    const response = await fetch(backendHttpUrl('/api/pi/info', connection), {
      signal: controller.signal,
    })
    const data = await responseJson(response)
    if (!response.ok) throw new Error(data.error || `Backend returned ${response.status}`)
    if (data.name !== 'Leyline' || data.apiVersion !== BACKEND_API_VERSION) {
      throw new Error('This server uses an incompatible Leyline API')
    }
    return data
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Connection to ${address} timed out`)
    }
    if (error instanceof TypeError) {
      throw new Error(`Cannot connect to ${address}`)
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

async function shellRequest(url, fallbackError, options = {}) {
  const init = { ...options }
  if (init.body && typeof init.body !== 'string') {
    init.headers = { 'Content-Type': 'application/json', ...init.headers }
    init.body = JSON.stringify(init.body)
  }

  const response = await fetch(url, init)
  const data = await responseJson(response)
  if (!response.ok) throw new Error(data.error || fallbackError)
  return data
}

async function responseJson(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}
