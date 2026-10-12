import { json, readJson } from './http.js'

export function createTracingHandler(tracing) {
  const invalid = message => Object.assign(new Error(message), { publicTraceValidation: true })
  const pagination = (url, key, minimum, maximum) => {
    const value = url.searchParams.get(key)
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) {
      throw invalid(`${key} must be ${minimum ? 'a positive' : 'a non-negative'} integer`)
    }
    return Math.min(Number(value), maximum)
  }
  return async (req, res, url) => {
    try {
      if (url.pathname === '/traces/config') {
        if (req.method === 'GET') return json(res, tracing.config())
        if (req.method === 'PUT') {
          const body = await readJson(req)
          if (typeof body?.enabled !== 'boolean') throw invalid('enabled must be a boolean')
          return json(res, tracing.setConfig(body))
        }
        return json(res, { error: 'Method not allowed' }, 405)
      }
      if (url.pathname === '/traces') {
        if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405)
        const options = {}
        for (const key of ['sessionId', 'cwd', 'q', 'status', 'page', 'limit']) {
          if (!url.searchParams.has(key)) continue
          const value = url.searchParams.get(key)
          if (key === 'page' || key === 'limit') {
            if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw invalid(`${key} must be a positive integer`)
            options[key] = Number(value)
          } else options[key] = value
        }
        if (options.status && !['running', 'completed', 'error', 'aborted'].includes(options.status)) throw invalid('Invalid trace status')
        return json(res, await tracing.list(options))
      }
      const match = url.pathname.match(/^\/traces\/([^/]+)$/)
      if (!match) return json(res, { error: 'Not found' }, 404)
      const id = decodeURIComponent(match[1])
      if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(id)) throw invalid('Invalid trace identifier')
      if (req.method === 'GET') {
        const options = { observationLimit: 200, scoreLimit: 200 }
        for (const key of ['observationOffset', 'observationLimit', 'scoreOffset', 'scoreLimit']) {
          if (url.searchParams.has(key)) options[key] = pagination(url, key, key.endsWith('Offset') ? 0 : 1, key.endsWith('Limit') ? 200 : Number.MAX_SAFE_INTEGER)
        }
        const trace = await tracing.get(id, options)
        return trace ? json(res, { trace }) : json(res, { error: 'Trace not found' }, 404)
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        if (typeof body?.bookmarked !== 'boolean') throw invalid('bookmarked must be a boolean')
        return json(res, { trace: await tracing.setBookmarked(id, body.bookmarked) })
      }
      return json(res, { error: 'Method not allowed' }, 405)
    } catch (error) {
      const result = error.publicTraceValidation
        ? { error: error.message, status: 400 }
        : tracing.publicError(error)
      return json(res, { error: result.error }, result.status)
    }
  }
}
