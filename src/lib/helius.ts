/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from './config'

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
  if (!config.heliusApiKey) return { result: null }
  const url = `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return { result: null }
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    if (json.error) return { result: null }
    return json
  } catch { return { result: null } }
}

export async function getTokenInfo(mint: string): Promise<TokenInfo | null> {
  try {
    const supply = await rpcCall('getTokenSupply', [mint])
    if (!supply?.result?.value) return null
    const totalSupply = Number(supply.result.value.amount) / Math.pow(10, supply.result.value.decimals)

    // Derive the deployer wallet from the earliest signature for this mint:
    // fetch that transaction and take the fee payer (first account signer).
    const sigs = await rpcCall('getSignaturesForAddress', [mint, { limit: 1 }])
    if (!sigs?.result?.length) return null
    const firstSig = sigs.result[0]
    const deployTimestamp = firstSig.blockTime || 0

    let deployerAddress = ''
    const tx = await rpcCall('getTransaction', [
      firstSig.signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ])
    const msg = tx?.result?.transaction?.message
    if (msg) {
      const keys = msg.accountKeys || []
      const feePayer = keys.find((k: any) => k?.signer) || keys[0]
      deployerAddress = typeof feePayer === 'string' ? feePayer : feePayer?.pubkey || ''
    }

    if (!deployerAddress) return null
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
    const accounts = await rpcCall('getTokenAccountsByMint', [
      mint,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ])
    if (!accounts?.result?.value?.length) return []

    // Percentage must be relative to the real on-chain supply, not the sum of
    // fetched accounts (pagination truncation would otherwise skew it).
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
        isDeployer: address === deployerAddress,
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
  try {
    const accounts = await rpcCall('getTokenAccountsByMint', [
      mint,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ])
    if (!accounts?.result?.value?.length) return []

    return accounts.result.value
      .map((item: any) => ({
        address: item.account.data.parsed.info.owner,
        amount: Number(item.account.data.parsed.info.tokenAmount.amount),
      }))
      .sort((a: any, b: any) => b.amount - a.amount)
      .slice(0, limit)
  } catch {
    return []
  }
}

// Raw Helius DAS API for transaction history
export async function getAssetSignatures(mint: string, limit = 50): Promise<any[]> {
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