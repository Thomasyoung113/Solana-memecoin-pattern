/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { config } from './config'
import path from 'path'

interface DbClient {
  execute(query: string | { sql: string; args?: any[] }): Promise<{ rows: any[] }>
}

let db: DbClient | null = null
let dbAvailable = false

function init() {
  if (db !== null) return

  // 1. If Turso cloud is configured, use @libsql/client/web (pure fetch HTTP, zero native binaries)
  if (config.tursoDbUrl && config.tursoAuthToken) {
    try {
      const { createClient } = require('@libsql/client/web')
      const tursoClient = createClient({
        url: config.tursoDbUrl,
        authToken: config.tursoAuthToken,
      })
      db = {
        async execute(query: string | { sql: string; args?: any[] }) {
          const res = await tursoClient.execute(query)
          return { rows: res.rows || [] }
        },
      }
      dbAvailable = true
      initTables()
      return
    } catch (e: any) {
      console.warn('Turso web client init failed, falling back to local SQLite:', e.message)
    }
  }

  // 2. Local fallback using Node built-in node:sqlite (zero dependencies, works on Termux & any Node 22+)
  try {
    const { DatabaseSync } = require('node:sqlite')
    const dbPath = path.resolve(process.cwd(), 'signals.db')
    const sqlite = new DatabaseSync(dbPath)

    db = {
      async execute(query: string | { sql: string; args?: any[] }) {
        const sql = typeof query === 'string' ? query : query.sql
        const args = typeof query === 'string' ? [] : query.args || []

        const trimmed = sql.trim().toUpperCase()
        if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
          const stmt = sqlite.prepare(sql)
          const rows = stmt.all(...args)
          return { rows }
        } else {
          const stmt = sqlite.prepare(sql)
          stmt.run(...args)
          return { rows: [] }
        }
      },
    }
    dbAvailable = true
    initTables()
  } catch (err: any) {
    console.warn('Local SQLite init failed:', err.message)
    dbAvailable = false
    db = null
  }
}

async function initTables() {
  if (!db) return
  try {
    const query = `CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      contracts TEXT NOT NULL,
      result TEXT NOT NULL
    )`
    await db.execute(query)
  } catch (e: any) {
    console.warn('Failed to init analyses table:', e.message)
  }
}

export function getDb(): DbClient {
  init()
  if (!dbAvailable || !db) {
    throw new Error('Database is not available')
  }
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
