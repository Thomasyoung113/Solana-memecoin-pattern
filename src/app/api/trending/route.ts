import { NextResponse } from 'next/server'
import { getTrending } from '@/lib/birdeye'

export async function GET() {
  try {
    const trending = await getTrending()
    if (!trending) {
      return NextResponse.json({ error: 'failed to fetch trending' }, { status: 502 })
    }
    return NextResponse.json({ trending })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}