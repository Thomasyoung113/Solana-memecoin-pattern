/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from './config'

const BIRDEYE_BASE = 'https://public-api.birdeye.so'

interface BirdeyeResponse<T> {
  success: boolean
  data: T
}

async function birdeyeFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BIRDEYE_BASE}${path}`, {
      headers: {
        'x-api-key': config.birdeyeApiKey,
        'accept': 'application/json',
      },
    })
    const json: BirdeyeResponse<T> = await res.json()
    return json.success ? json.data : null
  } catch (error) {
    console.error(`Birdeye API error [${path}]:`, error)
    return null
  }
}

export interface PricePoint {
  unixTime: number
  value: number
}

export interface TokenOverview {
  address: string
  mc: number | null
  price: number | null
  volume24h: number | null
  liquidity: number | null
  holderCount: number | null
  supply: number | null
}

export interface OHLCV {
  o: number
  h: number
  l: number
  c: number
  v: number
  unixTime: number
}

// Get token overview (market cap, price, liquidity, holders)
export async function getTokenOverview(address: string): Promise<TokenOverview | null> {
  const data = await birdeyeFetch<any>(`/defi/token_overview?address=${address}`)
  if (!data) return null

  return {
    address,
    mc: data.mc ?? null,
    price: data.price ?? null,
    volume24h: data.v24hUSD ?? null,
    liquidity: data.liquidity ?? null,
    holderCount: data.holder ?? null,
    supply: data.supply ?? null,
  }
}

// Get historical OHLCV for price analysis
export async function getOhlcv(
  address: string,
  type: '1m' | '5m' | '15m' | '30m' | '1H' | '4H' | '1D' = '1H',
  timeFrom?: number,
  timeTo?: number
): Promise<OHLCV[] | null> {
  let path = `/defi/ohlcv?address=${address}&type=${type}`
  if (timeFrom) path += `&time_from=${timeFrom}`
  if (timeTo) path += `&time_to=${timeTo}`

  const data = await birdeyeFetch<{ items: OHLCV[] }>(path)
  return data?.items ?? null
}

// Get historical price (simplified version)
export async function getHistoricalPrice(
  address: string,
  timeFrom?: number,
  timeTo?: number
): Promise<PricePoint[] | null> {
  const ohlcv = await getOhlcv(address, '1H', timeFrom, timeTo)
  if (!ohlcv) return null

  return ohlcv.map((p) => ({
    unixTime: p.unixTime,
    value: p.c,
  }))
}

// Get top traders (buyers/sellers with highest volume)
export async function getTopTraders(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _address: string
): Promise<any[] | null> {
  return null // Birdeye free tier limitations
}

// Get trending tokens on Solana
export async function getTrending(): Promise<any[] | null> {
  const data = await birdeyeFetch<any[]>('/defi/trending?chain=solana')
  return data
}

// Get security info (rug pull indicators)
export async function getSecurityInfo(address: string): Promise<any | null> {
  const data = await birdeyeFetch<any>(`/defi/token_security?address=${address}`)
  return data
}

// Get recent trades for a token
export async function getTrades(
  address: string,
  limit = 50
): Promise<any[] | null> {
  const data = await birdeyeFetch<any[]>(
    `/defi/txs/token?address=${address}&limit=${limit}`
  )
  return data
}