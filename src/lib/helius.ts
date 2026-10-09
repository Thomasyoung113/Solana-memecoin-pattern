/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from './config'
import { getRugCheckReport } from './rugcheck'

export interface TokenHolder {
  address: string
  amount: number
  percentage: number
  isDeployer: boolean
  isEarlyBuyer: boolean
  firstBuyTx?: string
  firstBuyTimestamp?: number
}

export interface TokenInfo {
  mint: string
  deployerAddress: string
  deployTimestamp: number
  totalSupply: number
}

async function rpcCall(method: string, params: any[]): Promise<any> {
  const url = config.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`
    : process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { result: null }
    const text = await res.text()
    const json = JSON.parse(text)
    if (json.error) return { result: null }
    return json
  } catch {
    return { result: null }
  }
}

export async function getTokenInfo(mint: string): Promise<TokenInfo | null> {
  try {
    // 1. First, check RugCheck (instant, free, verified creator & genesis)
    const rugReport = await getRugCheckReport(mint)
    if (rugReport && rugReport.creator) {
      return {
        mint,
        deployerAddress: rugReport.creator,
        deployTimestamp: rugReport.detectedAt
          ? Math.floor(rugReport.detectedAt / 1000)
          : Math.floor(Date.now() / 1000) - 1800,
        totalSupply: rugReport.supply > 0
          ? rugReport.supply / Math.pow(10, rugReport.decimals || 6)
          : 1_000_000_000,
      }
    }

    // 2. Fallback to on-chain RPC supply
    const supply = await rpcCall('getTokenSupply', [mint])
    const totalSupply = supply?.result?.value
      ? Number(supply.result.value.amount) / Math.pow(10, supply.result.value.decimals)
      : 0

    // Fetch signatures to find the genesis deploy transaction.
    // getSignaturesForAddress returns transactions in reverse chronological order (newest first).
    // The oldest transaction in the list is the last element.
    const sigs = await rpcCall('getSignaturesForAddress', [mint, { limit: 100 }])
    if (!sigs?.result?.length) {
      if (totalSupply > 0) {
        return { mint, deployerAddress: '', deployTimestamp: 0, totalSupply }
      }
      return null
    }

    // Take the last (oldest) signature in the retrieved list
    const oldestSig = sigs.result[sigs.result.length - 1]
    const deployTimestamp = oldestSig.blockTime || 0

    let deployerAddress = ''
    const tx = await rpcCall('getTransaction', [
      oldestSig.signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ])
    const msg = tx?.result?.transaction?.message
    if (msg) {
      const keys = msg.accountKeys || []
      const feePayer = keys.find((k: any) => k?.signer) || keys[0]
      deployerAddress = typeof feePayer === 'string' ? feePayer : feePayer?.pubkey || ''
    }

    return { mint, deployerAddress, deployTimestamp, totalSupply }
  } catch (error) {
    console.error(`Error fetching token info for ${mint}:`, error)
    return null
  }
}

export async function getTokenHolders(
  mint: string,
  deployerAddress: string,
  _deployTimestamp: number
): Promise<TokenHolder[]> {
  try {
    // 1. Try RugCheck topHolders first (works across all token types, Token-2022, and pumpfun)
    const rugReport = await getRugCheckReport(mint)
    if (rugReport && rugReport.topHolders && rugReport.topHolders.length > 0) {
      const activeDeployer = deployerAddress || rugReport.creator || ''
      return rugReport.topHolders.map(h => ({
        address: h.address,
        amount: h.amount,
        percentage: h.pct,
        isDeployer: Boolean(activeDeployer && h.address.toLowerCase() === activeDeployer.toLowerCase()),
        isEarlyBuyer: h.insider,
      }))
    }

    // 2. Fallback to RPC: try standard Tokenkeg program first
    let accounts = await rpcCall('getTokenAccountsByMint', [
      mint,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ])

    // If empty, try Token-2022 program
    if (!accounts?.result?.value?.length) {
      accounts = await rpcCall('getTokenAccountsByMint', [
        mint,
        { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
        { encoding: 'jsonParsed' },
      ])
    }

    if (!accounts?.result?.value?.length) return []

    const supplyRes = await rpcCall('getTokenSupply', [mint])
    const supplyVal = supplyRes?.result?.value
    const totalSupply = supplyVal
      ? Number(supplyVal.amount) / Math.pow(10, supplyVal.decimals)
      : 0

    const holders: TokenHolder[] = accounts.result.value.map((item: any) => {
      const info = item.account.data.parsed.info
      const rawAmount = Number(info.tokenAmount.amount)
      const amount = rawAmount / Math.pow(10, info.tokenAmount.decimals ?? 0)
      const address = info.owner
      return {
        address,
        amount,
        percentage: totalSupply > 0 ? (amount / totalSupply) * 100 : 0,
        isDeployer: Boolean(deployerAddress && address.toLowerCase() === deployerAddress.toLowerCase()),
        isEarlyBuyer: false,
      }
    })

    holders.sort((a: TokenHolder, b: TokenHolder) => b.amount - a.amount)
    return holders
  } catch (error) {
    console.error(`Error fetching holders for ${mint}:`, error)
    return []
  }
}

export async function getTopTokenHolders(mint: string, limit = 20): Promise<{ address: string; amount: number }[]> {
  const holders = await getTokenHolders(mint, '', 0)
  return holders.slice(0, limit).map(h => ({ address: h.address, amount: h.amount }))
}

// Helius DAS API for transaction history
export async function getAssetSignatures(mint: string, limit = 50): Promise<any[]> {
  if (!config.heliusApiKey) return []
  try {
    const url = `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAsset',
        params: { mint, limit },
      }),
    })
    const json = await res.json()
    return json?.result || []
  } catch {
    return []
  }
}