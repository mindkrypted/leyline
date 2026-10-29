import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SERVICE_TIERS } from '../../lib/ultrafast.js'

export function readSessionServiceTier(sessionId) {
  const db = openDb()
  try {
    return db.prepare(`
      SELECT provider, model_id AS id, api, tier
      FROM session_service_tiers WHERE session_id = ?
    `).get(sessionId)
  } finally {
    db.close()
  }
}

export function saveSessionServiceTier(sessionId, model, tier) {
  if (!sessionId) throw new Error('Session id is required')
  if (!SERVICE_TIERS.includes(tier)) throw new Error('Invalid service tier')
  if (tier === 'standard') return clearSessionServiceTier(sessionId)
  if (!model?.provider || !model.id || !model.api) throw new Error('Model identity is required')
  const db = openDb()
  try {
    db.prepare(`
      INSERT INTO session_service_tiers (session_id, provider, model_id, api, tier, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        provider = excluded.provider,
        model_id = excluded.model_id,
        api = excluded.api,
        tier = excluded.tier,
        updated_at = excluded.updated_at
    `).run(sessionId, model.provider, model.id, model.api, tier, Date.now())
  } finally {
    db.close()
  }
}

export function clearSessionServiceTier(sessionId) {
  if (!sessionId) return
  const db = openDb()
  try {
    db.prepare('DELETE FROM session_service_tiers WHERE session_id = ?').run(sessionId)
  } finally {
    db.close()
  }
}

function openDb() {
  const path = join(process.env.LEYLINE_MEMORY_DIR || join(homedir(), '.local', 'share', 'leyline'), 'memory.sqlite')
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_service_tiers (
        session_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        api TEXT NOT NULL,
        tier TEXT NOT NULL CHECK (tier IN ('fast', 'ultrafast')),
        updated_at INTEGER NOT NULL
      );
    `)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
