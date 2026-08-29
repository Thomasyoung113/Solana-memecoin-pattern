import http from 'http'

const mints = [
  'E9ux6b6wTdfGvHw3N9WcK18Gz7Yv9S91GvVpump',
  '9BB6N969A64pG3099999aG7R87G9vV8Vvvpump',
  '7GCihgDB836ZBjn2g7AAY6L19PkYvJzpF3PcyCgwpump',
  'DezXAZ8z7PnrnESfhpU96QhjQJL3dfWvdgMECWSDk7m',
]

function post(path, body) {
  return new Promise((resolve, reject) => {
    const ac = new AbortController()
    const timeout = setTimeout(() => { ac.abort(); req.destroy(new Error('Request timed out after 15s')) }, 15000)
    const data = JSON.stringify(body)
    const req = http.request({
      hostname: 'localhost', port: 3000, path, method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let r = ''
      res.on('data', c => r += c)
      res.on('end', () => {
        clearTimeout(timeout)
        try {
          resolve({ status: res.statusCode, body: JSON.parse(r) })
        } catch {
          reject(new Error(`JSON parse error (status ${res.statusCode}): raw body:\n${r}`))
        }
      })
    })
    req.on('error', err => { clearTimeout(timeout); reject(err) })
    req.write(data)
    req.end()
  })
}

async function main() {
  console.log('=== TEST 1: Single analyze ===')
  const r1 = await post('/api/analyze', { mint: mints[0] })
  console.log('Status:', r1.status)
  if (r1.body.overview) console.log('  Price:', r1.body.overview.price, 'MC:', r1.body.overview.mc, 'Liq:', r1.body.overview.liquidity)
  if (r1.body.patterns) console.log('  Patterns:', r1.body.patterns.length, 'Score:', r1.body.overallScore, 'Verdict:', r1.body.verdict)
  if (r1.body.redFlags) console.log('  Red flags:', r1.body.redFlags.length)
  console.log()

  console.log('=== TEST 2: Batch analyze ===')
  const r2 = await post('/api/analyze/batch', { mints: mints.slice(0, 3) })
  console.log('Status:', r2.status)
  console.log('  Total:', r2.body.total, 'Failed:', r2.body.failed)
  r2.body.analyzed?.forEach(a => console.log('  ', a.mint.slice(0, 12)+'...', a.status, a.result?.overallScore ?? 'N/A'))
  console.log()

  console.log('=== TEST 3: Pattern analysis ===')
  const r3 = await post('/api/patterns', { mints })
  console.log('Status:', r3.status)
  if (r3.body.insights) console.log('  Insights:', r3.body.insights.join(' | '))
  console.log('  Deployers:', r3.body.deployerProfiles?.length ?? 0)
  console.log('  Holder clusters:', r3.body.holderClusters?.length ?? 0)
  console.log('  Replicas:', r3.body.replicaPredictions?.length ?? 0)
  console.log('  Entry signals:', r3.body.entrySignals?.length ?? 0)

  console.log('\n=== DONE ===')
}

main().catch(e => console.error('FATAL:', e))