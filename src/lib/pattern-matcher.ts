import type { AnalysisResult } from './analyzer'

// === SHARED TYPES ===

export interface DeployerProfile {
  address: string
  tokensLaunched: number
  tokens: string[]
  avgScore: number
  prevSuccess: boolean
  prevSuccessMint?: string
}

export interface HolderCluster {
  address: string
  appearsIn: number // how many tokens this holder bought early
  tokens: string[]
  avgEntryTime: number // avg minutes after deploy they first buy
  totalInvested: number
  estimatedPnL: 'high' | 'mid' | 'low' | 'unknown'
}

export interface TokenSimilarity {
  mintA: string
  mintB: string
  similarityScore: number // 0–100
  sharedDeployer: boolean
  sharedEarlyBuyers: number
  similarMc: boolean
  similarLaunchWindow: boolean
  similarHolderConcentration: boolean
  matchReasons: string[]
}

export interface ReplicaPrediction {
  mint: string
  replicaScore: number // 0–100
  matchedToken: string // the successful token it resembles
  matchFactors: string[]
  confidence: 'high' | 'medium' | 'low'
}

export interface EntrySignal {
  mint: string
  entryScore: number // 0–100
  suggestedEntry: string
  avgFirstPumpTime: string | null
  avgMultiplier: string | null
  riskLevel: 'low' | 'medium' | 'high'
  isMicroCap2xSpot?: boolean
}

export interface PatternAnalysis {
  timestamp: number
  mints: string[]
  totalAnalyzed: number
  successfulCount: number
  microCapSpotsCount: number
  // Per-token details
  tokenDetails: TokenDetail[]
  // Cross-token findings
  deployerProfiles: DeployerProfile[]
  holderClusters: HolderCluster[]
  tokenSimilarities: TokenSimilarity[]
  // Predictions
  replicaPredictions: ReplicaPrediction[]
  entrySignals: EntrySignal[]
  // Summary
  insights: string[]
}

export interface TokenDetail {
  mint: string
  washTradingScore: number
  whaleConcentration: number
  realVolume: number | null
  creatorFees: { feeBps: number; isReasonable: boolean } | null
  maxMc: number | null
  smartMoneyCount: number
  earlyBuyerCount: number
  isMicroCapSpot: boolean
}

// === MAIN ENGINE ===

export function analyzePatterns(results: AnalysisResult[]): PatternAnalysis {
  const timestamp = Date.now()
  const mints = results.map(r => r.mint)
  const totalAnalyzed = results.length
  const successful = results.filter(r => r.overallScore >= 65)
  const successfulCount = successful.length
  const microCapSpots = results.filter(r => r.microCapSpot?.isSpot)
  const microCapSpotsCount = microCapSpots.length

  // 1. Build deployer profiles
  const deployerMap = new Map<string, DeployerProfile>()
  for (const r of results) {
    const deployer = r.holders.find(h => h.isDeployer)
    if (!deployer || !deployer.address) continue
    const existing = deployerMap.get(deployer.address)
    if (existing) {
      existing.tokensLaunched++
      existing.tokens.push(r.mint)
      existing.avgScore = (existing.avgScore + r.overallScore) / 2
    } else {
      deployerMap.set(deployer.address, {
        address: deployer.address,
        tokensLaunched: 1,
        tokens: [r.mint],
        avgScore: r.overallScore,
        prevSuccess: r.overallScore >= 65,
        prevSuccessMint: r.overallScore >= 65 ? r.mint : undefined,
      })
    }
  }
  const deployerProfiles = Array.from(deployerMap.values())
    .sort((a, b) => b.tokensLaunched - a.tokensLaunched)

  // 1b. Find holder clusters — wallets that appear in multiple tokens
  const holderMap = new Map<string, HolderCluster>()
  for (const r of results) {
    // Early buyers = within top 10 holders that aren't deployer
    const early = r.holders
      .filter(h => !h.isDeployer && h.address)
      .slice(0, 10)

    for (const h of early) {
      const existing = holderMap.get(h.address)
      if (existing) {
        existing.appearsIn++
        if (!existing.tokens.includes(r.mint)) existing.tokens.push(r.mint)
      } else {
        holderMap.set(h.address, {
          address: h.address,
          appearsIn: 1,
          tokens: [r.mint],
          avgEntryTime: 0,
          totalInvested: 0,
          estimatedPnL: 'unknown',
        })
      }
    }
  }
  const holderClusters = Array.from(holderMap.values())
    .filter(h => h.appearsIn >= 2)
    .sort((a, b) => b.appearsIn - a.appearsIn)

  // 1c. Build token details
  const tokenDetails: TokenDetail[] = results.map(r => {
    const topHolders = r.holders.slice(0, 20)
    const whales = topHolders.filter(h => h.percentage >= 5)
    const whaleConcentration = whales.reduce((s, h) => s + h.percentage, 0)

    const earlyBuyers = r.holders.filter(h => !h.isDeployer && h.percentage > 0)
    const earlyBuyerCount = earlyBuyers.length

    const smartMoneyCount = holderClusters.filter(h =>
      earlyBuyers.some(e => e.address === h.address)
    ).length

    return {
      mint: r.mint,
      washTradingScore: 0,
      whaleConcentration: Math.round(whaleConcentration * 10) / 10,
      realVolume: r.overview?.volume24h ?? null,
      creatorFees: null,
      maxMc: r.overview?.mc ?? null,
      smartMoneyCount,
      earlyBuyerCount,
      isMicroCapSpot: Boolean(r.microCapSpot?.isSpot),
    }
  })

  // 2. Pairwise token similarity
  const tokenSimilarities: TokenSimilarity[] = []

  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i], b = results[j]
      const aDeployer = a.holders.find(h => h.isDeployer)
      const bDeployer = b.holders.find(h => h.isDeployer)
      const sharedDeployer = aDeployer !== undefined && bDeployer !== undefined && aDeployer.address === bDeployer.address

      const aBuyers = new Set(a.holders.filter(h => !h.isDeployer).slice(0, 20).map(h => h.address))
      const bBuyers = new Set(b.holders.filter(h => !h.isDeployer).slice(0, 20).map(h => h.address))
      const sharedBuyers = [...aBuyers].filter(x => bBuyers.has(x))

      const similarMc = a.overview?.mc !== null && b.overview?.mc !== null &&
        Math.abs(Math.log2(((a.overview?.mc || 1) / (b.overview?.mc || 1)))) < 2

      const aTop10 = a.holders.slice(0, 10).reduce((s, h) => s + h.percentage, 0)
      const bTop10 = b.holders.slice(0, 10).reduce((s, h) => s + h.percentage, 0)
      const similarConcentration = Math.abs(aTop10 - bTop10) < 20

      const scoreDiff = Math.abs(a.overallScore - b.overallScore)
      const baseSim = Math.max(0, 100 - scoreDiff * 3)

      const matchReasons: string[] = []
      if (sharedDeployer) matchReasons.push('Shared deployer')
      if (sharedBuyers.length > 0) matchReasons.push(`${sharedBuyers.length} overlapping early buyers`)
      if (similarMc) matchReasons.push('Similar market cap range')
      if (similarConcentration) matchReasons.push('Similar holder concentration')

      let similarityScore = baseSim
      if (sharedDeployer) similarityScore += 20
      if (sharedBuyers.length > 0) similarityScore += Math.min(15, sharedBuyers.length * 5)
      if (similarMc) similarityScore += 10
      if (similarConcentration) similarityScore += 10
      similarityScore = Math.min(100, similarityScore)

      if (similarityScore > 30) {
        tokenSimilarities.push({
          mintA: a.mint, mintB: b.mint,
          similarityScore: Math.round(similarityScore),
          sharedDeployer, sharedEarlyBuyers: sharedBuyers.length, similarMc,
          similarLaunchWindow: false, similarHolderConcentration: similarConcentration,
          matchReasons,
        })
      }
    }
  }
  tokenSimilarities.sort((a, b) => b.similarityScore - a.similarityScore)

  // 3. Replica predictions
  const replicaPredictions: ReplicaPrediction[] = []
  if (successfulCount > 0) {
    for (const r of results) {
      if (r.overallScore >= 65) continue
      const rDeployer = r.holders.find(h => h.isDeployer)
      const rBuyers = new Set(r.holders.filter(h => !h.isDeployer).slice(0, 20).map(h => h.address))

      for (const s of successful) {
        if (s.mint === r.mint) continue
        const sDeployer = s.holders.find(h => h.isDeployer)
        const matchFactors: string[] = []

        if (rDeployer && sDeployer && rDeployer.address === sDeployer.address) {
          matchFactors.push(`Same deployer as ${s.mint.slice(0, 8)} (previous success)`)
        }

        const sBuyers = new Set(s.holders.filter(h => !h.isDeployer).slice(0, 20).map(h => h.address))
        const overlap = [...rBuyers].filter(x => sBuyers.has(x))
        if (overlap.length >= 3) {
          matchFactors.push(`${overlap.length} early buyers also bought ${s.mint.slice(0, 8)}`)
        }

        const rTop10 = r.holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0)
        const sTop10 = s.holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0)
        if (Math.abs(rTop10 - sTop10) < 15) {
          matchFactors.push('Holder distribution similar to successful token')
        }

        if (matchFactors.length > 0) {
          replicaPredictions.push({
            mint: r.mint,
            replicaScore: Math.round(30 + matchFactors.length * 20),
            matchedToken: s.mint,
            matchFactors,
            confidence: matchFactors.length >= 3 ? 'high' : matchFactors.length >= 2 ? 'medium' : 'low',
          })
        }
      }
    }
  }
  replicaPredictions.sort((a, b) => b.replicaScore - a.replicaScore)

  // 4. Entry signals — specialized for Micro-Cap 2x-5x spots
  const entrySignals: EntrySignal[] = []
  for (const r of results) {
    const avgScore = r.overallScore
    const redFlagCount = r.redFlags.length
    const isMicroCap = Boolean(r.microCapSpot?.isSpot)

    let entryScore = Math.max(0, Math.min(100, avgScore - redFlagCount * 10))
    let suggestedEntry: string
    let avgFirstPumpTime: string | null = null
    let avgMultiplier: string | null = null
    let riskLevel: 'low' | 'medium' | 'high'

    if (isMicroCap && redFlagCount === 0) {
      entryScore = Math.max(85, entryScore)
      const tp1Gain = r.microCapSpot.tp1_scalp?.potentialGain || '2.0x'
      const tp2Gain = r.microCapSpot.tp2_runner?.potentialGain || '5.0x'
      suggestedEntry = `⚡ QUICK 2X SPOT: Enter $8k–$15k MC -> TP1 at $20k MC (${tp1Gain}) | TP2 at $50k–$100k (${tp2Gain})`
      avgFirstPumpTime = '~15-45m momentum window'
      avgMultiplier = `TP1: ${tp1Gain} / TP2: ${tp2Gain}`
      riskLevel = r.microCapSpot.confidence === 'high' ? 'low' : 'medium'
    } else if (entryScore >= 65 && redFlagCount === 0) {
      suggestedEntry = 'Immediate — strong fundamentals, no red flags'
      riskLevel = 'low'
      avgMultiplier = '2x - 3x'
    } else if (entryScore >= 40 && redFlagCount <= 1) {
      suggestedEntry = 'Wait for first dip / confirmation — monitor buyer momentum'
      riskLevel = 'medium'
      avgMultiplier = '1.5x - 2x'
    } else {
      suggestedEntry = 'Avoid or wait for pattern confirmation — high risk of dump'
      riskLevel = 'high'
      avgMultiplier = null
    }

    entrySignals.push({
      mint: r.mint,
      entryScore,
      suggestedEntry,
      avgFirstPumpTime,
      avgMultiplier,
      riskLevel,
      isMicroCap2xSpot: isMicroCap,
    })
  }
  entrySignals.sort((a, b) => b.entryScore - a.entryScore)

  // 5. Generate insights
  const insights: string[] = []

  if (microCapSpotsCount > 0) {
    insights.push(`🎯 Detected ${microCapSpotsCount} Quick 2x Micro-Cap Spot(s) ($10k–$20k entry -> $50k–$100k target)`)
  }

  if (deployerProfiles.some(d => d.tokensLaunched >= 2)) {
    const serialDeployers = deployerProfiles.filter(d => d.tokensLaunched >= 2)
    insights.push(`${serialDeployers.length} deployer(s) launched multiple analyzed tokens — flag for tracking`)
  }

  if (holderClusters.length > 0) {
    const topCluster = holderClusters[0]
    insights.push(`Smart money cluster detected: wallet ${topCluster.address.slice(0, 8)}... appears in ${topCluster.appearsIn} tokens`)
  }

  if (replicaPredictions.length > 0) {
    insights.push(`${replicaPredictions.length} replica token(s) detected matching successful token patterns`)
  }

  if (successfulCount === 0 && microCapSpotsCount === 0) {
    insights.push('No high-scoring tokens in this batch — adjust filters or scan fresh tokens')
  } else {
    insights.push(`${successfulCount}/${totalAnalyzed} tokens scored bullish — focus on shared early buyer momentum among them`)
  }

  return {
    timestamp, mints, totalAnalyzed, successfulCount, microCapSpotsCount,
    tokenDetails, deployerProfiles, holderClusters, tokenSimilarities,
    replicaPredictions, entrySignals, insights,
  }
}