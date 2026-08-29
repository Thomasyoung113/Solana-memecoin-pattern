/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { config } from './config'

let db: any = null
let dbAvailable = false

// Try to init the DB — gracefully handles missing native binary
function init() {
  if (db !== null) return

  if (!config.tursoDbUrl || !config.tursoAuthToken) {
    dbAvailable = false
    db = {} // prevent re-init
    return
  }

  try {
    const { createClient } = require('@libsql/client')
    db = createClient({ url: config.tursoDbUrl, authToken: config.tursoAuthToken })
    dbAvailable = true
    initTables()
  } catch (e: any) {
    console.warn('DB unavailable (native binary not found):', e.message)
    dbAvailable = false
    db = {}
  }
}

async function initTables() {
  try {
    const queries = [
      `CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        contracts TEXT NOT NULL,
        result TEXT NOT NULL
      )`,
    ]
    for (const sql of queries) {
      await db.execute(sql)
    }
  } catch {}
}

export function getDb() {
  init()
  if (!dbAvailable) throw new Error('DB not available')
  return db
}

export async function initDb() {
  init()
}

export async function saveAnalysis(id: string, contracts: string[], result: any) {
  try {
    const d = getDb()
    await d.execute({
      sql: `INSERT OR REPLACE INTO analyses (id, created_at, contracts, result) VALUES (?, ?, ?, ?)`,
      args: [id, Date.now(), JSON.stringify(contracts), JSON.stringify(result)],
    })
  } catch {}
}

export async function getAnalysis(id: string) {
  try {
    const d = getDb()
    const result = await d.execute({
      sql: `SELECT * FROM analyses WHERE id = ?`,
      args: [id],
    })
    return result.rows[0] || null
  } catch {
    return null
  }
}
