import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const port = String(32_500 + Math.floor(Math.random() * 1000))
const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let diagnostics = ''
child.stdout.on('data', (chunk) => { diagnostics += chunk.toString() })
child.stderr.on('data', (chunk) => { diagnostics += chunk.toString() })
try {
  const baseUrl = `http://127.0.0.1:${port}`
  await waitForReady(baseUrl)
  assert.deepEqual(await (await fetch(`${baseUrl}/health/live`)).json(), { status: 'live' })
  assert.deepEqual(await (await fetch(`${baseUrl}/health/ready`)).json(), { status: 'ready' })
  console.info('Compiled backend startup and live/ready health smoke test passed.')
} finally {
  child.kill()
}

async function waitForReady(baseUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Compiled backend exited before readiness. ${sanitize(diagnostics)}`)
    try {
      const response = await fetch(`${baseUrl}/health/ready`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Compiled backend did not become ready. ${sanitize(diagnostics)}`)
}

function sanitize(value) {
  return value.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]').slice(-2000)
}
