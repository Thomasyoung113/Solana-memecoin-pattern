import { getTokenOverview, type TokenOverview } from './birdeye'
import { getTokenInfo, getTokenHolders, type TokenHolder } from './helius'
import { getDb } from './db'

export interface AnalysisResult {
  mint: string
  timestamp: number
  overview: TokenOverview | null
  holders: TokenHolder[]
  patterns: PatternScore[]
  redFlags: RedFlag[]
  overallScore: number
  verdict: 'bullish' | 'neutral' | 'bearish'
}

export interface PatternScore {
  name: string
  score: number // 0-100
  detail: string
}

export interface RedFlag {
  severity: 'low' | 'medium' | 'high' | 'critical'
  issue: string
  detail: string
}

// Analyze a single token mint
export async function analyzeToken(mint: string): Promise<AnalysisResult> {
  const [overview, tokenInfo] = await Promise.all([
    getTokenOverview(mint),
    getTokenInfo(mint),
  ])

  const deployerAddress = tokenInfo?.deployerAddress || ''
  const deployTimestamp = tokenInfo?.deployTimestamp || 0

  const [holders] = await Promise.all([
    deployerAddress
      ? getTokenHolders(mint, deployerAddress, deployTimestamp)
      : Promise.resolve([]),
  ])

  const patterns = analyzePatterns(overview, holders, deployTimestamp)
  const redFlags = detectRedFlags(overview, holders)
  const overallScore = computeOverallScore(patterns, redFlags)

  const verdict = overallScore >= 65 ? 'bullish' : overallScore >= 35 ? 'neutral' : 'bearish'

  // Persist to DB
  try {
    const db = getDb()
    const resultJson = JSON.stringify({ overview, patterns, redFlags, overallScore, verdict })
    const contractsJson = JSON.stringify([mint])
    await db.execute({
      sql: `INSERT OR REPLACE INTO analyses (id, created_at, contracts, result) VALUES (?, ?, ?, ?)`,
      args: [mint, Date.now(), contractsJson, resultJson],
    })
  } catch {
    // non-critical
  }

  return { mint, timestamp: Date.now(), overview, holders, topHolders, patterns, redFlags, overallScore, verdict }
}

function analyzePatterns(
  overview: TokenOverview | null,
  holders: TokenHolder[],
  deployTimestamp: number,
): PatternScore[] {
  const patterns: PatternScore[] = []
  if (holders.length > 0) {
    const top10Pct = holders.slice(0, Math.min(10, holders.length))
      .reduce((s, h) => s + h.percentage, 0)
    const isConcentrated = top10Pct > 80
    patterns.push({
      name: 'Holder Concentration',
      score: isConcentrated ? 30 : 80,
      detail: isConcentrated
        ? `Top 10 hold ${top10Pct.toFixed(1)}% — highly concentrated`
        : `Top 10 hold ${top10Pct.toFixed(1)}% — well distributed`,
    })
  }

  // 2. Liquidity depth
  if (overview?.liquidity) {
    const liq = overview.liquidity
    patterns.push({
      name: 'Liquidity Depth',
      score: liq > 50000 ? 85 : liq > 10000 ? 60 : liq > 1000 ? 35 : 10,
      detail: liq > 50000
        ? `$${liq.toLocaleString()} liquidity — deep`
        : `$${liq.toLocaleString()} liquidity — ${liq < 1000 ? 'extremely shallow' : 'shallow'}`,
    })
  }

  // 3. Volume trend (last 24h)
  if (overview?.volume24h) {
    const vol = overview.volume24h
    patterns.push({
      name: 'Trading Volume',
      score: vol > 500000 ? 80 : vol > 100000 ? 60 : vol > 10000 ? 40 : 15,
      detail: `24h volume: $${vol.toLocaleString()}`,
    })
  }

  // 4. Age since deploy
  if (deployTimestamp > 0) {
    const ageHours = (Date.now() / 1000 - deployTimestamp) / 3600
    patterns.push({
      name: 'Token Age',
      score: ageHours < 24 ? 75 : ageHours < 168 ? 50 : 25,
      detail: ageHours < 1
        ? 'Launched <1h ago — fresh'
        : `Launched ${ageHours.toFixed(1)}h ago`,
    })
  }

  // 6. Market cap
  if (overview?.mc) {
    const mc = overview.mc
    patterns.push({
      name: 'Market Cap',
      score: mc < 50000 ? 70 : mc < 500000 ? 50 : mc < 5000000 ? 30 : 15,
      detail: mc < 50000
        ? `$${mc.toLocaleString()} MC — micro cap (high upside/risk)`
        : `$${mc.toLocaleString()} MC`,
    })
  }

  return patterns
}

function detectRedFlags(
  overview: TokenOverview | null,
  holders: TokenHolder[],
): RedFlag[] {
  const flags: RedFlag[] = []

  // Deployer holds significant supply
  const deployer = holders.find(h => h.isDeployer)
  if (deployer && deployer.percentage > 10) {
    flags.push({
      severity: deployer.percentage > 30 ? 'critical' : 'high',
      issue: 'Deployer holding',
      detail: `Deployer holds ${deployer.percentage.toFixed(1)}% of supply`,
    })
  }

  // Liquidity too low
  if (overview?.liquidity && overview.liquidity < 500) {
    flags.push({
      severity: 'high',
      issue: 'Low liquidity',
      detail: `Only $${overview.liquidity.toLocaleString()} liquidity — high slippage / rug risk`,
    })
  }

  // No holders
  if (!holders.length) {
    flags.push({
      severity: 'high',
      issue: 'No holders',
      detail: 'No token holders found — may not be traded yet',
    })
  }

  // Security checks
  if (security) {
    if (security.mintAuthority) {
      flags.push({
        severity: 'critical',
        issue: 'Mint authority enabled',
        detail: 'Deployer can mint new tokens — infinite dilution risk',
      })
    }
    if (security.freezeAuthority) {
      flags.push({
        severity: 'high',
        issue: 'Freeze authority enabled',
        detail: 'Deployer can freeze token accounts',
      })
    }
  }

  return flags
}

function computeOverallScore(patterns: PatternScore[], redFlags: RedFlag[]): number {
  if (!patterns.length) return 50

  const baseScore = patterns.reduce((s, p) => s + p.score, 0) / patterns.length

  // Deduct for red flags
  const deductions: Record<string, number> = {
    low: 5,
    medium: 15,
    high: 25,
    critical: 40,
  }
  const penalty = redFlags.reduce((s, f) => s + (deductions[f.severity] || 0), 0)

  return Math.max(0, Math.min(100, Math.round(baseScore - penalty)))
}

// Get analysis from cache
export async function getCachedAnalysis(mint: string): Promise<AnalysisResult | null> {
  try {
    const db = getDb()
    const result = await db.execute({
      sql: `SELECT * FROM analyses WHERE id = ?`,
      args: [mint],
    })
    if (!result.rows.length) return null
    const row = result.rows[0]
    const parsed = JSON.parse(row.result as string)
    return {
      mint: row.id as string,
      timestamp: row.created_at as number,
      ...parsed,
    }
  } catch {
    return null
  }
}