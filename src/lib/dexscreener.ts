/* eslint-disable @typescript-eslint/no-explicit-any */

// DexScreener API — free, no key needed
const BASE = 'https://api.dexscreener.com/latest/dex'

export interface DexToken {
  chainId: string
  dexId: string
  url: string
  pairAddress: string
  baseToken: { address: string; name: string; symbol: string }
  quoteToken: { address: string; name: string; symbol: string }
  priceNative: string
  priceUsd: string
  txns: {
    m5: { buys: number; sells: number }
    h1: { buys: number; sells: number }
    h6: { buys: number; sells: number }
    h24: { buys: number; sells: number }
  }
  volume: { m5: number | string; h1: number | string; h6: number | string; h24: number | string }
  priceChange: { m5: number; h1: number; h6: number; h24: number }
  liquidity?: { usd?: number | string; base?: number | string; quote?: number | string }
  fdv: number | string
  marketCap: number | string
  pairCreatedAt: number
  info?: {
    image?: string
    header?: string
    openGraph?: string
    websites?: { label: string; url: string }[]
    socials?: { type: string; url: string }[]
  }
  boosts?: { active: number; done: number }
  holders?: { address: string; amount: number; percent: number }[]
}

// Search token by mint address using direct token endpoint with search fallback
export async function searchToken(mint: string): Promise<DexToken | null> {
  try {
    // 1. First try the direct token endpoint (fast, exact match, un-throttled)
    const directRes = await fetch(`${BASE}/tokens/${mint}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (directRes.ok) {
      const directJson = await directRes.json()
      if (directJson?.pairs && Array.isArray(directJson.pairs) && directJson.pairs.length > 0) {
        return selectBestPair(directJson.pairs)
      }
    }

    // 2. Fallback to search endpoint if direct lookup returned no pairs
    const searchRes = await fetch(`${BASE}/search?q=${mint}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (searchRes.ok) {
      const searchJson = await searchRes.json()
      if (searchJson?.pairs && Array.isArray(searchJson.pairs) && searchJson.pairs.length > 0) {
        return selectBestPair(searchJson.pairs)
      }
    }

    return null
  } catch (err) {
    console.debug(`DexScreener search error for ${mint}:`, err)
    return null
  }
}

// Helper to select the most relevant Solana pair
function selectBestPair(pairs: any[]): DexToken | null {
  if (!pairs.length) return null

  // Prioritize solana chain pairs
  const solanaPairs = pairs.filter(p => p.chainId === 'solana')
  const candidates = solanaPairs.length > 0 ? solanaPairs : pairs

  // Sort by liquidity USD descending, then by marketCap descending
  const sorted = [...candidates].sort((a, b) => {
    const liqA = parseFloat(a.liquidity?.usd || '0')
    const liqB = parseFloat(b.liquidity?.usd || '0')
    if (liqA !== liqB) return liqB - liqA
    const mcA = parseFloat(a.marketCap || a.fdv || '0')
    const mcB = parseFloat(b.marketCap || b.fdv || '0')
    return mcB - mcA
  })

  return sorted[0]
}

// Get token profile
export async function getTokenProfile(mint: string): Promise<DexToken | null> {
  return searchToken(mint)
}

export interface TokenOverview {
  address: string
  symbol: string | null
  name: string | null
  dexId: string | null
  pairAddress: string | null
  price: number | null
  mc: number | null
  liquidity: number | null
  volume24h: number | null
  fdv: number | null
  holderCount: number | null
  txns24h: { buys: number; sells: number } | null
  priceChange24h: number | null
  txnsM5: { buys: number; sells: number } | null
  volumeM5: number | null
  priceChangeM5: number | null
  txnsH1: { buys: number; sells: number } | null
  volumeH1: number | null
  priceChangeH1: number | null
  pairCreatedAt: number | null
  boosts: number | null
  supply: number | null
}

export async function getTokenOverview(mint: string): Promise<TokenOverview | null> {
  const token = await searchToken(mint)
  if (!token) return null

  const mc = parseFloat(String(token.marketCap || '')) || parseFloat(String(token.fdv || '')) || null
  const liqRaw = token.liquidity?.usd !== undefined ? parseFloat(String(token.liquidity.usd)) : null

  return {
    address: mint,
    symbol: token.baseToken?.symbol || null,
    name: token.baseToken?.name || null,
    dexId: token.dexId || null,
    pairAddress: token.pairAddress || null,
    price: parseFloat(token.priceUsd) || null,
    mc,
    liquidity: liqRaw,
    volume24h: parseFloat(String(token.volume?.h24 || '')) || null,
    fdv: parseFloat(String(token.fdv || '')) || null,
    holderCount: token.holders?.length || null,
    txns24h: token.txns?.h24 ? { buys: token.txns.h24.buys, sells: token.txns.h24.sells } : null,
    priceChange24h: token.priceChange?.h24 ?? null,
    txnsM5: token.txns?.m5 ? { buys: token.txns.m5.buys, sells: token.txns.m5.sells } : null,
    volumeM5: parseFloat(String(token.volume?.m5 || '')) || null,
    priceChangeM5: token.priceChange?.m5 ?? null,
    txnsH1: token.txns?.h1 ? { buys: token.txns.h1.buys, sells: token.txns.h1.sells } : null,
    volumeH1: parseFloat(String(token.volume?.h1 || '')) || null,
    priceChangeH1: token.priceChange?.h1 ?? null,
    pairCreatedAt: token.pairCreatedAt || null,
    boosts: token.boosts?.active ?? null,
    supply: null,
  }
}

// Detect wash trading / volume manipulation
export function detectVolumeManipulation(token: DexToken): {
  isManipulated: boolean
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
} {
  const reasons: string[] = []

  const volM5 = parseFloat(String(token.volume?.m5 || '0'))
  const volH24 = parseFloat(String(token.volume?.h24 || '0'))
  const liq = parseFloat(String(token.liquidity?.usd || '0'))
  const buysM5 = token.txns?.m5?.buys || 0
  const sellsM5 = token.txns?.m5?.sells || 0

  // Volume-to-liquidity ratio too high = suspicious
  if (volH24 > 0 && liq > 0 && volH24 / liq > 25) {
    reasons.push(`Volume/liq ratio ${(volH24 / liq).toFixed(1)}x — extremely high`)
  }

  // M5 volume > 50% of 24h volume on an older token = pump & dump pattern
  const ageHours = token.pairCreatedAt ? (Date.now() - token.pairCreatedAt) / 3600000 : 0
  if (ageHours > 6 && volM5 > 0 && volH24 > 0 && volM5 / volH24 > 0.5) {
    reasons.push(`5min volume is ${((volM5 / volH24) * 100).toFixed(0)}% of 24h volume — wash trading`)
  }

  // No sells with massive buys
  if (buysM5 > 20 && sellsM5 === 0) {
    reasons.push('High buys with zero sells — unnatural or honeypot')
  }

  // Fabricated volume
  if (volH24 > 50000 && liq > 0 && liq < 2000) {
    reasons.push('High volume with <$2k liquidity — fabricated volume')
  }

  const confidence: 'high' | 'medium' | 'low' =
    reasons.length >= 3 ? 'high' :
    reasons.length >= 2 ? 'medium' :
    reasons.length >= 1 ? 'low' : 'low'

  return { isManipulated: reasons.length > 0, confidence, reasons }
}

// Detect whale wallets from holder data
export function detectWhales(holders: { address: string; amount: number; percent: number }[]): {
  whales: { address: string; percent: number }[]
  totalWhalePercent: number
} {
  const whales = holders
    .filter(h => h.percent >= 5)
    .map(h => ({ address: h.address, percent: h.percent }))
    .sort((a, b) => b.percent - a.percent)

  return {
    whales,
    totalWhalePercent: whales.reduce((s, w) => s + w.percent, 0),
  }
}