import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenAiProvider, type RealtimeSecretDiagnostic } from '../src/ai/provider.js'

const providerKey = ['sk', 'test', 'provider', 'secret', 'never', 'log'].join('-')
const clientSecret = 'ek_test-client-secret-never-log'
const models = { fast: 'fast-test', coding: 'coding-test', summary: 'summary-test' }

function providerWith(fetcher: typeof fetch, diagnostics: RealtimeSecretDiagnostic[]) {
  return new OpenAiProvider(providerKey, models, 5_000, {
    fetcher,
    onRealtimeDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  })
}

function response(status: number, body: string) {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
}

test('Realtime client-secret request preserves the official request and response contract', async () => {
  const diagnostics: RealtimeSecretDiagnostic[] = []
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    return response(200, JSON.stringify({ value: clientSecret, expires_at: 1_800_000_000, session: {} }))
  }) as typeof fetch
  const result = await providerWith(fetcher, diagnostics).createRealtimeSecret()

  assert.deepEqual(result, { value: clientSecret, expiresAt: 1_800_000_000 })
  assert.equal(diagnostics.length, 0)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://api.openai.com/v1/realtime/client_secrets')
  assert.equal(requests[0].init?.method, 'POST')
  const headers = new Headers(requests[0].init?.headers)
  assert.equal(headers.get('Authorization'), `Bearer ${providerKey}`)
  assert.equal(headers.get('Content-Type'), 'application/json')
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    session: { type: 'realtime', model: 'gpt-realtime' },
  })
})

for (const status of [401, 403, 429]) {
  test(`Realtime client-secret reports upstream HTTP ${status} without reading or logging its body`, async () => {
    const diagnostics: RealtimeSecretDiagnostic[] = []
    const fetcher = (async () => response(status, JSON.stringify({ secret: providerKey, clientSecret }))) as typeof fetch
    await assert.rejects(providerWith(fetcher, diagnostics).createRealtimeSecret(), {
      message: `Realtime credential request failed with HTTP ${status}.`,
    })
    assert.equal(diagnostics.length, 1)
    assert.deepEqual(diagnostics[0], {
      stage: 'upstream_fetch',
      errorName: 'Error',
      safeMessage: `Realtime credential request failed with HTTP ${status}.`,
      causeCode: undefined,
      upstreamStatus: status,
      elapsedMs: diagnostics[0].elapsedMs,
    })
    assert.ok(diagnostics[0].elapsedMs >= 0)
    assert.doesNotMatch(JSON.stringify(diagnostics), new RegExp(providerKey))
    assert.doesNotMatch(JSON.stringify(diagnostics), new RegExp(clientSecret))
  })
}

test('Realtime client-secret records a safe nested Undici cause code and redacts secrets', async () => {
  const diagnostics: RealtimeSecretDiagnostic[] = []
  const failure = new TypeError(`fetch failed for Bearer ${providerKey} and ${clientSecret}`, {
    cause: Object.assign(new Error(`socket failed ${providerKey}`), { code: 'ECONNRESET' }),
  })
  const fetcher = (async () => { throw failure }) as typeof fetch
  await assert.rejects(providerWith(fetcher, diagnostics).createRealtimeSecret(), TypeError)

  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].stage, 'upstream_fetch')
  assert.equal(diagnostics[0].errorName, 'TypeError')
  assert.equal(diagnostics[0].causeCode, 'ECONNRESET')
  assert.equal(diagnostics[0].upstreamStatus, undefined)
  const serialized = JSON.stringify(diagnostics[0])
  assert.doesNotMatch(serialized, new RegExp(providerKey))
  assert.doesNotMatch(serialized, new RegExp(clientSecret))
  assert.match(serialized, /REDACTED/)
})

test('Realtime client-secret rejects null JSON at response validation', async () => {
  const diagnostics: RealtimeSecretDiagnostic[] = []
  const fetcher = (async () => response(200, 'null')) as typeof fetch
  await assert.rejects(providerWith(fetcher, diagnostics).createRealtimeSecret(), {
    message: 'Realtime credential response was invalid.',
  })
  assert.equal(diagnostics[0].stage, 'response_validate')
  assert.equal(diagnostics[0].upstreamStatus, 200)
})

test('Realtime client-secret records malformed JSON at response parsing', async () => {
  const diagnostics: RealtimeSecretDiagnostic[] = []
  const fetcher = (async () => response(200, '{not-json')) as typeof fetch
  await assert.rejects(providerWith(fetcher, diagnostics).createRealtimeSecret(), SyntaxError)
  assert.equal(diagnostics[0].stage, 'response_parse')
  assert.equal(diagnostics[0].errorName, 'SyntaxError')
  assert.equal(diagnostics[0].upstreamStatus, 200)
})

test('Realtime client-secret rejects an object without a credential', async () => {
  const diagnostics: RealtimeSecretDiagnostic[] = []
  const fetcher = (async () => response(200, '{}')) as typeof fetch
  await assert.rejects(providerWith(fetcher, diagnostics).createRealtimeSecret(), {
    message: 'Realtime credential was empty.',
  })
  assert.equal(diagnostics[0].stage, 'response_validate')
  assert.equal(diagnostics[0].upstreamStatus, 200)
})

test('Realtime client-secret identifies invalid Authorization header setup without leaking the key', async () => {
  const diagnostics: RealtimeSecretDiagnostic[] = []
  const invalidKey = ['sk', 'invalid\nheader-secret'].join('-')
  const service = new OpenAiProvider(invalidKey, models, 5_000, {
    fetcher: (async () => { throw new Error('fetch should not run') }) as typeof fetch,
    onRealtimeDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  })
  await assert.rejects(service.createRealtimeSecret(), TypeError)
  assert.equal(diagnostics[0].stage, 'request_setup')
  assert.doesNotMatch(JSON.stringify(diagnostics[0]), /header-secret|sk-invalid/)
})
