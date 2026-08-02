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
  txns: { m5: { buys: number; sells: number }; h1: { buys: number; sells: number }; h6: { buys: number; sells: number }; h24: { buys: number; sells: number } }
  volume: { m5: string; h1: string; h6: string; h24: string }
  priceChange: { m5: number; h1: number; h6: number; h24: number }
  liquidity: { usd: string; base: string; quote: string }
  fdv: string
  marketCap: string
  pairCreatedAt: number
  info: {
    image: string
    header: string
    openGraph: string
    websites: { label: string; url: string }[]
    socials: { type: string; url: string }[]
  }
  boosts: { active: number; done: number }
  holders?: { address: string; amount: number; percent: number }[]
}

// Search token by address
export async function searchToken(mint: string): Promise<DexToken | null> {
  try {
    const res = await fetch(`${BASE}/search?q=${mint}`, {
      headers: { accept: 'application/json' },
    })
    const json = await res.json()
    if (!json?.pairs?.length) return null

    // Find the pair with most liquidity (usually the main one)
    const pairs = json.pairs.sort((a: any, b: any) =>
      parseFloat(b.liquidity?.usd || '0') - parseFloat(a.liquidity?.usd || '0')
    )
    return pairs[0]
  } catch {
    return null
  }
}

// Get token profile with holders
export async function getTokenProfile(mint: string): Promise<DexToken | null> {
  return searchToken(mint)
}

export interface TokenOverview {
  address: string
  price: number | null
  mc: number | null
  liquidity: number | null
  volume24h: number | null
  fdv: number | null
  holderCount: number | null
  txns24h: { buys: number; sells: number } | null
  priceChange24h: number | null
  pairCreatedAt: number | null
  boosts: number | null
}

export async function getTokenOverview(mint: string): Promise<TokenOverview | null> {
  const token = await searchToken(mint)
  if (!token) return null

  return {
    address: mint,
    price: parseFloat(token.priceUsd) || null,
    mc: parseFloat(token.marketCap) || null,
    liquidity: parseFloat(token.liquidity?.usd) || null,
    volume24h: parseFloat(token.volume?.h24) || null,
    fdv: parseFloat(token.fdv) || null,
    holderCount: token.holders?.length || null,
    txns24h: token.txns?.h24 ? { buys: token.txns.h24.buys, sells: token.txns.h24.sells } : null,
    priceChange24h: token.priceChange?.h24 ?? null,
    pairCreatedAt: token.pairCreatedAt || null,
    boosts: token.boosts?.active ?? null,
  }
}

// Detect wash trading / volume manipulation
export function detectVolumeManipulation(token: DexToken): {
  isManipulated: boolean
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
} {
  const reasons: string[] = []

  const volM5 = parseFloat(token.volume?.m5 || '0')
  const _volH1 = parseFloat(token.volume?.h1 || '0')
  const volH24 = parseFloat(token.volume?.h24 || '0')
  const liq = parseFloat(token.liquidity?.usd || '0')
  const buysM5 = token.txns?.m5?.buys || 0
  const sellsM5 = token.txns?.m5?.sells || 0

  // Volume-to-liquidity ratio too high = suspicious
  if (volH24 > 0 && liq > 0 && volH24 / liq > 20) {
    reasons.push(`Volume/liq ratio ${(volH24/liq).toFixed(1)}x — extremely high`)
  }

  // M5 volume > 50% of 24h volume = pump & dump pattern
  if (volM5 > 0 && volH24 > 0 && volM5 / volH24 > 0.5) {
    reasons.push(`5min volume is ${((volM5/volH24)*100).toFixed(0)}% of 24h volume — wash trading`)
  }

  // No sells = manipulated buys
  if (buysM5 > 10 && sellsM5 === 0) {
    reasons.push('High buys with zero sells — unnatural')
  }

  // Liquidity too low relative to volume
  if (volH24 > 50000 && liq < 5000) {
    reasons.push('High volume with <$5k liquidity — fabricated volume')
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