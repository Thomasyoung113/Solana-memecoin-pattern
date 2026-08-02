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
      `CREATE TABLE IF NOT EXISTS wallet_profiles (
        address TEXT PRIMARY KEY,
        total_contracts INTEGER DEFAULT 0,
        avg_entry_time INTEGER DEFAULT 0,
        total_volume REAL DEFAULT 0,
        profit_estimate REAL DEFAULT 0,
        score REAL DEFAULT 0,
        last_analyzed INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS contract_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_address TEXT NOT NULL,
        pattern_type TEXT NOT NULL,
        pattern_data TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
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

export async function getWalletProfile(address: string) {
  try {
    const d = getDb()
    const result = await d.execute({
      sql: `SELECT * FROM wallet_profiles WHERE address = ?`,
      args: [address],
    })
    return result.rows[0] || null
  } catch {
    return null
  }
}

export async function upsertWalletProfile(address: string, data: Partial<{
  total_contracts: number
  avg_entry_time: number
  total_volume: number
  profit_estimate: number
  score: number
}>) {
  try {
    const d = getDb()
    await d.execute({
      sql: `INSERT INTO wallet_profiles (address, total_contracts, avg_entry_time, total_volume, profit_estimate, score, last_analyzed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(address) DO UPDATE SET
              total_contracts = excluded.total_contracts,
              avg_entry_time = excluded.avg_entry_time,
              total_volume = excluded.total_volume,
              profit_estimate = excluded.profit_estimate,
              score = excluded.score,
              last_analyzed = excluded.last_analyzed`,
      args: [
        address,
        data.total_contracts ?? 0,
        data.avg_entry_time ?? 0,
        data.total_volume ?? 0,
        data.profit_estimate ?? 0,
        data.score ?? 0,
        Date.now(),
      ],
    })
  } catch {}
}