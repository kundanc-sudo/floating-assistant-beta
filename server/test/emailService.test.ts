import assert from 'node:assert/strict'
import test from 'node:test'
import { ConsoleEmailService, ResendEmailService } from '../src/email/emailService.js'

const apiKey = 're_private_test_key_never_log'
const verificationUrl = 'https://api.example.com/verify-email?token=verification-secret'
const resetUrl = 'https://api.example.com/reset-password?token=reset-secret'

function recordingFetcher(status = 200) {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    return new Response(status === 200 ? JSON.stringify({ id: 'email-id' }) : JSON.stringify({ message: `provider error ${apiKey} ${resetUrl}` }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { requests, fetcher: fetcher as typeof fetch }
}

test('Resend sends a successful verification email with the official request contract', async () => {
  const recorded = recordingFetcher()
  const service = new ResendEmailService(apiKey, 'Floating Assistant <noreply@example.com>', { fetcher: recorded.fetcher })
  await service.sendEmailVerification({ email: 'person@example.com', displayName: 'Person', verificationUrl })

  assert.equal(recorded.requests.length, 1)
  const request = recorded.requests[0]
  assert.equal(request.url, 'https://api.resend.com/emails')
  assert.equal(request.init?.method, 'POST')
  const headers = new Headers(request.init?.headers)
  assert.equal(headers.get('Authorization'), `Bearer ${apiKey}`)
  assert.equal(headers.get('Content-Type'), 'application/json')
  const body = JSON.parse(String(request.init?.body))
  assert.deepEqual(body.to, ['person@example.com'])
  assert.equal(body.from, 'Floating Assistant <noreply@example.com>')
  assert.match(body.subject, /Verify/)
  assert.match(body.text, /verification-secret/)
})

test('Resend sends a successful password-reset email', async () => {
  const recorded = recordingFetcher()
  const service = new ResendEmailService(apiKey, 'noreply@example.com', { fetcher: recorded.fetcher })
  await service.sendPasswordReset({ email: 'person@example.com', displayName: 'Person', resetUrl })

  const body = JSON.parse(String(recorded.requests[0].init?.body))
  assert.deepEqual(body.to, ['person@example.com'])
  assert.match(body.subject, /Reset/)
  assert.match(body.text, /reset-secret/)
})

test('Resend reports an invalid API key without leaking provider details or secrets', async () => {
  const recorded = recordingFetcher(401)
  const service = new ResendEmailService(apiKey, 'noreply@example.com', { fetcher: recorded.fetcher })
  await assert.rejects(
    service.sendPasswordReset({ email: 'person@example.com', displayName: 'Person', resetUrl }),
    (error: Error) => {
      assert.equal(error.message, 'Email provider rejected request with HTTP 401.')
      assert.doesNotMatch(error.message, new RegExp(apiKey))
      assert.doesNotMatch(error.message, /reset-secret/)
      return true
    },
  )
})

test('Resend reports provider HTTP failure without exposing its response body', async () => {
  const recorded = recordingFetcher(503)
  const service = new ResendEmailService(apiKey, 'noreply@example.com', { fetcher: recorded.fetcher })
  await assert.rejects(
    service.sendEmailVerification({ email: 'person@example.com', displayName: 'Person', verificationUrl }),
    { message: 'Email provider rejected request with HTTP 503.' },
  )
})

test('Resend reports a sanitized network failure', async () => {
  const fetcher = async () => { throw new Error(`network failed ${apiKey} ${verificationUrl}`) }
  const service = new ResendEmailService(apiKey, 'noreply@example.com', { fetcher: fetcher as typeof fetch })
  await assert.rejects(
    service.sendEmailVerification({ email: 'person@example.com', displayName: 'Person', verificationUrl }),
    { message: 'Email provider request failed.' },
  )
})

test('Resend aborts and reports a provider timeout', async () => {
  const fetcher = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  })) as typeof fetch
  const service = new ResendEmailService(apiKey, 'noreply@example.com', { fetcher, timeoutMs: 5 })
  await assert.rejects(
    service.sendEmailVerification({ email: 'person@example.com', displayName: 'Person', verificationUrl }),
    { message: 'Email provider request timed out.' },
  )
})

test('development console email never logs verification or reset tokens', async () => {
  const messages: string[] = []
  const original = console.info
  console.info = (message?: unknown) => messages.push(String(message))
  try {
    const service = new ConsoleEmailService(true)
    await service.sendEmailVerification({ email: 'person@example.com', displayName: 'Person', verificationUrl })
    await service.sendPasswordReset({ email: 'person@example.com', displayName: 'Person', resetUrl })
  } finally {
    console.info = original
  }
  assert.equal(messages.length, 2)
  assert.doesNotMatch(messages.join('\n'), /verification-secret|reset-secret/)
})
