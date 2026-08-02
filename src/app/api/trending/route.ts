import { NextResponse } from 'next/server'
import { getTrending } from '@/lib/birdeye'

export async function GET() {
  try {
    const trending = await getTrending()
    return NextResponse.json({ trending: trending || [] })
  } catch (error: unknown) {
    return NextResponse.json({ trending: [], error: 'Failed to fetch' }, { status: 200 })
  }
}