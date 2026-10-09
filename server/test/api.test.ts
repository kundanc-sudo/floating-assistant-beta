import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { buildApp } from '../src/app.js'
import { hashToken } from '../src/auth/authService.js'
import type { AiProvider, AiRequest, ProviderEvent } from '../src/ai/provider.js'
import type { AuthSessionRecord, AuthTokenType, InterviewRecord, ProductStore, ProfileRecord, TurnRecord, UsageRecord, UserRecord } from '../src/db/store.js'
import { TestEmailService } from '../src/email/emailService.js'

class TestProvider implements AiProvider {
  async *stream(_input: AiRequest, _signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    yield { delta: 'streamed ' }
    yield { delta: 'answer' }
    yield { usage: { inputTokens: 12, outputTokens: 3 } }
  }
  async createRealtimeSecret() { return { value: 'ephemeral-test-only', expiresAt: Date.now() + 60_000 } }
  async summarize() { return 'summary' }
}

class MemoryStore implements ProductStore {
  users: UserRecord[] = []
  sessions: Array<AuthSessionRecord & { tokenHash: string }> = []
  tokens: Array<{ userId: string; type: AuthTokenType; tokenHash: string; expiresAt: Date; usedAt: Date | null }> = []
  invites: Array<{ id: string; codeHash: string; email: string | null; expiresAt: Date; usedAt: Date | null }> = []
  profiles: ProfileRecord[] = []
  interviews: InterviewRecord[] = []
  turns: TurnRecord[] = []
  usage: UsageRecord[] = []
  async createUser(input: { email: string; passwordHash: string; displayName: string }) { const now = new Date(); const row = { id: randomUUID(), ...input, emailVerifiedAt: null, createdAt: now, updatedAt: now }; this.users.push(row); return row }
  async findUserByEmail(email: string) { return this.users.find((row) => row.email === email) ?? null }
  async findUserById(id: string) { return this.users.find((row) => row.id === id) ?? null }
  async updateUser(id: string, displayName: string) { const row = await this.findUserById(id); if (!row) return null; row.displayName = displayName; row.updatedAt = new Date(); return row }
  async deleteUser(id: string) { const before = this.users.length; const interviewIds = new Set(this.interviews.filter((row) => row.userId === id).map((row) => row.id)); this.users = this.users.filter((row) => row.id !== id); this.sessions = this.sessions.filter((row) => row.userId !== id); this.tokens = this.tokens.filter((row) => row.userId !== id); this.profiles = this.profiles.filter((row) => row.userId !== id); this.interviews = this.interviews.filter((row) => row.userId !== id); this.turns = this.turns.filter((row) => !interviewIds.has(row.sessionId)); this.usage = this.usage.filter((row) => row.userId !== id); return this.users.length !== before }
  async createSession(input: { userId: string; tokenHash: string; deviceLabel: string; expiresAt: Date }) { const now = new Date(); const row = { id: randomUUID(), ...input, lastUsedAt: now, createdAt: now }; this.sessions.push(row); return row }
  async findUserBySession(tokenHash: string, now: Date) { const session = this.sessions.find((row) => row.tokenHash === tokenHash && row.expiresAt > now); const user = session ? await this.findUserById(session.userId) : null; return session && user ? { user, session } : null }
  async touchSession(id: string, at: Date) { const row = this.sessions.find((item) => item.id === id); if (row) row.lastUsedAt = at }
  async deleteSession(tokenHash: string) { this.sessions = this.sessions.filter((row) => row.tokenHash !== tokenHash) }
  async listSessions(userId: string) { return this.sessions.filter((row) => row.userId === userId) }
  async deleteOtherSessions(userId: string, currentSessionId: string) { const before = this.sessions.length; this.sessions = this.sessions.filter((row) => row.userId !== userId || row.id === currentSessionId); return before - this.sessions.length }
  async trimSessions(userId: string, keep: number) { const mine = this.sessions.filter((row) => row.userId === userId).sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime()); const remove = new Set(mine.slice(keep).map((row) => row.id)); this.sessions = this.sessions.filter((row) => !remove.has(row.id)) }
  async createAuthToken(input: { userId: string; type: AuthTokenType; tokenHash: string; expiresAt: Date }) { this.tokens.push({ ...input, usedAt: null }) }
  async consumeAuthToken(tokenHash: string, type: AuthTokenType, now: Date) { const token = this.tokens.find((row) => row.tokenHash === tokenHash && row.type === type && !row.usedAt && row.expiresAt > now); if (!token) return null; token.usedAt = now; return this.findUserById(token.userId) }
  async invalidateAuthTokens(userId: string, type: AuthTokenType) { for (const token of this.tokens) if (token.userId === userId && token.type === type && !token.usedAt) token.usedAt = new Date() }
  async updatePasswordAndRevokeSessions(userId: string, passwordHash: string) { const user = await this.findUserById(userId); if (user) user.passwordHash = passwordHash; this.sessions = this.sessions.filter((row) => row.userId !== userId) }
  async markEmailVerified(userId: string, at: Date) { const user = await this.findUserById(userId); if (user) user.emailVerifiedAt = at; return user }
  async findBetaInvite(codeHash: string, email: string, now: Date) { const row = this.invites.find((invite) => invite.codeHash === codeHash && !invite.usedAt && invite.expiresAt > now && (!invite.email || invite.email === email)); return row ? { id: row.id, email: row.email, expiresAt: row.expiresAt } : null }
  async consumeBetaInvite(id: string, _userId: string, at: Date) { const invite = this.invites.find((row) => row.id === id && !row.usedAt && row.expiresAt > at); if (!invite) return false; invite.usedAt = at; return true }
  async listProfiles(userId: string) { return this.profiles.filter((row) => row.userId === userId) }
  async createProfile(userId: string, input: Omit<ProfileRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) { const now = new Date(); const row = { id: randomUUID(), userId, ...input, createdAt: now, updatedAt: now }; this.profiles.push(row); return row }
  async getProfile(userId: string, id: string) { return this.profiles.find((row) => row.userId === userId && row.id === id) ?? null }
  async updateProfile(userId: string, id: string, input: Partial<Pick<ProfileRecord, 'name' | 'resumeText' | 'defaultInstructions'>>) { const row = await this.getProfile(userId, id); if (!row) return null; Object.assign(row, input, { updatedAt: new Date() }); return row }
  async deleteProfile(userId: string, id: string) { const before = this.profiles.length; this.profiles = this.profiles.filter((row) => row.userId !== userId || row.id !== id); return before !== this.profiles.length }
  async listInterviews(userId: string) { return this.interviews.filter((row) => row.userId === userId).map((row) => ({ ...row, historyTurns: this.turns.filter((turn) => turn.sessionId === row.id).length })) }
  async createInterview(userId: string, input: Omit<InterviewRecord, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt' | 'completedAt'>) { const now = new Date(); const row: InterviewRecord = { id: randomUUID(), userId, ...input, status: 'active', createdAt: now, updatedAt: now, completedAt: null }; this.interviews.push(row); return row }
  async getInterview(userId: string, id: string) { return this.interviews.find((row) => row.userId === userId && row.id === id) ?? null }
  async updateInterview(userId: string, id: string, input: Partial<Pick<InterviewRecord, 'name' | 'company' | 'role' | 'resumeText' | 'jobDescriptionText' | 'instructions' | 'status'>>) { const row = await this.getInterview(userId, id); if (!row) return null; Object.assign(row, input, { updatedAt: new Date() }); return row }
  async completeInterview(userId: string, id: string) { const row = await this.getInterview(userId, id); if (!row) return null; row.status = 'completed'; row.completedAt = row.updatedAt = new Date(); return row }
  async deleteInterview(userId: string, id: string) { const before = this.interviews.length; this.interviews = this.interviews.filter((row) => row.userId !== userId || row.id !== id); return this.interviews.length !== before }
  async listTurns(userId: string, sessionId: string) { return await this.getInterview(userId, sessionId) ? this.turns.filter((row) => row.sessionId === sessionId).sort((a, b) => a.sequence - b.sequence) : null }
  async createTurn(userId: string, sessionId: string, input: Pick<TurnRecord, 'requestId' | 'sequence' | 'question' | 'answer'>) { if (!await this.getInterview(userId, sessionId)) return null; const existing = this.turns.find((row) => row.sessionId === sessionId && row.requestId === input.requestId); if (existing) return existing; const row = { id: randomUUID(), sessionId, ...input, createdAt: new Date() }; this.turns.push(row); return row }
  async createUsage(input: Omit<UsageRecord, 'id' | 'createdAt'>) { this.usage.push({ id: randomUUID(), ...input, createdAt: new Date() }) }
  async listUsage(userId: string) { return this.usage.filter((row) => row.userId === userId) }
  async getUsageSince(userId: string, since: Date) { const rows = this.usage.filter((row) => row.userId === userId && row.createdAt >= since && row.type === 'answer'); return { requests: rows.length, inputTokens: rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0), outputTokens: rows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0) } }
  async exportUserData(userId: string) { return { profiles: this.profiles.filter((row) => row.userId === userId).map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })), interviews: await Promise.all(this.interviews.filter((row) => row.userId === userId).map(async ({ userId: _user, resumeText: _resume, jobDescriptionText: _jd, instructions: _instructions, ...row }) => ({ ...row, turns: (await this.listTurns(userId, row.id)) ?? [] }))) } }
  async checkHealth() {}
}

async function register(app: Awaited<ReturnType<typeof buildApp>>, email: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email, password: 'correct horse battery', displayName: email.split('@')[0] } })
  assert.equal(response.statusCode, 201)
  return response.json<{ token: string; user: UserRecord }>()
}
const authorization = (token: string) => ({ authorization: `Bearer ${token}` })

async function verifyLatest(app: Awaited<ReturnType<typeof buildApp>>, email: TestEmailService) {
  const token = new URL(email.verificationUrl).searchParams.get('token')
  assert.ok(token)
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } })
  assert.equal(response.statusCode, 200)
}

test('authentication supports register/login/me/logout and rejects invalid access', async () => {
  const store = new MemoryStore()
  const app = await buildApp({ store, aiProvider: new TestProvider() })
  const account = await register(app, 'a@example.com')
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'A@example.com', password: 'correct horse battery', displayName: 'A' } })).statusCode, 409)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@example.com', password: 'wrong-password' } })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(account.token) })).json().user.email, 'a@example.com')
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: authorization(account.token) })).statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(account.token) })).statusCode, 401)
  await app.close()
})

test('two users are isolated across profiles, interviews, turns, completion, and AI', async () => {
  const store = new MemoryStore()
  const app = await buildApp({ store, aiProvider: new TestProvider() })
  const a = await register(app, 'a@example.com')
  const b = await register(app, 'b@example.com')
  const profileResponse = await app.inject({ method: 'POST', url: '/api/v1/profiles', headers: authorization(a.token), payload: { name: 'A profile', resumeText: 'resume', defaultInstructions: 'instructions' } })
  const profileId = profileResponse.json().profile.id as string
  for (const method of ['GET', 'PUT', 'DELETE'] as const) {
    const response = await app.inject({ method, url: `/api/v1/profiles/${profileId}`, headers: authorization(b.token), payload: method === 'PUT' ? { name: 'stolen' } : undefined })
    assert.equal(response.statusCode, 404)
  }
  const interviewResponse = await app.inject({ method: 'POST', url: '/api/v1/interviews', headers: authorization(a.token), payload: { profileId, name: 'A interview', resumeText: 'resume', jobDescriptionText: 'jd', instructions: 'instructions' } })
  const interviewId = interviewResponse.json().interview.id as string
  const attempts = [
    ['GET', `/api/v1/interviews/${interviewId}`, undefined],
    ['PUT', `/api/v1/interviews/${interviewId}`, { name: 'stolen' }],
    ['POST', `/api/v1/interviews/${interviewId}/complete`, undefined],
    ['GET', `/api/v1/interviews/${interviewId}/turns`, undefined],
    ['POST', `/api/v1/interviews/${interviewId}/turns`, { requestId: 'x', sequence: 1, question: 'q', answer: 'a' }],
    ['POST', '/api/v1/ai/responses', { sessionId: interviewId, route: 'TECHNICAL', userText: 'q', instructions: 'i' }],
  ] as const
  for (const [method, url, payload] of attempts) {
    const response = await app.inject({ method, url, headers: authorization(b.token), payload })
    assert.equal(response.statusCode, 404, `${method} ${url}`)
  }
  await app.close()
})

test('complete interview flow streams, records usage, persists a completed turn, and reopens history', async () => {
  const store = new MemoryStore()
  const email = new TestEmailService()
  const app = await buildApp({ store, aiProvider: new TestProvider(), emailService: email })
  const user = await register(app, 'flow@example.com')
  await verifyLatest(app, email)
  const auth = authorization(user.token)
  const profile = (await app.inject({ method: 'POST', url: '/api/v1/profiles', headers: auth, payload: { name: 'Backend', resumeText: 'resume', defaultInstructions: 'answer directly' } })).json().profile
  const interview = (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers: auth, payload: { profileId: profile.id, name: 'Interview', resumeText: 'resume', jobDescriptionText: 'jd', instructions: 'answer directly' } })).json().interview
  const stream = await app.inject({ method: 'POST', url: '/api/v1/ai/responses', headers: auth, payload: { sessionId: interview.id, route: 'TECHNICAL', userText: 'question', instructions: 'answer directly' } })
  assert.equal(stream.statusCode, 200)
  assert.match(stream.body, /streamed/)
  assert.match(stream.body, /complete/)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/interviews/${interview.id}/turns`, headers: auth, payload: { requestId: 'req-1', sequence: 1, question: 'question', answer: 'streamed answer' } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/interviews/${interview.id}/complete`, headers: auth })).statusCode, 200)
  const reopened = (await app.inject({ method: 'GET', url: `/api/v1/interviews/${interview.id}`, headers: auth })).json()
  assert.equal(reopened.turns.length, 1)
  assert.equal(reopened.interview.status, 'completed')
  const usage = (await app.inject({ method: 'GET', url: '/api/v1/usage', headers: auth })).json().usage
  assert.equal(usage.length, 1)
  assert.equal(usage[0].inputTokens, 12)
  await app.close()
})

test('generated Drizzle migration initializes a fresh PostgreSQL-compatible database', async () => {
  const directory = path.resolve('drizzle')
  const sqlFiles = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
  assert.ok(sqlFiles.length > 0)
  const db = new PGlite()
  for (const sqlFile of sqlFiles) {
    const sql = await readFile(path.join(directory, sqlFile), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) await db.exec(statement)
  }
  const result = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public'")
  const names = result.rows.map((row) => row.table_name)
  for (const expected of ['users', 'auth_sessions', 'auth_tokens', 'beta_invites', 'candidate_profiles', 'interview_sessions', 'interview_turns', 'usage_events']) assert.ok(names.includes(expected))
  await db.close()
})

test('health endpoints distinguish liveness from dependency readiness', async () => {
  const store = new MemoryStore()
  const app = await buildApp({ store, aiProvider: new TestProvider() })
  assert.equal((await app.inject({ method: 'GET', url: '/health/live' })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode, 200)
  store.checkHealth = async () => { throw new Error('database details must stay private') }
  const unavailable = await app.inject({ method: 'GET', url: '/health/ready' })
  assert.equal(unavailable.statusCode, 503)
  assert.deepEqual(unavailable.json(), { status: 'not_ready' })
  await app.close()
})

test('expired, revoked, and logged-out sessions are rejected', async () => {
  const store = new MemoryStore()
  const app = await buildApp({ store, aiProvider: new TestProvider() })
  const expired = await register(app, 'expired@example.com')
  store.sessions.find((row) => row.userId === expired.user.id)!.expiresAt = new Date(0)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(expired.token) })).statusCode, 401)
  const revoked = await register(app, 'revoked@example.com')
  await store.deleteSession(hashToken(revoked.token))
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(revoked.token) })).statusCode, 401)
  const loggedOut = await register(app, 'loggedout@example.com')
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: authorization(loggedOut.token) })).statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(loggedOut.token) })).statusCode, 401)
  await app.close()
})

test('sign out all other sessions preserves only the current session', async () => {
  const store = new MemoryStore()
  const app = await buildApp({ store, aiProvider: new TestProvider() })
  const first = await register(app, 'sessions@example.com')
  const second = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'sessions@example.com', password: 'correct horse battery' } })).json<{ token: string }>()
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/sessions/logout-others', headers: authorization(second.token) })
  assert.deepEqual(response.json(), { revoked: 1 })
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(first.token) })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(second.token) })).statusCode, 200)
  await app.close()
})

test('password reset is enumeration-safe, expiring, single-use, and revokes sessions', async () => {
  const store = new MemoryStore()
  const email = new TestEmailService()
  const app = await buildApp({ store, aiProvider: new TestProvider(), emailService: email })
  const account = await register(app, 'reset@example.com')
  const known = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'reset@example.com' } })
  const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'unknown@example.com' } })
  assert.deepEqual(known.json(), unknown.json())
  let token = new URL(email.passwordResetUrl).searchParams.get('token')!
  const resetPage = await app.inject({ method: 'GET', url: new URL(email.passwordResetUrl).pathname + new URL(email.passwordResetUrl).search })
  assert.equal(resetPage.statusCode, 200)
  assert.match(resetPage.body, new RegExp(token))
  store.tokens.find((row) => row.tokenHash === hashToken(token))!.expiresAt = new Date(0)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'a new strong password' } })).statusCode, 400)
  await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'reset@example.com' } })
  token = new URL(email.passwordResetUrl).searchParams.get('token')!
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'a new strong password' } })).statusCode, 204)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'another strong password' } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(account.token) })).statusCode, 401)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'reset@example.com', password: 'a new strong password' } })).statusCode, 200)
  await app.close()
})

test('email verification is single-use and gates AI usage', async () => {
  const store = new MemoryStore()
  const email = new TestEmailService()
  const app = await buildApp({ store, aiProvider: new TestProvider(), emailService: email })
  const account = await register(app, 'verify@example.com')
  const interview = (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers: authorization(account.token), payload: { name: 'Verify gate', resumeText: 'resume', jobDescriptionText: '', instructions: 'direct' } })).json().interview
  const request = { method: 'POST' as const, url: '/api/v1/ai/responses', headers: authorization(account.token), payload: { sessionId: interview.id, route: 'TECHNICAL', userText: 'question', instructions: 'direct' } }
  assert.equal((await app.inject(request)).statusCode, 403)
  const token = new URL(email.verificationUrl).searchParams.get('token')!
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } })).statusCode, 400)
  assert.equal((await app.inject(request)).statusCode, 200)
  await app.close()
})

test('beta mode requires a matching invite and prevents invite reuse', async () => {
  const store = new MemoryStore()
  const code = 'private-beta-code'
  store.invites.push({ id: randomUUID(), codeHash: hashToken(code), email: null, expiresAt: new Date(Date.now() + 60_000), usedAt: null })
  const app = await buildApp({ store, aiProvider: new TestProvider(), auth: { maxSessionsPerUser: 10, passwordResetTtlMinutes: 30, emailVerificationTtlHours: 24, publicBaseUrl: 'http://localhost:3001', betaMode: true } })
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'noinvite@example.com', password: 'correct horse battery', displayName: 'No invite' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'invited@example.com', password: 'correct horse battery', displayName: 'Invited', inviteCode: code } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'reused@example.com', password: 'correct horse battery', displayName: 'Reuse', inviteCode: code } })).statusCode, 403)
  await app.close()
})

test('exports are authenticated and isolated, and account deletion cascades private data', async () => {
  const store = new MemoryStore()
  const app = await buildApp({ store, aiProvider: new TestProvider() })
  const a = await register(app, 'export-a@example.com')
  const b = await register(app, 'export-b@example.com')
  await app.inject({ method: 'POST', url: '/api/v1/interviews', headers: authorization(a.token), payload: { name: 'A only', resumeText: 'private resume', jobDescriptionText: 'private jd', instructions: 'private instructions' } })
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/export' })).statusCode, 401)
  const bExport = (await app.inject({ method: 'GET', url: '/api/v1/export', headers: authorization(b.token) })).body
  assert.doesNotMatch(bExport, /A only|private resume|private jd|private instructions/)
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/auth/me', headers: authorization(a.token), payload: { password: 'correct horse battery', confirmation: 'DELETE' } })).statusCode, 204)
  assert.equal(store.users.some((user) => user.id === a.user.id), false)
  assert.equal(store.interviews.some((interview) => interview.userId === a.user.id), false)
  await app.close()
})

test('daily AI request limits and oversized bodies return controlled errors', async () => {
  const store = new MemoryStore()
  const email = new TestEmailService()
  const app = await buildApp({ store, aiProvider: new TestProvider(), emailService: email, aiPolicy: { dailyRequests: 1, dailyTokens: 1000, concurrentRequests: 1, timeoutMs: 5000 } })
  const account = await register(app, 'limits@example.com')
  await verifyLatest(app, email)
  const interview = (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers: authorization(account.token), payload: { name: 'Limits', resumeText: 'resume', jobDescriptionText: '', instructions: 'direct' } })).json().interview
  const body = { sessionId: interview.id, route: 'TECHNICAL', userText: 'q', instructions: 'i' }
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/responses', headers: authorization(account.token), payload: body })).statusCode, 200)
  const limited = await app.inject({ method: 'POST', url: '/api/v1/ai/responses', headers: authorization(account.token), payload: body })
  assert.equal(limited.statusCode, 429)
  assert.equal(limited.json().code, 'DAILY_USAGE_LIMIT_REACHED')
  const oversized = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'limits@example.com', password: 'x'.repeat(6 * 1024 * 1024) } })
  assert.equal(oversized.statusCode, 413)
  await app.close()
})

test('AI concurrency slots are enforced and released after completion', async () => {
  let releaseProvider!: () => void
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const gate = new Promise<void>((resolve) => { releaseProvider = resolve })
  class BlockingProvider extends TestProvider {
    override async *stream(): AsyncGenerator<ProviderEvent> { markStarted(); await gate; yield { delta: 'done' } }
  }
  const store = new MemoryStore()
  const email = new TestEmailService()
  const app = await buildApp({ store, aiProvider: new BlockingProvider(), emailService: email, aiPolicy: { dailyRequests: 100, dailyTokens: 1000, concurrentRequests: 1, timeoutMs: 5000 } })
  const account = await register(app, 'concurrency@example.com')
  await verifyLatest(app, email)
  const interview = (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers: authorization(account.token), payload: { name: 'Concurrency', resumeText: 'resume', jobDescriptionText: '', instructions: 'direct' } })).json().interview
  const request = { method: 'POST' as const, url: '/api/v1/ai/responses', headers: authorization(account.token), payload: { sessionId: interview.id, route: 'TECHNICAL', userText: 'q', instructions: 'i' } }
  const first = app.inject(request)
  await started
  assert.equal((await app.inject(request)).statusCode, 429)
  releaseProvider()
  assert.equal((await first).statusCode, 200)
  assert.equal((await app.inject(request)).statusCode, 200)
  await app.close()
})

test('AI concurrency slot is released after provider failure', async () => {
  class FailOnceProvider extends TestProvider {
    calls = 0
    override async *stream(): AsyncGenerator<ProviderEvent> {
      this.calls += 1
      if (this.calls === 1) throw new Error('provider request content must not escape')
      yield { delta: 'recovered' }
    }
  }
  const store = new MemoryStore()
  const email = new TestEmailService()
  const provider = new FailOnceProvider()
  const app = await buildApp({ store, aiProvider: provider, emailService: email, aiPolicy: { dailyRequests: 100, dailyTokens: 1000, concurrentRequests: 1, timeoutMs: 5000 } })
  const account = await register(app, 'failure-cleanup@example.com')
  await verifyLatest(app, email)
  const interview = (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers: authorization(account.token), payload: { name: 'Failure', resumeText: 'resume', jobDescriptionText: '', instructions: 'direct' } })).json().interview
  const request = { method: 'POST' as const, url: '/api/v1/ai/responses', headers: authorization(account.token), payload: { sessionId: interview.id, route: 'TECHNICAL', userText: 'q', instructions: 'i' } }
  await app.inject(request).catch(() => undefined)
  const recovered = await app.inject(request)
  assert.equal(recovered.statusCode, 200)
  assert.match(recovered.body, /recovered/)
  await app.close()
})

test('AI concurrency slot is released when an SSE client disconnects', async () => {
  let firstAborted!: () => void
  const aborted = new Promise<void>((resolve) => { firstAborted = resolve })
  class DisconnectProvider extends TestProvider {
    calls = 0
    override async *stream(_input: AiRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
      this.calls += 1
      if (this.calls === 1) {
        yield { delta: 'started' }
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => { firstAborted(); resolve() }, { once: true }))
        return
      }
      yield { delta: 'recovered' }
    }
  }
  const store = new MemoryStore()
  const email = new TestEmailService()
  const app = await buildApp({ store, aiProvider: new DisconnectProvider(), emailService: email, aiPolicy: { dailyRequests: 100, dailyTokens: 1000, concurrentRequests: 1, timeoutMs: 5000 } })
  const account = await register(app, 'disconnect-cleanup@example.com')
  await verifyLatest(app, email)
  const interview = (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers: authorization(account.token), payload: { name: 'Disconnect', resumeText: 'resume', jobDescriptionText: '', instructions: 'direct' } })).json().interview
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const controller = new AbortController()
  const response = await fetch(`${address}/api/v1/ai/responses`, { method: 'POST', headers: { ...authorization(account.token), 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: interview.id, route: 'TECHNICAL', userText: 'q', instructions: 'i' }), signal: controller.signal })
  const reader = response.body!.getReader()
  await reader.read()
  controller.abort()
  await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error('disconnect was not observed')), 2000))])
  const recovered = await app.inject({ method: 'POST', url: '/api/v1/ai/responses', headers: authorization(account.token), payload: { sessionId: interview.id, route: 'TECHNICAL', userText: 'q', instructions: 'i' } })
  assert.equal(recovered.statusCode, 200)
  assert.match(recovered.body, /recovered/)
  await app.close()
})

test('production errors and origin rejection expose no internal details', async () => {
  const store = new MemoryStore()
  const app = await buildApp({ store, aiProvider: new TestProvider(), allowedOrigins: ['https://trusted.example'] })
  const account = await register(app, 'errors@example.com')
  store.listProfiles = async () => { throw new Error('SQL stack secret filesystem C:\\private\\file') }
  const failed = await app.inject({ method: 'GET', url: '/api/v1/profiles', headers: authorization(account.token) })
  assert.equal(failed.statusCode, 500)
  assert.deepEqual(failed.json(), { error: 'The request could not be completed.' })
  const rejected = await app.inject({ method: 'GET', url: '/api/v1/profiles', headers: { ...authorization(account.token), origin: 'https://untrusted.example' } })
  assert.equal(rejected.statusCode, 403)
  await app.close()
})
