import { getTokenOverview, type TokenOverview } from './birdeye'
import { getTokenInfo, getTokenHolders, type TokenHolder } from './helius'
import { getRugCheckReport, type RugCheckReport } from './rugcheck'
import { getDb } from './db'

export interface ExitTarget {
  name: string
  mc: number | [number, number]
  targetDisplay: string
  potentialGain: string
  strategy: string
}

export interface MicroCapSpot {
  isSpot: boolean
  entryMc: number | null
  targetExitMc: [number, number]
  tp1_scalp: ExitTarget
  tp2_runner: ExitTarget
  potentialMultiplier: string
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
  checklist: {
    mcInRange: boolean
    devHoldingSafe: boolean
    authoritiesRevoked: boolean
    lpLocked: boolean
    buyerMomentum: boolean
    concentrationSafe: boolean
  }
}

export interface SecuritySummary {
  score: number
  lpLockedPct: number
  isBondingCurve: boolean
  mintAuthorityRevoked: boolean
  freezeAuthorityRevoked: boolean
  devHoldingPct: number
  top10Pct: number
  rugged: boolean
}

export interface AnalysisResult {
  mint: string
  timestamp: number
  overview: TokenOverview | null
  holders: TokenHolder[]
  security: SecuritySummary | null
  microCapSpot: MicroCapSpot
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
  // Fetch overview, token info, and security in parallel
  const [overview, tokenInfo, rugReport] = await Promise.all([
    getTokenOverview(mint),
    getTokenInfo(mint),
    getRugCheckReport(mint),
  ])

  const deployerAddress = rugReport?.creator || tokenInfo?.deployerAddress || ''
  const deployTimestamp = tokenInfo?.deployTimestamp || (rugReport?.detectedAt ? Math.floor(rugReport.detectedAt / 1000) : 0)

  const holders = await getTokenHolders(mint, deployerAddress, deployTimestamp)

  // Calculate dev and holder concentration stats
  const devHolder = holders.find(h => h.isDeployer || (deployerAddress && h.address.toLowerCase() === deployerAddress.toLowerCase()))
  let devHoldingPct = devHolder ? devHolder.percentage : 0
  if (devHoldingPct === 0 && rugReport?.creatorBalance && rugReport.supply > 0) {
    devHoldingPct = (rugReport.creatorBalance / rugReport.supply) * 100
  }

  const pairAddr = (overview?.pairAddress || '').toLowerCase()
  const nonDevHolders = holders.filter(h => {
    const addr = h.address.toLowerCase()
    if (h.isDeployer) return false
    if (deployerAddress && addr === deployerAddress.toLowerCase()) return false
    if (pairAddr && addr === pairAddr) return false
    return true
  })
  const top10Pct = nonDevHolders.slice(0, 10).reduce((s, h) => s + h.percentage, 0)

  const isBondingCurve = Boolean(
    rugReport?.isBondingCurve ||
    overview?.dexId === 'pumpfun' ||
    overview?.dexId === 'moonshot'
  )

  const mintAuthRevoked = rugReport ? rugReport.mintAuthority === null : true
  const freezeAuthRevoked = rugReport ? rugReport.freezeAuthority === null : true

  const security: SecuritySummary = {
    score: rugReport?.score ?? 0,
    lpLockedPct: rugReport?.lpLockedPct ?? (isBondingCurve ? 100 : 0),
    isBondingCurve,
    mintAuthorityRevoked: mintAuthRevoked,
    freezeAuthorityRevoked: freezeAuthRevoked,
    devHoldingPct,
    top10Pct,
    rugged: Boolean(rugReport?.rugged),
  }

  // 1. Evaluate Quick 2x-5x Micro-Cap Spot ($10k-$20k entry -> $50k-$100k exit)
  const microCapSpot = evaluateMicroCapSpot(overview, security, holders, devHoldingPct, top10Pct)

  // 2. Evaluate Patterns & Red Flags
  const patterns = evaluatePatterns(overview, security, holders, deployTimestamp, microCapSpot)
  const redFlags = detectRedFlags(overview, security, rugReport, holders, devHoldingPct)
  const overallScore = computeOverallScore(patterns, redFlags, microCapSpot)

  const verdict = overallScore >= 65 ? 'bullish' : overallScore >= 35 ? 'neutral' : 'bearish'

  const result: AnalysisResult = {
    mint,
    timestamp: Date.now(),
    overview,
    holders,
    security,
    microCapSpot,
    patterns,
    redFlags,
    overallScore,
    verdict,
  }

  // Persist to DB cache
  try {
    const db = getDb()
    const resultJson = JSON.stringify(result)
    const contractsJson = JSON.stringify([mint])
    await db.execute({
      sql: `INSERT OR REPLACE INTO analyses (id, created_at, contracts, result) VALUES (?, ?, ?, ?)`,
      args: [mint, Date.now(), contractsJson, resultJson],
    })
  } catch {
    // non-critical
  }

  return result
}

function evaluateMicroCapSpot(
  overview: TokenOverview | null,
  security: SecuritySummary,
  holders: TokenHolder[],
  devHoldingPct: number,
  top10Pct: number
): MicroCapSpot {
  const mc = overview?.mc ?? 0
  const reasons: string[] = []

  // Entry range: $6,000 - $22,000 (entering at $8k-$12k makes $20k an exact 2x take-profit!)
  const mcInRange = mc >= 6_000 && mc <= 22_000
  if (mcInRange) {
    if (mc <= 12_000) {
      reasons.push(`MC $${Math.round(mc).toLocaleString()} is prime early entry — taking profit at $20k MC is an instant 2x scalp!`)
    } else {
      reasons.push(`MC $${Math.round(mc).toLocaleString()} is in micro-cap zone — TP1 at $20k–$25k MC (2x) and TP2 at $50k–$100k MC`)
    }
  }

  // Dev holding: dev holds <= 8% (ideally 0% or < 5%)
  const devHoldingSafe = devHoldingPct <= 8
  if (devHoldingSafe) {
    if (devHoldingPct === 0) {
      reasons.push('Dev holds 0% — zero dev dump risk')
    } else {
      reasons.push(`Dev holds only ${devHoldingPct.toFixed(1)}% — low dump risk`)
    }
  }

  // Contract authorities: both mint and freeze revoked
  const authoritiesRevoked = security.mintAuthorityRevoked && security.freezeAuthorityRevoked
  if (authoritiesRevoked) {
    reasons.push('Mint and freeze authorities revoked')
  }

  // LP locked or bonding curve protected
  const lpLocked = security.isBondingCurve || security.lpLockedPct >= 90
  if (lpLocked) {
    reasons.push(security.isBondingCurve ? 'Bonding curve protected — LP cannot be pulled' : `LP ${security.lpLockedPct}% locked`)
  }

  // 5m Buyer momentum
  const buysM5 = overview?.txnsM5?.buys ?? 0
  const sellsM5 = overview?.txnsM5?.sells ?? 0
  const volM5 = overview?.volumeM5 ?? 0
  const buyerMomentum = (buysM5 >= 12 && buysM5 > sellsM5) || volM5 >= 1_500 || (overview?.priceChangeM5 ?? 0) > 0
  if (buyerMomentum) {
    reasons.push(`Active buyer momentum (5m buys: ${buysM5}, sells: ${sellsM5})`)
  }

  // Concentration safe: top 10 hold <= 38%
  const concentrationSafe = holders.length === 0 || top10Pct <= 38
  if (concentrationSafe && holders.length > 0) {
    reasons.push(`Top 10 hold ${top10Pct.toFixed(1)}% — distributed, anti-bundle`)
  }

  const checklist = {
    mcInRange,
    devHoldingSafe,
    authoritiesRevoked,
    lpLocked,
    buyerMomentum,
    concentrationSafe,
  }

  const passedCount = Object.values(checklist).filter(Boolean).length
  const isSpot = mcInRange && devHoldingSafe && authoritiesRevoked && lpLocked && passedCount >= 5
  const confidence = passedCount === 6 ? 'high' : passedCount >= 5 ? 'medium' : 'low'

  const tp1Multiplier = mc > 0 ? `${Math.max(1.5, Math.round((20_000 / mc) * 10) / 10)}x` : '2.0x'
  const tp2Multiplier = mc > 0 ? `${Math.max(2.5, Math.round((50_000 / mc) * 10) / 10)}x - ${Math.round((100_000 / mc) * 10) / 10}x` : '2.5x - 5.0x'

  const tp1_scalp: ExitTarget = {
    name: 'TP1 (Quick 2x Take-Profit)',
    mc: 20_000,
    targetDisplay: '$20,000 – $25,000 MC',
    potentialGain: tp1Multiplier,
    strategy: 'Take initial capital / 50% profit off at $20k MC (de-risk)',
  }

  const tp2_runner: ExitTarget = {
    name: 'TP2 (Graduation Runner)',
    mc: [50_000, 100_000],
    targetDisplay: '$50,000 – $100,000 MC',
    potentialGain: tp2Multiplier,
    strategy: 'Let runner ride to bonding curve graduation ($50k–$100k MC)',
  }

  return {
    isSpot,
    entryMc: mc > 0 ? Math.round(mc) : null,
    targetExitMc: [20_000, 100_000],
    tp1_scalp,
    tp2_runner,
    potentialMultiplier: `2.0x (at $20k MC) – 5.0x (at $100k MC)`,
    confidence,
    reasons,
    checklist,
  }
}

function evaluatePatterns(
  overview: TokenOverview | null,
  security: SecuritySummary,
  holders: TokenHolder[],
  deployTimestamp: number,
  microCapSpot: MicroCapSpot
): PatternScore[] {
  const patterns: PatternScore[] = []
  const mc = overview?.mc ?? 0
  const isMicroCap = mc > 0 && mc <= 35_000

  // 1. Micro-Cap 2x Setup Pattern
  if (isMicroCap) {
    if (mc >= 6_000 && mc <= 12_000) {
      patterns.push({
        name: 'Early Micro-Cap 2x Setup ($6k–$12k)',
        score: 95,
        detail: `$${Math.round(mc).toLocaleString()} MC — prime early entry: take profit at $20k MC (${(20_000 / mc).toFixed(1)}x scalp) & runner exit at $50k–$100k`,
      })
    } else if (mc > 12_000 && mc <= 20_000) {
      patterns.push({
        name: 'Micro-Cap 2x Window ($12k–$20k)',
        score: 92,
        detail: `$${Math.round(mc).toLocaleString()} MC — entering before/at $20k TP1; momentum targeting graduation at $50k–$100k`,
      })
    } else if (mc > 20_000 && mc <= 35_000) {
      patterns.push({
        name: 'Micro-Cap Breakout Stage',
        score: 80,
        detail: `$${Math.round(mc).toLocaleString()} MC — post-TP1 continuation targeting $50k–$100k graduation`,
      })
    } else {
      patterns.push({
        name: 'Micro-Cap Setup',
        score: 65,
        detail: `$${Math.round(mc).toLocaleString()} MC — micro-cap stage`,
      })
    }
  } else if (mc > 0) {
    patterns.push({
      name: 'Market Cap Stage',
      score: mc <= 100_000 ? 70 : mc <= 500_000 ? 55 : mc <= 5_000_000 ? 40 : 25,
      detail: `$${Math.round(mc).toLocaleString()} MC`,
    })
  }

  // 2. Buyer Momentum & 5m Velocity
  if (overview?.txnsM5) {
    const buys = overview.txnsM5.buys
    const sells = overview.txnsM5.sells
    const score = buys >= 20 && buys >= sells * 1.3
      ? 95
      : buys >= 12 && buys >= sells
      ? 80
      : buys > sells
      ? 65
      : sells > buys * 2
      ? 25
      : 50

    patterns.push({
      name: 'Buyer Velocity (5m)',
      score,
      detail: `${buys} buys vs ${sells} sells in last 5m (Vol: $${Math.round(overview.volumeM5 || 0).toLocaleString()})`,
    })
  }

  // 3. Dev Holding & Dump Risk
  const devPct = security.devHoldingPct
  const devScore = devPct === 0
    ? 98
    : devPct <= 3
    ? 90
    : devPct <= 8
    ? 75
    : devPct <= 15
    ? 40
    : 10
  patterns.push({
    name: 'Dev Retention & Dump Risk',
    score: devScore,
    detail: devPct === 0
      ? 'Dev holds 0% — completely distributed, zero dump risk'
      : `Dev holds ${devPct.toFixed(1)}% of total supply (${devPct <= 8 ? 'safe' : 'high dump risk'})`,
  })

  // 4. Contract Security & Authorities
  const authScore = (security.mintAuthorityRevoked && security.freezeAuthorityRevoked)
    ? (security.score <= 150 ? 95 : security.score <= 500 ? 80 : 50)
    : 20
  patterns.push({
    name: 'Contract Security',
    score: authScore,
    detail: security.mintAuthorityRevoked && security.freezeAuthorityRevoked
      ? `Authorities revoked | RugCheck score: ${security.score}`
      : 'Active mint or freeze authority — security risk',
  })

  // 5. Liquidity Backing
  if (security.isBondingCurve) {
    patterns.push({
      name: 'Liquidity Structure',
      score: 92,
      detail: 'Bonding curve liquidity — immune to traditional LP drain / rug pull',
    })
  } else if (overview?.liquidity) {
    const liq = overview.liquidity
    const liqToMc = mc > 0 ? (liq / mc) : 0
    const liqScore = liqToMc >= 0.20 ? 88 : liqToMc >= 0.10 ? 70 : liq > 10_000 ? 60 : 30
    patterns.push({
      name: 'Liquidity Depth',
      score: liqScore,
      detail: `$${Math.round(liq).toLocaleString()} liquidity (${(liqToMc * 100).toFixed(0)}% of MC)`,
    })
  }

  // 6. Holder Distribution (Anti-Bundle)
  if (holders.length > 0) {
    const top10 = security.top10Pct
    const distScore = top10 <= 25 ? 90 : top10 <= 35 ? 80 : top10 <= 50 ? 55 : 25
    patterns.push({
      name: 'Holder Distribution',
      score: distScore,
      detail: `Top 10 non-dev hold ${top10.toFixed(1)}% (${distScore >= 75 ? 'fair distribution' : 'concentrated'})`,
    })
  }

  // 7. Token Age / Freshness
  if (deployTimestamp > 0) {
    const ageMins = Math.max(1, Math.round((Date.now() / 1000 - deployTimestamp) / 60))
    const ageHours = ageMins / 60
    const freshScore = ageMins <= 60 ? 90 : ageHours <= 6 ? 75 : ageHours <= 24 ? 55 : 35
    patterns.push({
      name: 'Token Age & Timing',
      score: freshScore,
      detail: ageMins < 60 ? `Launched ${ageMins}m ago — prime breakout timing` : `Launched ${ageHours.toFixed(1)}h ago`,
    })
  }

  return patterns
}

function detectRedFlags(
  overview: TokenOverview | null,
  security: SecuritySummary,
  rugReport: RugCheckReport | null,
  holders: TokenHolder[],
  devHoldingPct: number
): RedFlag[] {
  const flags: RedFlag[] = []

  // Deployer holding too much
  if (devHoldingPct > 15) {
    flags.push({
      severity: devHoldingPct > 30 ? 'critical' : 'high',
      issue: 'Excessive Dev Bag',
      detail: `Deployer wallet holds ${devHoldingPct.toFixed(1)}% — high risk of dev dump`,
    })
  }

  // Freeze authority active
  if (!security.freezeAuthorityRevoked) {
    flags.push({
      severity: 'critical',
      issue: 'Active Freeze Authority',
      detail: 'Deployer or owner can freeze token accounts / prevent transfers',
    })
  }

  // Mint authority active
  if (!security.mintAuthorityRevoked) {
    flags.push({
      severity: 'critical',
      issue: 'Active Mint Authority',
      detail: 'Deployer can mint unlimited new tokens and dilute supply',
    })
  }

  // Rugged flag
  if (security.rugged) {
    flags.push({
      severity: 'critical',
      issue: 'Flagged Rugged',
      detail: 'Token has been reported or confirmed as rugged',
    })
  }

  // RugCheck danger risks
  if (rugReport?.risks) {
    for (const r of rugReport.risks) {
      if (r.level === 'danger') {
        flags.push({
          severity: 'high',
          issue: r.name,
          detail: r.description || r.value || 'High risk flagged by RugCheck audit',
        })
      }
    }
  }

  // Whale domination in non-dev holders (excluding LP / bonding curve reserve)
  const pairAddr = (overview?.pairAddress || '').toLowerCase()
  const whales = holders.filter(h => {
    const addr = h.address.toLowerCase()
    if (h.isDeployer) return false
    if (pairAddr && addr === pairAddr) return false
    return h.percentage >= 10
  })
  if (whales.length >= 2) {
    flags.push({
      severity: 'high',
      issue: 'Sniper / Whale Clusters',
      detail: `${whales.length} separate wallets each hold >=10% of supply`,
    })
  }

  // Extreme low liquidity outside bonding curve
  if (!security.isBondingCurve && overview?.liquidity !== null && overview?.liquidity !== undefined && overview.liquidity < 500) {
    flags.push({
      severity: 'high',
      issue: 'Critically Low Liquidity',
      detail: `Only $${overview.liquidity.toFixed(0)} liquidity — extreme slippage risk`,
    })
  }

  return flags
}

function computeOverallScore(
  patterns: PatternScore[],
  redFlags: RedFlag[],
  microCapSpot: MicroCapSpot
): number {
  if (!patterns.length) return 50

  const baseScore = patterns.reduce((s, p) => s + p.score, 0) / patterns.length

  const deductions: Record<string, number> = {
    low: 5,
    medium: 12,
    high: 25,
    critical: 45,
  }
  const penalty = redFlags.reduce((s, f) => s + (deductions[f.severity] || 0), 0)

  let score = Math.round(baseScore - penalty)

  // Boost for verified high-confidence micro-cap 2x spot
  if (microCapSpot.isSpot && redFlags.length === 0) {
    score = Math.max(score, 75)
  }

  return Math.max(0, Math.min(100, score))
}

// Get analysis from DB cache
export async function getCachedAnalysis(mint: string): Promise<AnalysisResult | null> {
  try {
    const db = getDb()
    const result = await db.execute({
      sql: `SELECT * FROM analyses WHERE id = ?`,
      args: [mint],
    })
    if (!result.rows || !result.rows.length) return null
    const row = result.rows[0]
    const parsed = typeof row.result === 'string' ? JSON.parse(row.result) : row.result
    return {
      mint: row.id,
      timestamp: row.created_at,
      ...parsed,
    }
  } catch {
    return null
  }
}