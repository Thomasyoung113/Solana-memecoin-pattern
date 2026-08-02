import { NextRequest, NextResponse } from 'next/server'
import { getWalletProfile, upsertWalletProfile } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params
  const profile = await getWalletProfile(address)
  if (!profile) {
    return NextResponse.json({ error: 'wallet not found' }, { status: 404 })
  }
  return NextResponse.json(profile)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params
  const body = await req.json()
  await upsertWalletProfile(address, body)
  return NextResponse.json({ success: true })
}