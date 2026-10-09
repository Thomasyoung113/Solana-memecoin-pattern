/* eslint-disable @typescript-eslint/no-explicit-any */

// Unified bridge using DexScreener (pricing/overview) and RugCheck (security)
// Free APIs, no keys needed. Preserves the birdeye export signatures.

import { getTokenOverview as dexOverview, type TokenOverview } from './dexscreener'
import { getTokenPrice as jupiterPrice } from './jupiter'
import { getSecurityInfo as rcSecurityInfo } from './rugcheck'

export type { TokenOverview }

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
  return dexOverview(address)
}

// Get price via Jupiter
export async function getTokenPrice(address: string): Promise<number | null> {
  return jupiterPrice(address)
}

// OHLCV — return null (free tier doesn't provide historical candles)
export async function getOhlcv(
  _address: string,
  _type?: string,
  _timeFrom?: number,
  _timeTo?: number
): Promise<OHLCV[] | null> {
  return null
}

// Security info — powered by free RugCheck API
export async function getSecurityInfo(address: string): Promise<any | null> {
  return rcSecurityInfo(address)
}

// Trades — return null
export async function getTrades(_address: string, _limit?: number): Promise<any[] | null> {
  return null
}

// Trending — return null
export async function getTrending(): Promise<any[] | null> {
  return null
}