import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createReadTool, createEditTool } from '@earendil-works/pi-coding-agent'
import { createElune } from '@elune/embedded'
import { createPiTracingExtension } from '@elune/embedded/pi'

export const docsTraceTimeline = {
  timestamp: '2026-08-06T15:43:00.000Z',
  model1: { startTime: 0.2, duration: 5.6 },
  read: { startTime: 5.9, duration: 0.18 },
  model2: { startTime: 7.3, duration: 6.2 },
  edit: { startTime: 13.7, duration: 0.12 },
  model3: { startTime: 14, duration: 4.4 },
}

export function docsTraceEntryTimestamp(key) {
  const { startTime, duration } = docsTraceTimeline[key]
  return new Date(Date.parse(docsTraceTimeline.timestamp) + Math.round((startTime + duration) * 1000)).toISOString()
}

export async function docsTraces(entries, sessions) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leyline-docs-traces-'))
  const store = createElune({ databasePath: path.join(directory, 'elune.db') })
  const NativeDate = Date
  let now = Date.parse(docsTraceTimeline.timestamp)
  class FixtureDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [now]))
    }
    static now() { return now }
  }
  const tools = [createReadTool(directory), createEditTool(directory)]

  async function captureRun(session, timestamp, prompt, turns) {
    const start = NativeDate.parse(timestamp)
    const branch = [{ id: 'user-1', parentId: null, type: 'message', message: { role: 'user', content: prompt } }]
    const sessionManager = {
      getSessionId: () => session.id,
      getCwd: () => session.cwd,
      getSessionName: () => session.name,
      getSessionFile: () => session.path,
      getLeafId: () => branch.at(-1).id,
      getEntry: id => branch.find(entry => entry.id === id),
    }
    const ctx = { sessionManager, cwd: session.cwd }
    const handlers = new Map()
    const capture = createPiTracingExtension({ getStore: () => store })
    capture({ on: (name, handler) => { handlers.set(name, handler) } })
    const emit = (type, event = {}) => handlers.get(type)({ type, ...event }, ctx)
    const at = (timing, end = false) => { now = start + Math.round((timing.startTime + (end ? timing.duration : 0)) * 1000) }
    const append = (id, message) => branch.push({ id, parentId: branch.at(-1).id, type: 'message', message })
    const messages = [
      { role: 'system', content: 'You are a coding assistant. Make focused changes and report the result.' },
      { role: 'user', content: prompt },
    ]
    try {
      now = start
      emit('before_agent_start', { prompt })
      emit('agent_start')
      const traceId = capture.getActiveTraceId()
      for (const [turnIndex, turn] of turns.entries()) {
        at(turn.timing)
        emit('turn_start', { turnIndex, timestamp: now })
        emit('context', { messages })
        capture.observe({ type: 'provider_request', provider: 'local', api: 'openai-completions', model: 'minimax-m2.7' }, ctx)
        emit('before_provider_request', { payload: {
          model: 'minimax-m2.7', messages,
          tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
        } })
        const toolCallId = `call-${turnIndex + 1}`
        const content = [
          ...(turn.thinking ? [{ type: 'thinking', thinking: turn.thinking }] : []),
          ...(turn.text ? [{ type: 'text', text: turn.text }] : []),
          ...(turn.tool ? [{ type: 'toolCall', id: toolCallId, name: turn.tool.name, arguments: turn.tool.args }] : []),
        ]
        at(turn.timing, true)
        const message = {
          role: 'assistant', content, provider: 'local', api: 'openai-completions', model: 'minimax-m2.7',
          stopReason: turn.tool ? 'toolUse' : 'stop', timestamp: now,
          usage: {
            input: turn.inputTokens, output: turn.outputTokens, cacheRead: turn.cacheRead || 0, cacheWrite: 0,
            totalTokens: turn.inputTokens + turn.outputTokens + (turn.cacheRead || 0),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        }
        append(turn.entryId, message)
        emit('message_end', { message })
        const toolResults = []
        const toolResultEntryIds = []
        messages.push({
          role: 'assistant', content: turn.text || null,
          ...(turn.tool ? { tool_calls: [{ id: toolCallId, type: 'function', function: { name: turn.tool.name, arguments: JSON.stringify(turn.tool.args) } }] } : {}),
        })
        if (turn.tool) {
          at(turn.tool.timing)
          emit('tool_execution_start', { toolCallId, toolName: turn.tool.name, args: turn.tool.args })
          const result = await tools.find(tool => tool.name === turn.tool.name).execute(toolCallId, turn.tool.args)
          at(turn.tool.timing, true)
          emit('tool_execution_end', { toolCallId, toolName: turn.tool.name, result, isError: false })
          const toolResult = { role: 'toolResult', toolCallId, toolName: turn.tool.name, ...result, isError: false, timestamp: now }
          append(turn.tool.entryId, toolResult)
          emit('message_end', { message: toolResult })
          toolResults.push(toolResult)
          toolResultEntryIds.push(turn.tool.entryId)
          messages.push({ role: 'tool', tool_call_id: toolCallId, content: result.content.map(block => block.text || '').join('\n') })
        }
        emit('turn_end', { turnIndex, message, messageEntryId: turn.entryId, toolResults, toolResultEntryIds, outcome: 'completed' })
      }
      emit('agent_before_settle', { outcome: 'completed' })
      emit('agent_settled')
      await capture.flush()
      const trace = await store.get(traceId, { observationLimit: 200, scoreLimit: 200 })
      const ids = new Map(trace.observations.map((item, index) => [item.id, `${session.id}-observation-${index + 1}`]))
      return {
        ...trace, id: `trace-${session.id}`,
        observations: trace.observations.map(item => ({ ...item, id: ids.get(item.id), parentId: ids.get(item.parentId) || null })),
      }
    } finally {
      await capture.close()
    }
  }

  try {
    await fs.mkdir(path.join(directory, 'scripts'))
    await fs.writeFile(path.join(directory, 'scripts/release.js'), entries[3].preview.oldText)
    globalThis.Date = FixtureDate
    const primary = await captureRun(sessions[0], docsTraceTimeline.timestamp, entries[0].text, [
      {
        entryId: entries[1].id, timing: docsTraceTimeline.model1,
        text: entries[1].text,
        thinking: entries[1].blocks.find(block => block.type === 'thinking')?.text,
        inputTokens: 1240, outputTokens: 184,
        tool: { name: 'read', args: { path: 'scripts/release.js' }, entryId: entries[2].id, timing: docsTraceTimeline.read },
      },
      {
        entryId: 'assistant-edit', timing: docsTraceTimeline.model2, inputTokens: 1100, cacheRead: 512, outputTokens: 142,
        tool: {
          name: 'edit', entryId: entries[3].id, timing: docsTraceTimeline.edit,
          args: { path: 'scripts/release.js', edits: [{ oldText: entries[3].preview.oldText, newText: entries[3].preview.newText }] },
        },
      },
      { entryId: entries[4].id, timing: docsTraceTimeline.model3, text: entries[4].text, inputTokens: 836, cacheRead: 1024, outputTokens: 98 },
    ])
    const traces = [primary]
    for (const [sessionId, duration, inputTokens, outputTokens, output] of [
      ['release-checks', 26.7, 5800, 1040, 'The release stops if verification fails. Publication runs only after verification succeeds.'],
      ['api-review', 14.2, 3500, 620, 'The API returns a clear error response and keeps the original failure details in the server log.'],
      ['landing-copy', 9.8, 2300, 434, 'The revised copy describes the workspace and removes claims that the interface does not support.'],
      ['search-state', 12.6, 3100, 520, 'The search query stays with its project when the selected project changes.'],
    ]) {
      const session = sessions.find(item => item.id === sessionId)
      traces.push(await captureRun(session, new NativeDate(NativeDate.parse(session.timestamp) + 60000).toISOString(), session.name, [
        { entryId: 'assistant-1', timing: { startTime: 0, duration }, text: output, inputTokens, outputTokens },
      ]))
    }
    return traces
  } finally {
    globalThis.Date = NativeDate
    try { await store.close() } finally { await fs.rm(directory, { recursive: true, force: true }) }
  }
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
