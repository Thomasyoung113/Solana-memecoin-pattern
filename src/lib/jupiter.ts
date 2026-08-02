/* eslint-disable @typescript-eslint/no-explicit-any */

// Jupiter API — free, no key needed
const JUPITER_API = 'https://api.jup.ag/api/v1'

export async function getTokenPrice(mint: string): Promise<number | null> {
  try {
    const res = await fetch(`${JUPITER_API}/price?ids=${mint}`, {
      headers: { 'accept': 'application/json' },
    })
    const json = await res.json()
    return json?.data?.[mint]?.price ?? null
  } catch {
    return null
  }
}

export async function getTokenInfo(mint: string): Promise<{
  price: number | null
  mc: number | null
  volume24h: number | null
  liquidity: number | null
  fdv: number | null
} | null> {
  try {
    const [priceData, strictData] = await Promise.all([
      getTokenPrice(mint),
      fetch(`${JUPITER_API}/strict-token/${mint}`, { headers: { accept: 'application/json' } }).then(r => r.json()).catch(() => null),
    ])

    const strict = strictData || {}
    const price = priceData ?? (strict?.price ?? null)

    return {
      price,
      mc: null, // Jupiter doesn't provide MC directly
      volume24h: strict?.volume24h ?? null,
      liquidity: strict?.liquidity ?? null,
      fdv: strict?.fdv ?? null,
    }
  } catch {
    return null
  }
}

// Get token holders via Jupiter's token list
export async function getTokenHolders(mint: string): Promise<any[]> {
  try {
    // Use Jupiter's token info for supply data
    const res = await fetch(`${JUPITER_API}/token/${mint}`, {
      headers: { accept: 'application/json' },
    })
    const _json = await res.json()
    // Jupiter doesn't provide holder data
    return []
  } catch {
    return []
  }
}