import { NextRequest, NextResponse } from 'next/server'
import { analyzeToken, getCachedAnalysis } from '@/lib/analyzer'

export async function POST(req: NextRequest) {
  try {
    const { mint } = await req.json()
    if (!mint || typeof mint !== 'string') {
      return NextResponse.json({ error: 'mint address required' }, { status: 400 })
    }

    // Check cache first (valid for 5 min)
    const cached = await getCachedAnalysis(mint)
    if (cached && Date.now() - cached.timestamp < 300_000) {
      return NextResponse.json({ cached: true, ...cached })
    }

    const result = await analyzeToken(mint)
    return NextResponse.json({ cached: false, ...result })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Analysis failed'
    console.error('Analyze error:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// GET returns cached analysis if available
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get('mint')
  if (!mint) {
    return NextResponse.json({ error: 'mint query param required' }, { status: 400 })
  }

  const cached = await getCachedAnalysis(mint)
  if (!cached) {
    return NextResponse.json({ error: 'no cached analysis, use POST' }, { status: 404 })
  }

  return NextResponse.json(cached)
}