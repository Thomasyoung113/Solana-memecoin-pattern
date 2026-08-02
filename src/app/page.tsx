'use client'

import { useState, useEffect, useCallback } from 'react'

type Severity = 'low' | 'medium' | 'high' | 'critical'
type Verdict = 'bullish' | 'neutral' | 'bearish'
type TabMode = 'single' | 'batch' | 'patterns'

interface PatternScore { name: string; score: number; detail: string }
interface RedFlag { severity: Severity; issue: string; detail: string }
interface TokenOverview { address: string; mc: number | null; price: number | null; volume24h: number | null; liquidity: number | null; holderCount: number | null; supply: number | null }
interface AnalysisResult { mint: string; timestamp: number; overview: TokenOverview | null; patterns: PatternScore[]; redFlags: RedFlag[]; overallScore: number; verdict: Verdict }
interface BatchItem { mint: string; status: 'ok' | 'error'; result: AnalysisResult | null; error: string | null }
interface TrendingToken { address: string; name?: string; symbol?: string; mc?: number }

// Pattern analysis types
interface DeployerProfile { address: string; tokensLaunched: number; tokens: string[]; avgScore: number; prevSuccess: boolean }
interface HolderCluster { address: string; appearsIn: number; tokens: string[]; avgEntryTime: number; estimatedPnL: string }
interface ReplicaPrediction { mint: string; replicaScore: number; matchedToken: string; matchFactors: string[]; confidence: string }
interface EntrySignal { mint: string; entryScore: number; suggestedEntry: string; avgFirstPumpTime: string | null; riskLevel: string }
interface PatternAnalysis {
  totalAnalyzed: number; successfulCount: number; insights: string[]
  deployerProfiles: DeployerProfile[]; holderClusters: HolderCluster[]
  replicaPredictions: ReplicaPrediction[]; entrySignals: EntrySignal[]
}

function CornerSquare() { return <div className="w-3 h-3 bg-[var(--green)] shrink-0" /> }

export default function Home() {
  const [mintInput, setMintInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [batchResults, setBatchResults] = useState<BatchItem[]>([])
  const [patternResult, setPatternResult] = useState<PatternAnalysis | null>(null)
  const [trending, setTrending] = useState<TrendingToken[]>([])
  const [trendingLoading] = useState(true)
  const [mode, setMode] = useState<TabMode>('single')

  useEffect(() => {
    fetch('/api/trending')
      .then(r => r.json())
      .then(d => { if (d.trending) setTrending(d.trending) })
      .catch(() => {})
  }, [])

  const analyze = useCallback(async (mint: string) => {
    if (!mint || mint.length < 32) { setError('Enter a valid Solana mint address'); return }
    setLoading(true); setError(''); setResult(null); setBatchResults([])
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Analysis failed')
      setResult(json)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Analysis failed') }
    finally { setLoading(false) }
  }, [])

  const analyzeBatch = useCallback(async () => {
    const mints = mintInput.split('\n').map(s => s.trim()).filter(Boolean)
    if (mints.length === 0) { setError('Paste at least one mint address'); return }
    if (mints.length > 50) { setError('Max 50 addresses per batch'); return }
    setLoading(true); setError(''); setResult(null); setBatchResults([]); setPatternResult(null)
    try {
      const res = await fetch('/api/analyze/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mints }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Batch analysis failed')
      setBatchResults(json.analyzed)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Batch analysis failed') }
    finally { setLoading(false) }
  }, [mintInput])

  const analyzePatterns = useCallback(async () => {
    const mints = mintInput.split('\n').map(s => s.trim()).filter(Boolean)
    if (mints.length < 2) { setError('Need at least 2 addresses for pattern analysis'); return }
    if (mints.length > 50) { setError('Max 50 addresses'); return }
    setLoading(true); setError(''); setResult(null); setBatchResults([]); setPatternResult(null)
    try {
      const res = await fetch('/api/patterns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mints }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Pattern analysis failed')
      setPatternResult(json)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Pattern analysis failed') }
    finally { setLoading(false) }
  }, [mintInput])

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); if (mode === 'single') analyze(mintInput.trim()); else if (mode === 'batch') analyzeBatch(); else analyzePatterns() }

  return (
    <div className="flex flex-col min-h-screen">
      {/* HEADER */}
      <header className="bg-[var(--surface-dark)] px-6" style={{ height: 64 }}>
        <div className="max-w-[1280px] mx-auto h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CornerSquare />
            <span className="text-[var(--on-dark)] text-[17px] font-bold tracking-tight">PATTERN SCANNER</span>
          </div>
          <span className="text-[var(--on-dark-mute)] text-[12px]">SOLANA MEMECOIN ANALYSIS</span>
        </div>
      </header>

      {/* BODY */}
      <div className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-[64px]">
        {/* Mode tabs */}
        <div className="flex gap-[2px] mb-[24px]">
          <button onClick={() => setMode('single')} className={`px-4 py-2 text-[14px] font-bold uppercase rounded-sm transition-colors ${mode === 'single' ? 'bg-[var(--green)] text-[var(--ink)]' : 'bg-[var(--surface-soft)] text-[var(--mute)] hover:bg-[var(--hairline)]'}`}>Single</button>
          <button onClick={() => setMode('batch')} className={`px-4 py-2 text-[14px] font-bold uppercase rounded-sm transition-colors ${mode === 'batch' ? 'bg-[var(--green)] text-[var(--ink)]' : 'bg-[var(--surface-soft)] text-[var(--mute)] hover:bg-[var(--hairline)]'}`}>Batch</button>
          <button onClick={() => setMode('patterns')} className={`px-4 py-2 text-[14px] font-bold uppercase rounded-sm transition-colors ${mode === 'patterns' ? 'bg-[var(--green)] text-[var(--ink)]' : 'bg-[var(--surface-soft)] text-[var(--mute)] hover:bg-[var(--hairline)]'}`}>Patterns</button>
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="mb-[64px]">
          {mode === 'single' ? (
            <div className="flex gap-[8px]">
              <input type="text" value={mintInput} onChange={e => setMintInput(e.target.value)} placeholder="Paste Solana mint address..." className="flex-1 bg-[var(--canvas)] border border-[var(--hairline)] rounded-sm px-4 py-3 text-[16px] outline-none focus:border-[var(--green)] transition-colors font-mono" style={{ height: 44 }} />
              <button type="submit" disabled={loading} className="bg-[var(--green)] text-[var(--ink)] font-bold text-[16px] rounded-sm disabled:opacity-50 transition-colors" style={{ padding: '11px 24px', height: 44 }}>{loading ? 'SCANNING' : 'SCAN'}</button>
            </div>
          ) : (
            <div className="space-y-[8px]">
              <textarea value={mintInput} onChange={e => setMintInput(e.target.value)} placeholder="Paste Solana mint addresses (one per line)&#10;Max 50 addresses" className="w-full bg-[var(--canvas)] border border-[var(--hairline)] rounded-sm px-4 py-3 text-[16px] outline-none focus:border-[var(--green)] transition-colors font-mono" style={{ minHeight: 120 }} />
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-[var(--mute)]">{mintInput.split('\n').filter(Boolean).length} addresses</span>
                <button type="submit" disabled={loading} className="bg-[var(--green)] text-[var(--ink)] font-bold text-[16px] rounded-sm disabled:opacity-50 transition-colors" style={{ padding: '11px 24px', height: 44 }}>{loading ? (mode === 'patterns' ? 'ANALYZING...' : 'SCANNING...') : (mode === 'patterns' ? 'FIND PATTERNS' : 'SCAN ALL')}</button>
              </div>
            </div>
          )}
          {error && <p className="text-[var(--error)] text-[15px] mt-[8px]">{error}</p>}
        </form>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[24px]">
          {/* MAIN */}
          <div className="lg:col-span-2 space-y-[24px]">
            {loading && (
              <div className="border border-[var(--hairline)] rounded-sm p-8 text-center">
                <div className="flex items-center justify-center gap-2 mb-2"><span className="loading-dot w-2 h-2 bg-[var(--green)] inline-block" /><span className="loading-dot w-2 h-2 bg-[var(--green)] inline-block" /><span className="loading-dot w-2 h-2 bg-[var(--green)] inline-block" /></div>
                <p className="text-[15px] text-[var(--mute)]">Analyzing tokens...</p>
              </div>
            )}

            {/* Single result */}
            {result && !loading && (
              <ResultCard result={result} />
            )}

            {/* Batch results table */}
            {batchResults.length > 0 && !loading && (
              <div className="border border-[var(--hairline)] rounded-sm">
                <div className="flex items-center gap-[8px] p-[24px] pb-0">
                  <CornerSquare />
                  <span className="text-[14px] font-bold uppercase">BATCH RESULTS</span>
                  <span className="text-[12px] text-[var(--mute)] ml-auto">{batchResults.filter(r => r.status === 'ok').length}/{batchResults.length} analyzed</span>
                </div>
                <div className="overflow-x-auto mt-[16px]">
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr className="border-b border-[var(--hairline)] text-[12px] text-[var(--mute)] uppercase font-bold">
                        <th className="text-left px-[16px] py-[8px]">Token</th>
                        <th className="text-right px-[16px] py-[8px]">Score</th>
                        <th className="text-right px-[16px] py-[8px]">MC</th>
                        <th className="text-right px-[16px] py-[8px]">Liq</th>
                        <th className="text-right px-[16px] py-[8px]">24h Vol</th>
                        <th className="text-right px-[16px] py-[8px]">Patterns</th>
                        <th className="text-right px-[16px] py-[8px]">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchResults.map((item) => (
                        <tr key={item.mint} className="border-b border-[var(--hairline)] hover:bg-[var(--surface-soft)] transition-colors">
                          {item.status === 'error' ? (
                            <>
                              <td className="px-[16px] py-[10px] font-mono text-[12px]">{item.mint.slice(0, 16)}...</td>
                              <td className="px-[16px] py-[10px] text-right text-[var(--error)]" colSpan={6}>Error: {item.error}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-[16px] py-[10px] font-mono text-[12px]">{item.result?.mint.slice(0, 16)}...</td>
                              <td className={`px-[16px] py-[10px] text-right font-bold ${item.result?.verdict === 'bullish' ? 'text-[var(--green)]' : item.result?.verdict === 'bearish' ? 'text-[var(--error)]' : ''}`}>{item.result?.overallScore ?? '—'}</td>
                              <td className="px-[16px] py-[10px] text-right">{formatUsd(item.result?.overview?.mc)}</td>
                              <td className="px-[16px] py-[10px] text-right">{formatUsd(item.result?.overview?.liquidity)}</td>
                              <td className="px-[16px] py-[10px] text-right">{formatUsd(item.result?.overview?.volume24h)}</td>
                              <td className="px-[16px] py-[10px] text-right">{item.result?.patterns?.length ?? 0}</td>
                              <td className="px-[16px] py-[10px] text-right">
                                {item.result?.redFlags?.length ? <span className="text-[var(--error)] font-bold">{item.result.redFlags.length}</span> : <span className="text-[var(--mute)]">0</span>}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Pattern analysis results */}
            {patternResult && !loading && (
              <div className="space-y-[24px]">
                {/* Summary */}
                <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
                  <div className="flex items-center gap-[8px] mb-[16px]"><CornerSquare /><span className="text-[14px] font-bold uppercase">PATTERN ANALYSIS</span></div>
                  <div className="grid grid-cols-3 gap-[16px] mb-[16px]">
                    <div><p className="text-[12px] text-[var(--mute)] uppercase font-bold">Analyzed</p><p className="text-[20px] font-bold">{patternResult.totalAnalyzed}</p></div>
                    <div><p className="text-[12px] text-[var(--mute)] uppercase font-bold">Bullish</p><p className="text-[20px] font-bold text-[var(--green)]">{patternResult.successfulCount}</p></div>
                    <div><p className="text-[12px] text-[var(--mute)] uppercase font-bold">Replicas</p><p className="text-[20px] font-bold">{patternResult.replicaPredictions.length}</p></div>
                  </div>
                  {patternResult.insights.length > 0 && (
                    <div className="space-y-[4px]">
                      {patternResult.insights.map((insight, i) => (
                        <p key={i} className="text-[14px] text-[var(--body)] flex items-start gap-[6px]"><span className="text-[var(--green)] mt-[2px] shrink-0">▸</span>{insight}</p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Deployer profiles */}
                {patternResult.deployerProfiles.length > 0 && (
                  <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
                    <div className="flex items-center gap-[8px] mb-[16px]"><CornerSquare /><span className="text-[14px] font-bold uppercase">SERIAL DEPLOYERS</span></div>
                    <div className="space-y-[8px]">{patternResult.deployerProfiles.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-[14px] py-[4px] border-b border-[var(--surface-soft)]">
                        <div><span className="font-mono text-[12px]">{d.address.slice(0, 12)}...</span></div>
                        <div className="flex gap-[16px]"><span>{d.tokensLaunched} tokens</span><span className={d.avgScore >= 65 ? 'text-[var(--green)]' : ''}>{Math.round(d.avgScore)} avg</span></div>
                      </div>
                    ))}</div>
                  </div>
                )}

                {/* Smart money clusters */}
                {patternResult.holderClusters.length > 0 && (
                  <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
                    <div className="flex items-center gap-[8px] mb-[16px]"><CornerSquare /><span className="text-[14px] font-bold uppercase">SMART MONEY CLUSTERS</span></div>
                    <div className="space-y-[8px]">{patternResult.holderClusters.map((h, i) => (
                      <div key={i} className="flex items-center justify-between text-[14px] py-[4px] border-b border-[var(--surface-soft)] last:border-0">
                        <div><span className="font-mono text-[12px]">{h.address.slice(0, 12)}...</span></div>
                        <span>In {h.appearsIn} tokens</span>
                      </div>
                    ))}</div>
                  </div>
                )}

                {/* Replica predictions */}
                {patternResult.replicaPredictions.length > 0 && (
                  <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
                    <div className="flex items-center gap-[8px] mb-[16px]"><span className="w-3 h-3 bg-[var(--warning)] shrink-0" /><span className="text-[14px] font-bold uppercase">REPLICA PREDICTIONS</span></div>
                    {patternResult.replicaPredictions.slice(0, 5).map((r, i) => (
                      <div key={i} className="mb-[12px] pb-[12px] border-b border-[var(--surface-soft)] last:border-0 last:mb-0 last:pb-0">
                        <div className="flex justify-between text-[14px] mb-[4px]">
                          <span className="font-mono text-[12px]">{r.mint.slice(0, 16)}...</span>
                          <span className={`font-bold ${r.confidence === 'high' ? 'text-[var(--green)]' : r.confidence === 'medium' ? 'text-[var(--warning)]' : 'text-[var(--mute)]'}`}>{r.replicaScore} — {r.confidence}</span>
                        </div>
                        {r.matchFactors.map((f, j) => <p key={j} className="text-[13px] text-[var(--mute)] ml-[4px]">▸ {f}</p>)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Entry signals */}
                {patternResult.entrySignals.length > 0 && (
                  <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
                    <div className="flex items-center gap-[8px] mb-[16px]"><CornerSquare /><span className="text-[14px] font-bold uppercase">ENTRY SIGNALS</span></div>
                    {patternResult.entrySignals.slice(0, 5).map((e, i) => (
                      <div key={i} className="mb-[12px] pb-[12px] border-b border-[var(--surface-soft)] last:border-0 last:mb-0 last:pb-0">
                        <div className="flex justify-between text-[14px] mb-[4px]">
                          <span className="font-mono text-[12px]">{e.mint.slice(0, 16)}...</span>
                          <span className={`font-bold ${e.riskLevel === 'low' ? 'text-[var(--green)]' : e.riskLevel === 'medium' ? 'text-[var(--warning)]' : 'text-[var(--error)]'}`}>{e.entryScore}</span>
                        </div>
                        <p className="text-[13px] text-[var(--body)]">{e.suggestedEntry}</p>
                        {e.avgFirstPumpTime && <p className="text-[12px] text-[var(--mute)]">{e.avgFirstPumpTime}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!result && !batchResults.length && !patternResult && !loading && !error && (
              <div className="border border-[var(--hairline)] rounded-sm p-[64px] text-center">
                <div className="flex justify-center mb-[16px]"><CornerSquare /></div>
                <p className="text-[15px] text-[var(--mute)]">{mode === 'single' ? 'Enter a mint address to scan for patterns' : mode === 'patterns' ? 'Paste 2+ mint addresses to find patterns between them' : 'Paste multiple mint addresses to scan in batch'}</p>
              </div>
            )}
          </div>

          {/* SIDEBAR */}
          <div className="space-y-[24px]">
            <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
              <div className="flex items-center gap-[8px] mb-[16px]"><CornerSquare /><span className="text-[14px] font-bold uppercase">TRENDING</span></div>
              {trendingLoading ? (
                <div className="flex gap-1 py-4 justify-center"><span className="loading-dot w-2 h-2 bg-[var(--mute)] inline-block" /><span className="loading-dot w-2 h-2 bg-[var(--mute)] inline-block" /><span className="loading-dot w-2 h-2 bg-[var(--mute)] inline-block" /></div>
              ) : trending.length > 0 ? (
                <div className="space-y-[4px]">
                  {trending.slice(0, 8).map((t, i) => (
                    <button key={t.address || i} onClick={() => { setMintInput(prev => prev ? prev + '\n' + t.address : t.address); setMode('patterns') }} className="w-full text-left flex items-center justify-between px-[8px] py-[6px] text-[15px] hover:bg-[var(--surface-soft)] transition-colors rounded-sm">
                      <div className="min-w-0 flex-1"><span className="font-bold truncate block">{t.symbol || t.name || t.address.slice(0, 8)}</span><span className="text-[12px] text-[var(--mute)] truncate block font-mono">{t.address.slice(0, 12)}...</span></div>
                      <span className="text-[12px] text-[var(--mute)] ml-2">{t.mc ? `$${(t.mc / 1000).toFixed(0)}k` : ''}</span>
                    </button>
                  ))}
                </div>
              ) : <p className="text-[14px] text-[var(--mute)] text-center py-2">No trending data</p>}
            </div>
            <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
              <div className="flex items-center gap-[8px] mb-[16px]"><div className="w-3 h-3 bg-[var(--ink)] shrink-0" /><span className="text-[14px] font-bold uppercase">SCORING</span></div>
              <p className="text-[15px] text-[var(--body)]">0–35 <strong>bearish</strong> · 35–65 <strong>neutral</strong> · 65+ <strong>bullish</strong></p>
            </div>
          </div>
        </div>
      </div>

      <footer className="bg-[var(--surface-dark)] px-6" style={{ padding: '32px 48px' }}>
        <div className="max-w-[1280px] mx-auto">
          <div className="flex items-center gap-[8px] mb-[16px]"><CornerSquare /><span className="text-[var(--on-dark)] text-[14px] font-bold uppercase tracking-normal">PATTERN SCANNER</span></div>
          <p className="text-[var(--on-dark-mute)] text-[12px]">Analyzes Solana memecoins via Helius &amp; Birdeye. Not financial advice.</p>
        </div>
      </footer>
    </div>
  )
}

function ResultCard({ result }: { result: AnalysisResult }) {
  return (
    <>
      <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
        <div className="flex items-center gap-[8px] mb-[16px]"><CornerSquare /><span className="text-[14px] font-bold uppercase tracking-normal text-[var(--mute)]">TOKEN</span></div>
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[15px] break-all">{result.mint}</p>
            <div className="grid grid-cols-3 gap-[16px] mt-[16px]">
              <div><p className="text-[12px] text-[var(--mute)] uppercase font-bold">Price</p><p className="text-[16px] mt-[2px]">{result.overview?.price ? `$${result.overview.price.toFixed(8)}` : '—'}</p></div>
              <div><p className="text-[12px] text-[var(--mute)] uppercase font-bold">Market Cap</p><p className="text-[16px] mt-[2px]">{formatUsd(result.overview?.mc)}</p></div>
              <div><p className="text-[12px] text-[var(--mute)] uppercase font-bold">Liquidity</p><p className="text-[16px] mt-[2px]">{formatUsd(result.overview?.liquidity)}</p></div>
              <div><p className="text-[12px] text-[var(--mute)] uppercase font-bold">24h Vol</p><p className="text-[16px] mt-[2px]">{formatUsd(result.overview?.volume24h)}</p></div>
              <div><p className="text-[12px] text-[var(--mute)] uppercase font-bold">Holders</p><p className="text-[16px] mt-[2px]">{result.overview?.holderCount?.toLocaleString() || '—'}</p></div>
              <div><p className="text-[12px] text-[var(--mute)] uppercase font-bold">Supply</p><p className="text-[16px] mt-[2px]">{result.overview?.supply?.toLocaleString() || '—'}</p></div>
            </div>
          </div>
          <div className="flex flex-col items-center ml-6">
            <div className={`text-[36px] font-bold ${result.verdict === 'bullish' ? 'text-[var(--green)]' : result.verdict === 'bearish' ? 'text-[var(--error)]' : 'text-[var(--ink)]'}`}>{result.overallScore}</div>
            <span className={`text-[14px] font-bold uppercase mt-[4px] ${result.verdict === 'bullish' ? 'text-[var(--green)]' : result.verdict === 'bearish' ? 'text-[var(--error)]' : 'text-[var(--ink)]'}`}>{result.verdict}</span>
          </div>
        </div>
      </div>
      {result.patterns.length > 0 && (
        <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
          <div className="flex items-center gap-[8px] mb-[16px]"><CornerSquare /><span className="text-[14px] font-bold uppercase">PATTERNS</span></div>
          <div className="space-y-[16px]">{result.patterns.map((p, i) => (
            <div key={i}>
              <div className="flex justify-between text-[15px] mb-[4px]"><span className="font-bold">{p.name}</span><span className={p.score >= 60 ? 'text-[var(--green)]' : p.score >= 35 ? 'text-[var(--warning)]' : 'text-[var(--error)]'}>{p.score}</span></div>
              <div className="w-full h-[4px] bg-[var(--surface-soft)]"><div className={`h-full transition-all ${p.score >= 60 ? 'bg-[var(--green)]' : p.score >= 35 ? 'bg-[var(--warning)]' : 'bg-[var(--error)]'}`} style={{ width: `${p.score}%` }} /></div>
              <p className="text-[14px] text-[var(--mute)] mt-[4px]">{p.detail}</p>
            </div>
          ))}</div>
        </div>
      )}
      {result.redFlags.length > 0 && (
        <div className="border border-[var(--hairline)] rounded-sm" style={{ padding: '24px' }}>
          <div className="flex items-center gap-[8px] mb-[16px]"><div className="w-3 h-3 bg-[var(--error)] shrink-0" /><span className="text-[14px] font-bold uppercase text-[var(--error)]">RED FLAGS</span></div>
          <div className="space-y-[8px]">{result.redFlags.map((f, i) => (
            <div key={i} className="flex items-start gap-[8px] text-[15px]">
              <span className={`inline-block px-[4px] py-[2px] text-[11px] font-bold uppercase shrink-0 ${f.severity === 'critical' ? 'bg-[var(--error)] text-[var(--on-dark)]' : f.severity === 'high' ? 'bg-[var(--warning)] text-[var(--on-dark)]' : 'bg-[var(--warning-bright)] text-[var(--on-dark)]'}`}>{f.severity}</span>
              <div><span className="font-bold">{f.issue}</span><p className="text-[14px] text-[var(--mute)]">{f.detail}</p></div>
            </div>
          ))}</div>
        </div>
      )}
    </>
  )
}

function formatUsd(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}k`
  return `$${val.toFixed(2)}`
}