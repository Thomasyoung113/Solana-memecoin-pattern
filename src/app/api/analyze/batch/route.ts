import { NextRequest, NextResponse } from 'next/server'
import { analyzeToken } from '@/lib/analyzer'

export async function POST(req: NextRequest) {
  try {
    const { mints } = await req.json()
    if (!Array.isArray(mints) || mints.length === 0) {
      return NextResponse.json({ error: 'array of mint addresses required' }, { status: 400 })
    }
    if (mints.length > 50) {
      return NextResponse.json({ error: 'max 50 mints per batch' }, { status: 400 })
    }

    const valid = mints.filter(m => typeof m === 'string' && m.length >= 32)
    if (valid.length === 0) {
      return NextResponse.json({ error: 'no valid mint addresses' }, { status: 400 })
    }

    const results = await Promise.allSettled(valid.map(m => analyzeToken(m)))

    const analyzed = results.map((r, i) => ({
      mint: valid[i],
      status: r.status === 'fulfilled' ? 'ok' : 'error',
      result: r.status === 'fulfilled' ? r.value : null,
      error: r.status === 'rejected' ? r.reason?.message || 'failed' : null,
    }))

    return NextResponse.json({ analyzed, total: valid.length, failed: analyzed.filter(a => a.status === 'error').length })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Batch analysis failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}