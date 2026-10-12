export const docsTraceTimeline = {
  timestamp: '2026-08-06T15:43:00.000Z',
  agent: { startTime: 0, duration: 18.4 },
  turn1: { startTime: 0, duration: 7.1 },
  model1: { startTime: 0.2, duration: 5.6 },
  read: { startTime: 5.9, duration: 0.18 },
  turn2: { startTime: 7.1, duration: 11.3 },
  model2: { startTime: 7.3, duration: 6.2 },
  edit: { startTime: 13.7, duration: 0.12 },
  model3: { startTime: 14, duration: 4.4 },
}

export function docsTraceEntryTimestamp(key) {
  const { startTime, duration } = docsTraceTimeline[key]
  return new Date(Date.parse(docsTraceTimeline.timestamp) + Math.round((startTime + duration) * 1000)).toISOString()
}

export function docsTraces(entries, sessions) {
  const summary = sessions[0]
  const metadata = {
    cwd: summary.cwd,
    sessionName: summary.name,
    sessionFile: summary.path,
    userEntryId: 'user-1',
    startEntryId: 'user-1',
    endEntryId: 'assistant-2',
  }
  const observation = (id, parentId, name, type, timing, input, output, extra = {}) => ({
    id, parentId, name, type, ...timing, input, output,
    status: 'completed', level: 'DEFAULT', model: '', inputTokens: 0, outputTokens: 0, cost: 0,
    metadata: {}, ...extra,
  })
  const generation = (id, parentId, name, timing, entry, inputTokens, outputTokens) => observation(
    id, parentId, name, 'GENERATION', timing, entries[0].text, entry.text,
    { model: 'local/minimax-m2.7', inputTokens, outputTokens, metadata: { messageEntryId: entry.id, usageKnown: true } },
  )
  const observations = [
    observation('release-agent', null, 'Review the release flow', 'AGENT', docsTraceTimeline.agent, entries[0].text, entries[4].text),
    observation('release-turn-1', 'release-agent', 'Inspect release order', 'SPAN', docsTraceTimeline.turn1, '', ''),
    generation('release-model-1', 'release-turn-1', 'Plan the release change', docsTraceTimeline.model1, entries[1], 1240, 184),
    observation('release-read', 'release-turn-1', 'read · scripts/release.js', 'TOOL', docsTraceTimeline.read, { path: 'scripts/release.js' }, entries[2].text, { metadata: { toolResultEntryId: 'tool-read' } }),
    observation('release-turn-2', 'release-agent', 'Apply the safe order', 'SPAN', docsTraceTimeline.turn2, '', ''),
    observation('release-model-2', 'release-turn-2', 'Prepare the edit', 'GENERATION', docsTraceTimeline.model2, entries[2].text, 'Move verify() before publish(), preserving the existing failure path.', { model: 'local/minimax-m2.7', inputTokens: 1612, outputTokens: 142 }),
    observation('release-edit', 'release-turn-2', 'edit · scripts/release.js', 'TOOL', docsTraceTimeline.edit, { path: 'scripts/release.js', oldText: entries[3].preview.oldText, newText: entries[3].preview.newText }, entries[3].text + '\n\n' + entries[3].preview.newText, { metadata: { toolResultEntryId: 'tool-edit' } }),
    generation('release-model-3', 'release-turn-2', 'Summarize the change', docsTraceTimeline.model3, entries[4], 1860, 98),
  ]
  const primary = {
    id: 'trace-release-order', sessionId: summary.id, name: 'Verify before publication',
    timestamp: docsTraceTimeline.timestamp, revision: 12,
    status: 'completed', level: 'DEFAULT', latency: docsTraceTimeline.agent.duration, inputTokens: 4712, outputTokens: 424,
    totalTokens: 5136, cost: 0, bookmarked: false, metadata,
    input: entries[0].text, output: entries[4].text, observations, scores: [],
  }
  const additional = [
    ['trace-release-checks', 'release-checks', 'Check the release failure path', 26.7, 6840],
    ['trace-api-review', 'api-review', 'Review API error handling', 14.2, 4120],
    ['trace-landing-copy', 'landing-copy', 'Tighten the landing page copy', 9.8, 2734],
    ['trace-search-state', 'search-state', 'Preserve project search state', 12.6, 3620],
  ].map(([id, sessionId, name, latency, totalTokens]) => {
    const session = sessions.find(item => item.id === sessionId)
    return {
      ...primary, id, sessionId, name, latency, totalTokens, revision: 6,
      timestamp: new Date(Date.parse(session.timestamp) + 60000).toISOString(),
      inputTokens: Math.floor(totalTokens * 0.85), outputTokens: totalTokens - Math.floor(totalTokens * 0.85),
      metadata: { cwd: session.cwd, sessionName: session.name, sessionFile: session.path },
      input: session.name, output: 'Completed the requested focused change.', observations: [],
    }
  })
  return [primary, ...additional]
}

export function tracePage(trace, params) {
  const offset = Number(params.get('observationOffset') || 0)
  const limit = Number(params.get('observationLimit') || 200)
  const observations = trace.observations.slice(offset, offset + limit)
  return {
    ...trace, observations,
    pagination: {
      observations: { total: trace.observations.length, offset, limit, nextOffset: offset + observations.length < trace.observations.length ? offset + observations.length : null },
      scores: { total: 0, offset: 0, limit: 200, nextOffset: null },
    },
  }
}
