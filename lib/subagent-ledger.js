import MarkdownIt from 'markdown-it'
import { activityEntry, activityStatus, toolStatusTone } from './tool-activity.js'
import { messageBlocksFor } from './transcript-projection.js'

const markdown = new MarkdownIt({ html: false, linkify: false })

export function subagentLedgerRows(items, cache) {
  const rows = items.flatMap(({ item, key }) => {
    if (item.type === 'tool-activity') {
      return item.items.map((call, index) => toolRow(call, `${key}:${index}`, cache))
    }
    const entry = activityEntry(item)
    if (entry.type === 'tool') return [toolRow(item, key, cache)]
    if (entry.type !== 'assistant' && !(entry.type === 'message' && entry.role === 'assistant')) return []
    const streaming = item.streaming === true
    return messageBlocksFor(entry).flatMap((block, index) => {
      if (!['text', 'thinking', 'image'].includes(block.type)) return []
      const kind = block.type === 'thinking' ? 'thought' : block.type === 'image' ? 'image' : 'message'
      const action = { thought: 'Thought', message: 'Message', image: 'Image' }[kind]
      const text = block.text ?? ''
      const rowKey = `${key}:${index}`
      const previous = cache?.get(rowKey)
      const unchanged = previous?.text === text && previous.kind === kind
      const heading = unchanged ? null : firstLine(text)
      return [reuseRow({
        key: rowKey,
        kind,
        action,
        title: unchanged ? previous.title : kind === 'image' ? 'Image' : heading.title || action,
        excerpt: unchanged ? previous.excerpt : kind === 'image' ? '' : subagentLedgerText(heading.rest),
        text,
        args: undefined,
        timestamp: entry.timestamp ?? item.timestamp ?? item.createdAt,
        status: streaming ? 'running' : 'saved',
        streaming,
        preview: kind === 'image' ? block : undefined,
      }, cache)]
    })
  })
  if (cache) {
    const retained = new Set(rows.map(row => row.key))
    for (const key of cache.keys()) if (!retained.has(key)) cache.delete(key)
  }
  return rows
}

function reuseRow(row, cache) {
  const previous = cache?.get(row.key)
  if (previous && Object.keys(row).every(key => row[key] === previous[key])) return previous
  cache?.set(row.key, row)
  return row
}

function toolRow(item, key, cache) {
  const entry = activityEntry(item)
  const args = entry.args ?? item.args
  const preview = entry.preview ?? item.preview
  const text = entry.text ?? preview?.fallbackText ?? preview?.content ?? item.text ?? ''
  const action = toolAction(entry.toolName || item.toolName || entry.label || item.label || 'Tool')
  const status = toolStatusTone(activityStatus(item))
  const rowKey = `tool:${entry.toolCallId || item.toolCallId || entry.id || item.id || key}`
  const previous = cache?.get(rowKey)
  return reuseRow({
    key: rowKey,
    kind: 'tool',
    action,
    title: toolTitle(args, entry.code || item.code || preview?.path, action),
    excerpt: previous?.text === text ? previous.excerpt : subagentLedgerText(text),
    text,
    args,
    timestamp: entry.timestamp ?? item.timestamp ?? item.startedAt,
    status,
    streaming: status === 'running',
    preview,
  }, cache)
}

function toolAction(name) {
  const operation = name.split(/__|[.:/]/).at(-1)
    .replace(/^Tool\s*·\s*/, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  const words = operation.toLowerCase()
  if (/\b(search|grep|find|query)\b|\bcode context\b/.test(words)) return 'Search'
  if (/\b(read|open|view)\b|\bget (file|resource)\b/.test(words)) return 'Read'
  if (/\b(fetch|contents?|crawl|scrape|browse|download)\b/.test(words)) return 'Fetch'
  if (/\b(bash|shell|exec|execute|command|run|terminal)\b/.test(words)) return 'Run'
  if (/\b(edit|patch|replace)\b/.test(words)) return 'Edit'
  if (/\b(write|create)\b/.test(words)) return 'Write'
  if (/\b(ls|list|listing)\b/.test(words)) return 'List'
  return operation.charAt(0).toUpperCase() + operation.slice(1)
}

function toolTitle(args, code, action) {
  const input = args || {}
  const path = input.path || input.file_path || input.filePath || input.directory
  const pattern = input.pattern || input.glob
  const target = [
    input.command,
    input.query,
    pattern && [pattern, path].filter(Boolean).join(' · '),
    input.urls,
    input.url,
    path,
    input.uri,
    input.title,
    input.task,
    input.prompt,
    input.ids,
    input.id,
    input.scope,
    input.name,
    code,
  ].map(value => Array.isArray(value) ? value.join(', ') : value)
    .find(value => typeof value === 'string' && value.trim())
  return boundedText(target || action, 160)
}

export function subagentLedgerText(text) {
  return boundedText(markdownText(overviewSource(text ?? '')), 300)
}

export function subagentLedgerTitle(text) {
  return firstLine(text ?? '').title
}

function firstLine(text) {
  const lines = text.slice(0, 5000).split(/\r\n?|\n/)
  for (let index = 0; index < lines.length; index++) {
    const title = boundedText(markdownText(lines[index]), 160)
    if (!title) continue
    const next = index + 1
    const start = /^\s*(?:=+|-+)\s*$/.test(lines[next] || '') ? next + 1 : next
    return { title, rest: lines.slice(start).join('\n') }
  }
  return { title: '', rest: '' }
}

function overviewSource(text) {
  if (!/^\s*(?:\{|\[)/.test(text)) return text
  try {
    const value = JSON.parse(text)
    const results = Array.isArray(value) ? value : Array.isArray(value?.results) ? value.results : [value]
    const parts = results.map(result => typeof result === 'string' ? result
      : result?.title || result?.snippet || result?.description || result?.text || result?.content || result?.url)
      .filter(value => typeof value === 'string' && value.trim())
    if (parts.length) return parts.join('\n\n')
  } catch {
    const title = text.match(/"title"\s*:\s*("(?:[^"\\]|\\.)*")/)
    if (title) {
      try { return JSON.parse(title[1]) } catch {}
    }
  }
  return text
}

function markdownText(text) {
  return markdown.parse(text.slice(0, 5000), {}).map(token => {
    if (token.type === 'inline') return inlineText(token.children || [])
    if (token.type === 'fence' || token.type === 'code_block') return token.content
    return ''
  }).filter(Boolean).join(' ')
}

function inlineText(tokens) {
  return tokens.map(token => {
    if (token.children) return inlineText(token.children)
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' '
    if (token.type === 'text' || token.type === 'code_inline') return token.content
    return ''
  }).join('')
}

function boundedText(text, limit) {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value
}
