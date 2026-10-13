import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiClient } from './apiClient'
import { ApiProductService } from './apiProductService'
import { CompanionPairingService, type DesktopPairingConnection, type DesktopPairingPublicState } from './companionPairingService'
import type { ProductStorage } from './productShellService'

const expiresAt = new Date(310_000).toISOString()
const connection: DesktopPairingConnection = {
  interview: { id: 'interview-1', name: 'Website interview' },
  bootstrap: {
    user: { id: 'user-1', email: 'candidate@example.com' },
    profiles: [],
    interviews: [],
    settings: { defaultAutoAssist: false },
    activeInterviewId: 'interview-1',
  },
}

class FakeScheduler {
  nowValue = 10_000
  entries: Array<{ callback: () => void; cancelled: boolean }> = []
  now = () => this.nowValue
  schedule = (callback: () => void) => {
    const entry = { callback, cancelled: false }
    this.entries.push(entry)
    return entry
  }
  cancel = (handle: unknown) => { (handle as { cancelled: boolean }).cancelled = true }
  runNext() {
    const entry = this.entries.find((candidate) => !candidate.cancelled)
    if (!entry) throw new Error('No scheduled pairing poll.')
    entry.cancelled = true
    entry.callback()
  }
}

class FakeApi {
  calls: Array<{ path: string; init?: RequestInit }> = []
  responses: Array<unknown | Error | Promise<unknown>> = []
  async requestAnonymous<T>(path: string, init?: RequestInit): Promise<T> {
    this.calls.push({ path, init })
    const next = this.responses.shift()
    if (next instanceof Error) throw next
    return await next as T
  }
}

function creation() {
  return { requestId: '11111111-1111-4111-8111-111111111111', pairingCode: 'ABCD-2345', redemptionSecret: 's'.repeat(43), expiresAt }
}

function fixture() {
  const api = new FakeApi()
  const scheduler = new FakeScheduler()
  const states: DesktopPairingPublicState[] = []
  const redeemed: Array<{ token: string; interviewId: string; expiresAt: string }> = []
  const service = new CompanionPairingService(
    api,
    async (value) => { redeemed.push(value); return connection },
    (state) => states.push(state),
    scheduler,
    2_500,
  )
  return { api, scheduler, states, redeemed, service }
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test('pairing creation exposes only the human code and public expiration', async () => {
  const { api, service } = fixture()
  api.responses.push(creation())
  const state = await service.start()
  assert.equal(state.status, 'pending')
  assert.equal(state.pairingCode, 'ABCD-2345')
  assert.equal(JSON.stringify(state).includes('s'.repeat(43)), false)
  assert.equal(api.calls[0]?.path, '/api/v1/companion/pairings')
})

test('pending status is polled and approved status is redeemed exactly once', async () => {
  const { api, scheduler, service, redeemed } = fixture()
  api.responses.push(
    creation(),
    { pairing: { requestId: creation().requestId, status: 'pending' } },
    { pairing: { requestId: creation().requestId, status: 'approved' } },
    { token: 't'.repeat(43), interviewId: 'interview-1', expiresAt: new Date(500_000).toISOString() },
  )
  await service.start()
  scheduler.runNext()
  await settle()
  assert.equal(service.getState().status, 'pending')
  scheduler.runNext()
  await settle()
  assert.equal(service.getState().status, 'connected')
  assert.equal(redeemed.length, 1)
  assert.equal(api.calls.filter((call) => call.path.endsWith('/redeem')).length, 1)
  assert.equal(JSON.stringify(service.getState()).includes('t'.repeat(43)), false)
})

test('expiration stops polling without attempting redemption', async () => {
  const { api, scheduler, service } = fixture()
  api.responses.push(creation())
  await service.start()
  scheduler.nowValue = Date.parse(expiresAt)
  scheduler.runNext()
  await settle()
  assert.equal(service.getState().status, 'expired')
  assert.equal(api.calls.length, 1)
})

test('cancellation destroys the active attempt and prevents later polling', async () => {
  const { api, scheduler, service } = fixture()
  api.responses.push(creation())
  await service.start()
  assert.equal(service.cancel().status, 'cancelled')
  assert.equal(scheduler.entries.every((entry) => entry.cancelled), true)
  assert.equal(api.calls.length, 1)
})

test('invalid or unavailable pairing credentials become expired', async () => {
  const { api, scheduler, service } = fixture()
  api.responses.push(creation(), Object.assign(new Error('Unavailable'), { status: 404 }))
  await service.start()
  scheduler.runNext()
  await settle()
  assert.equal(service.getState().status, 'expired')
})

test('an in-flight status request prevents duplicate polling', async () => {
  const { api, scheduler, service } = fixture()
  let resolveStatus: ((value: unknown) => void) | undefined
  const status = new Promise((resolve) => { resolveStatus = resolve })
  api.responses.push(creation(), status)
  await service.start()
  const poll = scheduler.entries[0]!.callback
  poll()
  poll()
  await settle()
  assert.equal(api.calls.filter((call) => call.path.endsWith('/status')).length, 1)
  resolveStatus?.({ pairing: { requestId: creation().requestId, status: 'pending' } })
  await settle()
})

test('temporary status network failures retry without creating a second pairing', async () => {
  const { api, scheduler, service } = fixture()
  api.responses.push(creation(), new Error('network'), { pairing: { requestId: creation().requestId, status: 'pending' } })
  await service.start()
  scheduler.runNext()
  await settle()
  assert.equal(service.getState().status, 'pending')
  assert.match(service.getState().error ?? '', /keep trying/)
  scheduler.runNext()
  await settle()
  assert.equal(api.calls.filter((call) => call.path === '/api/v1/companion/pairings').length, 1)
})

test('a redemption network failure is not retried automatically', async () => {
  const { api, scheduler, service } = fixture()
  api.responses.push(creation(), { pairing: { requestId: creation().requestId, status: 'approved' } }, new Error('timeout'))
  await service.start()
  scheduler.runNext()
  await settle()
  assert.equal(service.getState().status, 'failed')
  assert.match(service.getState().error ?? '', /Generate a new code/)
  assert.equal(api.calls.filter((call) => call.path.endsWith('/redeem')).length, 1)
})

test('paired bearer tokens and interview IDs persist only through secure client storage', async () => {
  class MemoryStorage implements ProductStorage {
    value: unknown
    async load() { return this.value }
    async save(value: unknown) { this.value = structuredClone(value) }
    async clear() { this.value = undefined }
  }
  const storage = new MemoryStorage()
  const client = new ApiClient('https://api.example.com', storage)
  await client.setPairedSession('private-desktop-token', 'interview-1')
  assert.equal(client.hasToken(), true)
  assert.equal(client.getPairedInterviewId(), 'interview-1')
  assert.equal(JSON.stringify(connection).includes('private-desktop-token'), false)

  const restored = new ApiClient('https://api.example.com', storage)
  await restored.initialize()
  assert.equal(restored.hasToken(), true)
  assert.equal(restored.getPairedInterviewId(), 'interview-1')
})

test('a redeemed session loads only its approved active interview without starting audio', async () => {
  const calls: string[] = []
  let stored: { token: string; interviewId: string } | undefined
  const api = {
    setPairedSession: async (token: string, interviewId: string) => { stored = { token, interviewId } },
    clearPairedInterviewId: async () => { calls.push('clear-paired') },
    request: async (path: string) => {
      calls.push(path)
      if (path === '/api/v1/auth/me') return { user: { id: 'user-1', email: 'candidate@example.com' } }
      return {
        interview: {
          id: 'interview-1', userId: 'user-1', profileId: null, name: 'Website interview', company: null, role: null,
          resumeText: 'Resume', jobDescriptionText: 'Job', instructions: 'Instructions', status: 'active',
          createdAt: new Date(1).toISOString(), updatedAt: new Date(2).toISOString(),
        },
        turns: [],
      }
    },
  }
  const product = new ApiProductService(api as unknown as ApiClient)
  const interview = await product.acceptPairedSession('t'.repeat(43), 'interview-1')
  assert.deepEqual(stored, { token: 't'.repeat(43), interviewId: 'interview-1' })
  assert.equal(interview.id, 'interview-1')
  assert.equal(product.getActiveInterviewId(), 'interview-1')
  assert.deepEqual(calls, ['/api/v1/auth/me', '/api/v1/interviews/interview-1'])
})

test('paired loading never reactivates a completed interview', async () => {
  let cleared = false
  const api = {
    setPairedSession: async () => {},
    clearPairedInterviewId: async () => { cleared = true },
    request: async (path: string) => path === '/api/v1/auth/me'
      ? { user: { id: 'user-1', email: 'candidate@example.com' } }
      : {
          interview: {
            id: 'interview-1', userId: 'user-1', name: 'Completed', resumeText: '', jobDescriptionText: '', instructions: '',
            status: 'completed', createdAt: new Date(1).toISOString(), updatedAt: new Date(2).toISOString(),
          },
          turns: [],
        },
  }
  const product = new ApiProductService(api as unknown as ApiClient)
  await assert.rejects(product.acceptPairedSession('t'.repeat(43), 'interview-1'), /no longer active/)
  assert.equal(cleared, true)
  assert.equal(product.getActiveInterviewId(), undefined)
})
