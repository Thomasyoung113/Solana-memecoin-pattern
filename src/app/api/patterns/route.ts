import { NextRequest, NextResponse } from 'next/server'
import { analyzeToken } from '@/lib/analyzer'
import { analyzePatterns } from '@/lib/pattern-matcher'

export async function POST(req: NextRequest) {
  try {
    const { mints } = await req.json()
    if (!Array.isArray(mints) || mints.length === 0) {
      return NextResponse.json({ error: 'array of mint addresses required' }, { status: 400 })
    }
    if (mints.length > 50) {
      return NextResponse.json({ error: 'max 50 mints per batch' }, { status: 400 })
    }

    const valid = mints.filter((m: unknown) => typeof m === 'string' && m.length >= 32)
    if (valid.length === 0) {
      return NextResponse.json({ error: 'no valid mint addresses' }, { status: 400 })
    }

    // Analyze all tokens in parallel
    const results = await Promise.allSettled(valid.map((m: string) => analyzeToken(m)))
    const analyzed = results
      .map((r, i) => ({ status: r.status, result: r.status === 'fulfilled' ? r.value : null, mint: valid[i] }))
      .filter(r => r.status === 'fulfilled' && r.result !== null)
      .map(r => r.result!)

    if (analyzed.length === 0) {
      return NextResponse.json({ error: 'all token analyses failed' }, { status: 502 })
    }

    // Run cross-token pattern analysis
    const patternAnalysis = analyzePatterns(analyzed)

    return NextResponse.json(patternAnalysis)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Pattern analysis failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}