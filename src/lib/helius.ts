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
  const url = `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json
}

export async function getTokenInfo(mint: string): Promise<TokenInfo | null> {
  try {
    const supply = await rpcCall('getTokenSupply', [mint])
    if (!supply?.result?.value) return null
    const totalSupply = Number(supply.result.value.amount) / Math.pow(10, supply.result.value.decimals)

    // Get earliest signature to find deployer
    const sigs = await rpcCall('getSignaturesForAddress', [mint, { limit: 1 }])
    if (!sigs?.result?.length) return null
    const firstSig = sigs.result[0]
    const deployerAddress = firstSig.signature
    const deployTimestamp = firstSig.blockTime || 0

    return { mint, deployerAddress, deployTimestamp, totalSupply }
  } catch (error) {
    console.error(`Error fetching token info for ${mint}:`, error)
    return null
  }
}

export async function getTokenHolders(
  mint: string,
  deployerAddress: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deployTimestamp: number
): Promise<TokenHolder[]> {
  try {
    const accounts = await rpcCall('getTokenAccountsByMint', [
      mint,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ])
    if (!accounts?.result?.value?.length) return []

    const totalSupply = accounts.result.value.reduce(
      (sum: number, a: any) => sum + Number(a.account.data.parsed.info.tokenAmount.amount),
      0,
    )
    const holders: TokenHolder[] = accounts.result.value.map((item: any) => {
      const info = item.account.data.parsed.info
      const amount = Number(info.tokenAmount.amount)
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