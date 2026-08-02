'use client'

import { useState, useEffect, useCallback } from 'react'

type Severity = 'low' | 'medium' | 'high' | 'critical'
type Verdict = 'bullish' | 'neutral' | 'bearish'

interface PatternScore {
  name: string
  score: number
  detail: string
}
interface RedFlag {
  severity: Severity
  issue: string
  detail: string
}
interface TokenOverview {
  address: string
  mc: number | null
  price: number | null
  volume24h: number | null
  liquidity: number | null
  holderCount: number | null
  supply: number | null
}
interface AnalysisResult {
  mint: string
  timestamp: number
  overview: TokenOverview | null
  patterns: PatternScore[]
  redFlags: RedFlag[]
  overallScore: number
  verdict: Verdict
}
interface TrendingToken {
  address: string
  name?: string
  symbol?: string
  price?: number
  mc?: number
}

function CornerSquare() {
  return <div className="w-3 h-3 bg-[var(--green)] shrink-0" />
}

export default function Home() {
  const [mintInput, setMintInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [trending, setTrending] = useState<TrendingToken[]>([])
  const [trendingLoading, setTrendingLoading] = useState(false)

  useEffect(() => {
    setTrendingLoading(true)
    fetch('/api/trending')
      .then(r => r.json())
      .then(d => { if (d.trending) setTrending(d.trending) })
      .catch(() => {})
      .finally(() => setTrendingLoading(false))
  }, [])

  const analyze = useCallback(async (mint: string) => {
    if (!mint || mint.length < 32) { setError('Enter a valid Solana mint address'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Analysis failed')
      setResult(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally { setLoading(false) }
  }, [])

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); analyze(mintInput.trim()) }

  return (
    <div className="flex flex-col min-h-screen">
      {/* === HEADER (dark) === */}
      <header className="bg-[var(--surface-dark)] px-6" style={{ height: 64 }}>
        <div className="max-w-[1280px] mx-auto h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CornerSquare />
            <span className="text-[var(--on-dark)] text-[17px] font-bold tracking-tight">PATTERN SCANNER</span>
          </div>
          <span className="text-[var(--on-dark-mute)] text-[12px]">SOLANA MEMECOIN ANALYSIS</span>
        </div>
      </header>

      {/* === BODY (white canvas) === */}
      <div className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-[64px]">
        {/* Search form */}
        <form onSubmit={handleSubmit} className="mb-[64px]">
          <div className="flex gap-[8px]">
            <input
              type="text"
              value={mintInput}
              onChange={e => setMintInput(e.target.value)}
              placeholder="Paste Solana mint address..."
              className="flex-1 bg-[var(--canvas)] border border-[var(--hairline)] rounded-sm px-4 py-3 text-[16px] outline-none focus:border-[var(--green)] transition-colors font-mono"
              style={{ height: 44 }}
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-[var(--green)] text-[var(--ink)] font-bold text-[16px] rounded-sm disabled:opacity-50 transition-colors"
              style={{ padding: '11px 24px', height: 44 }}
            >
              {loading ? 'SCANNING' : 'SCAN'}
            </button>
          </div>
          {error && <p className="text-[var(--error)] text-[15px] mt-[8px]">{error}</p>}
        </form>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[24px]">
          {/* === MAIN CONTENT === */}
          <div className="lg:col-span-2 space-y-[24px]">
            {loading && (
              <div className="border border-[var(--hairline)] rounded-sm p-8 flex items-center justify-center gap-2">
                <span className="loading-dot w-2 h-2 bg-[var(--green)] inline-block" />
                <span className="loading-dot w-2 h-2 bg-[var(--green)] inline-block" />
                <span className="loading-dot w-2 h-2 bg-[var(--green)] inline-block" />
                <span className="text-[15px] text-[var(--mute)] ml-2">Analyzing token...</span>
              </div>
            )}

            {result && !loading && (
              <>
                {/* Score card */}
                <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px 24px 24px 24px' }}>
                  <div className="flex items-center gap-[8px] mb-[16px]">
                    <CornerSquare />
                    <span className="text-[14px] font-bold uppercase tracking-normal text-[var(--mute)]">TOKEN</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[15px] break-all">{result.mint}</p>
                      {/* Overview grid */}
                      <div className="grid grid-cols-3 gap-[16px] mt-[16px]">
                        <div>
                          <p className="text-[12px] text-[var(--mute)] uppercase font-bold">Price</p>
                          <p className="text-[16px] mt-[2px]">{result.overview?.price ? `$${result.overview.price.toFixed(8)}` : '—'}</p>
                        </div>
                        <div>
                          <p className="text-[12px] text-[var(--mute)] uppercase font-bold">Market Cap</p>
                          <p className="text-[16px] mt-[2px]">{formatUsd(result.overview?.mc)}</p>
                        </div>
                        <div>
                          <p className="text-[12px] text-[var(--mute)] uppercase font-bold">Liquidity</p>
                          <p className="text-[16px] mt-[2px]">{formatUsd(result.overview?.liquidity)}</p>
                        </div>
                        <div>
                          <p className="text-[12px] text-[var(--mute)] uppercase font-bold">24h Vol</p>
                          <p className="text-[16px] mt-[2px]">{formatUsd(result.overview?.volume24h)}</p>
                        </div>
                        <div>
                          <p className="text-[12px] text-[var(--mute)] uppercase font-bold">Holders</p>
                          <p className="text-[16px] mt-[2px]">{result.overview?.holderCount?.toLocaleString() || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[12px] text-[var(--mute)] uppercase font-bold">Supply</p>
                          <p className="text-[16px] mt-[2px]">{result.overview?.supply?.toLocaleString() || '—'}</p>
                        </div>
                      </div>
                    </div>
                    {/* Score */}
                    <div className="flex flex-col items-center ml-6">
                      <div className={`text-[36px] font-bold ${
                        result.verdict === 'bullish' ? 'text-[var(--green)]' :
                        result.verdict === 'bearish' ? 'text-[var(--error)]' :
                        'text-[var(--ink)]'
                      }`}>
                        {result.overallScore}
                      </div>
                      <span className={`text-[14px] font-bold uppercase mt-[4px] ${
                        result.verdict === 'bullish' ? 'text-[var(--green)]' :
                        result.verdict === 'bearish' ? 'text-[var(--error)]' :
                        'text-[var(--ink)]'
                      }`}>
                        {result.verdict}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Patterns */}
                {result.patterns.length > 0 && (
                  <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
                    <div className="flex items-center gap-[8px] mb-[16px]">
                      <CornerSquare />
                      <span className="text-[14px] font-bold uppercase">PATTERNS</span>
                    </div>
                    <div className="space-y-[16px]">
                      {result.patterns.map((p, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-[15px] mb-[4px]">
                            <span className="font-bold">{p.name}</span>
                            <span className={p.score >= 60 ? 'text-[var(--green)]' : p.score >= 35 ? 'text-[var(--warning)]' : 'text-[var(--error)]'}>
                              {p.score}
                            </span>
                          </div>
                          <div className="w-full h-[4px] bg-[var(--surface-soft)]">
                            <div
                              className={`h-full transition-all ${
                                p.score >= 60 ? 'bg-[var(--green)]' :
                                p.score >= 35 ? 'bg-[var(--warning)]' :
                                'bg-[var(--error)]'
                              }`}
                              style={{ width: `${p.score}%` }}
                            />
                          </div>
                          <p className="text-[14px] text-[var(--mute)] mt-[4px]">{p.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Red flags */}
                {result.redFlags.length > 0 && (
                  <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
                    <div className="flex items-center gap-[8px] mb-[16px]">
                      <div className="w-3 h-3 bg-[var(--error)] shrink-0" />
                      <span className="text-[14px] font-bold uppercase text-[var(--error)]">RED FLAGS</span>
                    </div>
                    <div className="space-y-[8px]">
                      {result.redFlags.map((f, i) => (
                        <div key={i} className="flex items-start gap-[8px] text-[15px]">
                          <span className={`inline-block px-[4px] py-[2px] text-[11px] font-bold uppercase shrink-0 ${
                            f.severity === 'critical' ? 'bg-[var(--error)] text-[var(--on-dark)]' :
                            f.severity === 'high' ? 'bg-[var(--warning)] text-[var(--on-dark)]' :
                            'bg-[var(--warning-bright)] text-[var(--on-dark)]'
                          }`}>
                            {f.severity}
                          </span>
                          <div>
                            <span className="font-bold">{f.issue}</span>
                            <p className="text-[14px] text-[var(--mute)]">{f.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!result.patterns.length && !result.redFlags.length && (
                  <div className="border border-[var(--hairline)] rounded-sm p-8 text-center">
                    <p className="text-[15px] text-[var(--mute)]">No pattern data available.</p>
                  </div>
                )}
              </>
            )}

            {!result && !loading && !error && (
              <div className="border border-[var(--hairline)] rounded-sm p-[64px] text-center">
                <div className="flex justify-center mb-[16px]"><CornerSquare /></div>
                <p className="text-[15px] text-[var(--mute)]">Enter a mint address to scan for patterns</p>
              </div>
            )}
          </div>

          {/* === SIDEBAR === */}
          <div className="space-y-[24px]">
            {/* Trending */}
            <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
              <div className="flex items-center gap-[8px] mb-[16px]">
                <CornerSquare />
                <span className="text-[14px] font-bold uppercase">TRENDING</span>
              </div>
              {trendingLoading ? (
                <div className="flex gap-1 py-4 justify-center">
                  <span className="loading-dot w-2 h-2 bg-[var(--mute)] inline-block" />
                  <span className="loading-dot w-2 h-2 bg-[var(--mute)] inline-block" />
                  <span className="loading-dot w-2 h-2 bg-[var(--mute)] inline-block" />
                </div>
              ) : trending.length > 0 ? (
                <div className="space-y-[4px]">
                  {trending.slice(0, 8).map((t, i) => (
                    <button
                      key={t.address || i}
                      onClick={() => { setMintInput(t.address); analyze(t.address) }}
                      className="w-full text-left flex items-center justify-between px-[8px] py-[6px] text-[15px] hover:bg-[var(--surface-soft)] transition-colors rounded-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-bold truncate block">{t.symbol || t.name || t.address.slice(0, 8)}</span>
                        <span className="text-[12px] text-[var(--mute)] truncate block font-mono">{t.address.slice(0, 12)}...</span>
                      </div>
                      <span className="text-[12px] text-[var(--mute)] ml-2">{t.mc ? `$${(t.mc / 1000).toFixed(0)}k` : ''}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[14px] text-[var(--mute)] text-center py-2">No trending data</p>
              )}
            </div>

            {/* Quick info */}
            <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
              <div className="flex items-center gap-[8px] mb-[16px]">
                <div className="w-3 h-3 bg-[var(--ink)] shrink-0" />
                <span className="text-[14px] font-bold uppercase">SCORING</span>
              </div>
              <p className="text-[15px] text-[var(--body)]">
                0–35 <strong>bearish</strong> · 35–65 <strong>neutral</strong> · 65+ <strong>bullish</strong>
              </p>
              <button
                onClick={() => {
                  const demo = 'So11111111111111111111111111111111111111112'
                  setMintInput(demo)
                  analyze(demo)
                }}
                className="mt-[12px] w-full text-left px-[8px] py-[6px] text-[15px] text-[var(--green)] font-bold rounded-sm hover:bg-[var(--surface-soft)] transition-colors"
              >
                SCAN WETH/SOL →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* === FOOTER (dark) === */}
      <footer className="bg-[var(--surface-dark)] px-6" style={{ padding: '32px 48px' }}>
        <div className="max-w-[1280px] mx-auto">
          <div className="flex items-center gap-[8px] mb-[16px]">
            <CornerSquare />
            <span className="text-[var(--on-dark)] text-[14px] font-bold uppercase tracking-normal">PATTERN SCANNER</span>
          </div>
          <p className="text-[var(--on-dark-mute)] text-[12px]">
            Analyzes Solana memecoins via Helius &amp; Birdeye. Not financial advice.
          </p>
        </div>
      </footer>
    </div>
  )
}

function formatUsd(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}k`
  return `$${val.toFixed(2)}`
}