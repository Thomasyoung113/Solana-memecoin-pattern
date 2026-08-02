export const config = {
  heliusApiKey: process.env.HELIUS_API_KEY || '',
  birdeyeApiKey: process.env.BIRDEYE_API_KEY || '',
  tursoDbUrl: process.env.TURSO_DATABASE_URL || '',
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
}

export function requireConfig() {
  if (!config.heliusApiKey) throw new Error('HELIUS_API_KEY is required')
  if (!config.birdeyeApiKey) throw new Error('BIRDEYE_API_KEY is required')
}