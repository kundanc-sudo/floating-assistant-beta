import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiClient, ApiClientError } from './apiClient'
import { ApiProductService } from './apiProductService'
import type { ProductStorage } from './productShellService'

class MemoryStorage implements ProductStorage {
  value: unknown
  constructor(value?: unknown) { this.value = value }
  async load() { return this.value }
  async save(value: unknown) { this.value = structuredClone(value) }
  async clear() { this.value = undefined }
}

const user = { id: 'user-1', email: 'candidate@example.com', displayName: 'Candidate', emailVerified: true }
const activeInterview = {
  id: 'interview-1', userId: user.id, profileId: null, name: 'Backend interview', company: 'Example', role: 'Engineer',
  resumeText: 'Synthetic resume', jobDescriptionText: 'Synthetic description', instructions: 'Be concise',
  status: 'active' as const, createdAt: new Date(1_000).toISOString(), updatedAt: new Date(2_000).toISOString(),
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function installFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const original = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch
  return () => { globalThis.fetch = original }
}

test('restart restores a valid encrypted session and active paired interview without starting AI', async () => {
  const storage = new MemoryStorage({ token: 'desktop-token', pairedInterviewId: activeInterview.id })
  const paths: string[] = []
  const restoreFetch = installFetch((url) => {
    const path = new URL(url).pathname
    paths.push(path)
    if (path === '/api/v1/auth/me') return json({ user })
    if (path === `/api/v1/interviews/${activeInterview.id}`) return json({ interview: activeInterview, turns: [] })
    if (path === '/api/v1/profiles') return json({ profiles: [] })
    if (path === '/api/v1/interviews') return json({ interviews: [activeInterview] })
    return json({ error: 'Unexpected request' }, 500)
  })
  try {
    const service = new ApiProductService(new ApiClient('https://api.example.test', storage))
    await service.initialize()
    const bootstrap = await service.getBootstrap()
    assert.equal(bootstrap.user?.id, user.id)
    assert.equal(bootstrap.activeInterviewId, activeInterview.id)
    assert.equal(service.getActiveInterviewId(), activeInterview.id)
    assert.equal(paths.some((path) => path.includes('/ai/') || path.includes('realtime')), false)
  } finally { restoreFetch() }
})

test('restart with a revoked session clears encrypted credentials and returns signed out', async () => {
  const storage = new MemoryStorage({ token: 'revoked-token', pairedInterviewId: activeInterview.id })
  const restoreFetch = installFetch(() => json({ error: 'Authentication required.' }, 401))
  try {
    const client = new ApiClient('https://api.example.test', storage)
    const service = new ApiProductService(client)
    await service.initialize()
    assert.equal((await service.getBootstrap()).user, null)
    assert.equal(client.hasToken(), false)
    assert.equal((storage.value as { token?: string }).token, undefined)
    assert.equal((storage.value as { pairedInterviewId?: string }).pairedInterviewId, undefined)
  } finally { restoreFetch() }
})

test('temporary startup network failure retains credentials and exposes retry state', async () => {
  const storage = new MemoryStorage({ token: 'valid-token', pairedInterviewId: activeInterview.id })
  let offline = true
  const restoreFetch = installFetch((url) => {
    if (offline) throw new TypeError('network unavailable')
    const path = new URL(url).pathname
    if (path === '/api/v1/auth/me') return json({ user })
    if (path === `/api/v1/interviews/${activeInterview.id}`) return json({ interview: activeInterview, turns: [] })
    if (path === '/api/v1/profiles') return json({ profiles: [] })
    if (path === '/api/v1/interviews') return json({ interviews: [activeInterview] })
    return json({}, 500)
  })
  try {
    const client = new ApiClient('https://api.example.test', storage)
    const service = new ApiProductService(client)
    await service.initialize()
    const bootstrap = await service.getBootstrap()
    assert.equal(bootstrap.user, null)
    assert.equal(bootstrap.sessionState, 'offline')
    assert.equal(client.hasToken(), true)
    assert.equal((storage.value as { token?: string }).token, 'valid-token')
    offline = false
    const recovered = await service.retrySessionRestoration()
    assert.equal(recovered.user?.id, user.id)
    assert.equal(recovered.activeInterviewId, activeInterview.id)
  } finally { restoreFetch() }
})

test('deleted or completed paired interviews are not restored or reactivated', async () => {
  for (const outcome of ['deleted', 'completed'] as const) {
    const storage = new MemoryStorage({ token: 'valid-token', pairedInterviewId: activeInterview.id })
    const methods: string[] = []
    const restoreFetch = installFetch((url, init) => {
      const path = new URL(url).pathname
      methods.push(`${init?.method ?? 'GET'} ${path}`)
      if (path === '/api/v1/auth/me') return json({ user })
      if (path === `/api/v1/interviews/${activeInterview.id}`) {
        return outcome === 'deleted'
          ? json({ error: 'Interview not found.' }, 404)
          : json({ interview: { ...activeInterview, status: 'completed' }, turns: [] })
      }
      if (path === '/api/v1/profiles') return json({ profiles: [] })
      if (path === '/api/v1/interviews') return json({ interviews: [] })
      return json({}, 500)
    })
    try {
      const client = new ApiClient('https://api.example.test', storage)
      const service = new ApiProductService(client)
      await service.initialize()
      assert.equal(service.getActiveInterviewId(), undefined)
      assert.equal(client.getPairedInterviewId(), undefined)
      assert.equal(methods.some((entry) => entry.startsWith('PUT ')), false)
    } finally { restoreFetch() }
  }
})

test('a stale sign-in response cannot replace a newer account', async () => {
  const storage = new MemoryStorage()
  let resolveOld!: (response: Response) => void
  const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve })
  const restoreFetch = installFetch((_url, init) => {
    const email = JSON.parse(String(init?.body)) as { email: string }
    if (email.email === 'old@example.com') return oldResponse
    return json({ token: 'new-token', user: { ...user, id: 'user-new', email: 'new@example.com' } })
  })
  try {
    const service = new ApiProductService(new ApiClient('https://api.example.test', storage))
    await service.initialize()
    const oldLogin = service.login('old@example.com', 'password')
    const newUser = await service.login('new@example.com', 'password')
    resolveOld(json({ token: 'old-token', user: { ...user, id: 'user-old', email: 'old@example.com' } }))
    await assert.rejects(oldLogin, /no longer current/)
    assert.equal(newUser.id, 'user-new')
    assert.equal(service.getCurrentUser()?.id, 'user-new')
  } finally { restoreFetch() }
})

test('runtime 401 revokes the matching desktop session and notifies once', async () => {
  const storage = new MemoryStorage({ token: 'desktop-token' })
  const restoreFetch = installFetch(() => json({ error: 'Authentication required.' }, 401))
  try {
    const client = new ApiClient('https://api.example.test', storage)
    await client.initialize()
    let invalidations = 0
    client.onAuthenticationInvalidated(() => { invalidations += 1 })
    await assert.rejects(client.request('/api/v1/auth/me'), (error: unknown) => error instanceof ApiClientError && error.status === 401)
    assert.equal(client.hasToken(), false)
    assert.equal(invalidations, 1)
  } finally { restoreFetch() }
})

test('session invalidation clears cached account and interview state', async () => {
  const storage = new MemoryStorage({ token: 'desktop-token', pairedInterviewId: activeInterview.id })
  const restoreFetch = installFetch((url) => {
    const path = new URL(url).pathname
    if (path === '/api/v1/auth/me') return json({ user })
    if (path === `/api/v1/interviews/${activeInterview.id}`) return json({ interview: activeInterview, turns: [] })
    return json({ profiles: [], interviews: [] })
  })
  try {
    const service = new ApiProductService(new ApiClient('https://api.example.test', storage))
    await service.initialize()
    assert.equal(service.getActiveInterviewId(), activeInterview.id)
    service.invalidateSession()
    assert.equal(service.getCurrentUser(), null)
    assert.equal(service.getActiveInterviewId(), undefined)
  } finally { restoreFetch() }
})

test('stale interview-list responses cannot restore a previous account view', async () => {
  const storage = new MemoryStorage({ token: 'old-token' })
  let resolveProfiles!: (response: Response) => void
  let resolveInterviews!: (response: Response) => void
  const profilesResponse = new Promise<Response>((resolve) => { resolveProfiles = resolve })
  const interviewsResponse = new Promise<Response>((resolve) => { resolveInterviews = resolve })
  let startupValidated = false
  const restoreFetch = installFetch((url, init) => {
    const path = new URL(url).pathname
    if (path === '/api/v1/auth/me') { startupValidated = true; return json({ user }) }
    if (path === '/api/v1/profiles') return profilesResponse
    if (path === '/api/v1/interviews') return interviewsResponse
    if (path === '/api/v1/auth/login') {
      assert.equal(startupValidated, true)
      return json({ token: 'new-token', user: { ...user, id: 'user-new', email: 'new@example.com' } })
    }
    assert.fail(`Unexpected request: ${path} ${init?.method ?? 'GET'}`)
  })
  try {
    const service = new ApiProductService(new ApiClient('https://api.example.test', storage))
    await service.initialize()
    const staleBootstrap = service.getBootstrap()
    await service.login('new@example.com', 'password')
    resolveProfiles(json({ profiles: [{ id: 'old-profile' }] }))
    resolveInterviews(json({ interviews: [activeInterview] }))
    const result = await staleBootstrap
    assert.equal(result.user, null)
    assert.deepEqual(result.interviews, [])
    assert.equal(service.getCurrentUser()?.id, 'user-new')
  } finally { restoreFetch() }
})

test('a stale 401 cannot clear a newly switched account session', async () => {
  const storage = new MemoryStorage({ token: 'old-token' })
  let resolveRequest!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { resolveRequest = resolve })
  const restoreFetch = installFetch(() => pending)
  try {
    const client = new ApiClient('https://api.example.test', storage)
    await client.initialize()
    let invalidated = false
    client.onAuthenticationInvalidated(() => { invalidated = true })
    const oldRequest = client.request('/api/v1/auth/me')
    await client.setToken('new-token')
    resolveRequest(json({ error: 'Authentication required.' }, 401))
    await assert.rejects(oldRequest)
    assert.equal(client.hasToken(), true)
    assert.equal((storage.value as { token?: string }).token, 'new-token')
    assert.equal(invalidated, false)
  } finally { restoreFetch() }
})
