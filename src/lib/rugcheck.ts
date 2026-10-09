/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RugCheckRisk {
  name: string
  value?: string
  description: string
  score: number
  level: 'danger' | 'warn'
}

export interface RugCheckReport {
  mint: string
  tokenProgram: string
  creator: string | null
  creatorBalance: number | null
  tokenType: string | null
  mintAuthority: string | null
  freezeAuthority: string | null
  supply: number
  decimals: number
  lpLockedPct: number
  isBondingCurve: boolean
  launchpad: string | null
  score: number // RugCheck risk score (0 is best, >1000 is danger)
  risks: RugCheckRisk[]
  topHolders: Array<{
    address: string
    amount: number
    pct: number
    insider: boolean
  }>
  rugged: boolean
  detectedAt?: number
}

export async function getRugCheckReport(mint: string): Promise<RugCheckReport | null> {
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || typeof data !== 'object') return null

    const risks: RugCheckRisk[] = (data.risks || []).map((r: any) => ({
      name: r.name || 'Unknown risk',
      value: r.value !== undefined ? String(r.value) : undefined,
      description: r.description || '',
      score: Number(r.score || 0),
      level: r.level === 'danger' ? 'danger' : 'warn',
    }))

    // In RugCheck, h.owner is the real wallet address, while h.address is the ATA
    const topHolders = (data.topHolders || []).map((h: any) => ({
      address: h.owner || h.address || '',
      amount: Number(h.uiAmount ?? h.amount ?? 0),
      pct: Number(h.pct || 0),
      insider: Boolean(h.insider),
    }))

    const isBondingCurve = Boolean(
      data.launchpad ||
      data.tokenType === 'pump_fun' ||
      data.tokenType === 'pumpfun' ||
      (Array.isArray(data.markets) && data.markets.some((m: any) => m.marketType === 'pump_fun'))
    )

    // Calculate LP lock %
    let lpLockedPct = 0
    if (isBondingCurve) {
      // Pump.fun / bonding curve tokens cannot have LP pulled by dev
      lpLockedPct = 100
    } else if (Array.isArray(data.markets) && data.markets.length > 0) {
      for (const m of data.markets) {
        if (m.lp && typeof m.lp.lpLockedPct === 'number') {
          lpLockedPct = Math.max(lpLockedPct, m.lp.lpLockedPct)
        }
      }
    } else if (typeof data.lpLockedPct === 'number') {
      lpLockedPct = data.lpLockedPct
    }

    const mintAuth = data.token?.mintAuthority ?? data.mintAuthority ?? null
    const freezeAuth = data.token?.freezeAuthority ?? data.freezeAuthority ?? null
    const supply = Number(data.token?.supply ?? data.supply ?? 0)
    const decimals = Number(data.token?.decimals ?? data.decimals ?? 0)

    return {
      mint,
      tokenProgram: data.tokenProgram || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      creator: data.creator || null,
      creatorBalance: data.creatorBalance !== undefined ? Number(data.creatorBalance) : null,
      tokenType: data.tokenType || (isBondingCurve ? 'pump_fun' : null),
      mintAuthority: mintAuth,
      freezeAuthority: freezeAuth,
      supply,
      decimals,
      lpLockedPct,
      isBondingCurve,
      launchpad: data.launchpad?.name || (isBondingCurve ? 'Pump.Fun' : null),
      score: Number(data.score || 0),
      risks,
      topHolders,
      rugged: Boolean(data.rugged),
      detectedAt: data.detectedAt ? new Date(data.detectedAt).getTime() : undefined,
    }
  } catch (err) {
    console.debug(`RugCheck report error for ${mint}:`, err)
    return null
  }
}

export async function getSecurityInfo(mint: string): Promise<{
  score: number
  lpLockedPct: number
  hasMintAuthority: boolean
  hasFreezeAuthority: boolean
  creator: string | null
  creatorBalancePct: number | null
  isBondingCurve: boolean
  rugged: boolean
  risks: RugCheckRisk[]
} | null> {
  const rep = await getRugCheckReport(mint)
  if (!rep) return null

  let creatorBalancePct: number | null = null
  if (rep.creator && rep.topHolders.length > 0) {
    const creatorHolder = rep.topHolders.find(h => h.address === rep.creator)
    if (creatorHolder) {
      creatorBalancePct = creatorHolder.pct
    }
  }

  return {
    score: rep.score,
    lpLockedPct: rep.lpLockedPct,
    hasMintAuthority: Boolean(rep.mintAuthority),
    hasFreezeAuthority: Boolean(rep.freezeAuthority),
    creator: rep.creator,
    creatorBalancePct,
    isBondingCurve: rep.isBondingCurve,
    rugged: rep.rugged,
    risks: rep.risks,
  }
}
