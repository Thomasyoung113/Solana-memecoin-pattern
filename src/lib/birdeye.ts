/* eslint-disable @typescript-eslint/no-explicit-any */

// REPLACED with DexScreener + Jupiter (free APIs, no keys needed)
// This file keeps the same exports so analyzer.ts doesn't need changing.

import { getTokenOverview as dexOverview } from './dexscreener'
import { getTokenPrice as jupiterPrice } from './jupiter'

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

// Get token overview via DexScreener
export async function getTokenOverview(address: string): Promise<TokenOverview | null> {
  const dex = await dexOverview(address)
  if (!dex) return null
  return {
    address,
    price: dex.price,
    mc: dex.mc,
    volume24h: dex.volume24h,
    liquidity: dex.liquidity,
    holderCount: dex.holderCount,
    supply: null, // DexScreener doesn't supply total supply
  }
}

// Get price via Jupiter
export async function getTokenPrice(address: string): Promise<number | null> {
  return jupiterPrice(address)
}

// OHLCV — DexScreener doesn't provide this directly, return null
export async function getOhlcv(
  _address: string,
  _type?: string,
  _timeFrom?: number,
  _timeTo?: number
): Promise<OHLCV[] | null> {
  return null
}

// Security info — DexScreener doesn't provide this
export async function getSecurityInfo(_address: string): Promise<any | null> {
  return null
}

// Trades — DexScreener doesn't provide trade-level data
export async function getTrades(_address: string, _limit?: number): Promise<any[] | null> {
  return null
}

// Trending — return null (no trending from DexScreener free API)
export async function getTrending(): Promise<any[] | null> {
  return null
}