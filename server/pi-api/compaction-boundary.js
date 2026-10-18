import { findCutPoint } from '@earendil-works/pi-coding-agent'
import { projectEntry } from '../../lib/transcript-projection.js'

export function compactionCutEntryId(session) {
  if (!session) return ''
  try {
    const entries = session.sessionManager?.getBranch?.() || []
    const keepRecentTokens = session.settingsManager
      ?.getCompactionSettings?.(session.model)?.keepRecentTokens
    if (!entries.length || !Number.isFinite(keepRecentTokens)) return ''

    const startIndex = retainedTailStart(entries)
    const cut = findCutPoint(entries, startIndex, entries.length, keepRecentTokens)
    return firstRenderedEntryId(entries, cut.firstKeptEntryIndex)
  } catch {
    return ''
  }
}

// A compaction entry is appended after the tail it retained, so the context
// budget spans that tail as well. pi counts it from its first kept entry.
function retainedTailStart(entries) {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry?.type !== 'compaction') continue
    const keptIndex = entry.firstKeptEntryId
      ? entries.findIndex((candidate) => candidate.id === entry.firstKeptEntryId)
      : -1
    return keptIndex >= 0 ? keptIndex : index + 1
  }
  return 0
}

// The cut can land on an entry the transcript does not draw, such as an
// assistant message that carries tool calls and no visible text.
function firstRenderedEntryId(entries, startIndex) {
  for (let index = startIndex; index < entries.length; index++) {
    const entry = entries[index]
    if (entry?.type !== 'message') continue
    if (!projectEntry(entry)) continue
    return entry.id
  }
  return ''
}
