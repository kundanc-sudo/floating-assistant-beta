import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { buildApp } from '../src/app.js'
import { hashToken } from '../src/auth/authService.js'
import type { AiProvider, AiRequest, ProviderEvent } from '../src/ai/provider.js'
import type { AuthSessionRecord, AuthTokenType, CompanionPairingRecord, InterviewRecord, ProductStore, ProfileRecord, TurnRecord, UsageRecord, UserRecord } from '../src/db/store.js'
import { TestEmailService, type EmailService } from '../src/email/emailService.js'

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
  pairings: CompanionPairingRecord[] = []
  async createUser(input: { email: string; passwordHash: string; displayName: string }) { const now = new Date(); const row = { id: randomUUID(), ...input, emailVerifiedAt: null, createdAt: now, updatedAt: now }; this.users.push(row); return row }
  async findUserByEmail(email: string) { return this.users.find((row) => row.email === email) ?? null }
  async findUserById(id: string) { return this.users.find((row) => row.id === id) ?? null }
  async updateUser(id: string, displayName: string) { const row = await this.findUserById(id); if (!row) return null; row.displayName = displayName; row.updatedAt = new Date(); return row }
  async deleteUser(id: string) { const before = this.users.length; const interviewIds = new Set(this.interviews.filter((row) => row.userId === id).map((row) => row.id)); this.users = this.users.filter((row) => row.id !== id); this.sessions = this.sessions.filter((row) => row.userId !== id); this.tokens = this.tokens.filter((row) => row.userId !== id); this.profiles = this.profiles.filter((row) => row.userId !== id); this.interviews = this.interviews.filter((row) => row.userId !== id); this.turns = this.turns.filter((row) => !interviewIds.has(row.sessionId)); this.usage = this.usage.filter((row) => row.userId !== id); this.pairings = this.pairings.filter((row) => row.userId !== id && (!row.interviewId || !interviewIds.has(row.interviewId))); return this.users.length !== before }
  async createSession(input: { userId: string; tokenHash: string; deviceLabel: string; expiresAt: Date }) { const now = new Date(); const row = { id: randomUUID(), ...input, lastUsedAt: now, createdAt: now }; this.sessions.push(row); return row }
  async findUserBySession(tokenHash: string, now: Date) { const session = this.sessions.find((row) => row.tokenHash === tokenHash && row.expiresAt > now); const user = session ? await this.findUserById(session.userId) : null; return session && user ? { user, session } : null }
  async touchSession(id: string, at: Date) { const row = this.sessions.find((item) => item.id === id); if (row) row.lastUsedAt = at }
  async deleteSession(tokenHash: string) { this.sessions = this.sessions.filter((row) => row.tokenHash !== tokenHash) }
  async listSessions(userId: string) { return this.sessions.filter((row) => row.userId === userId) }
  async deleteOtherSessions(userId: string, currentSessionId: string) { const before = this.sessions.length; this.sessions = this.sessions.filter((row) => row.userId !== userId || row.id === currentSessionId); return before - this.sessions.length }
  async trimSessions(userId: string, keep: number) { const mine = this.sessions.filter((row) => row.userId === userId).sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime()); const remove = new Set(mine.slice(keep).map((row) => row.id)); this.sessions = this.sessions.filter((row) => !remove.has(row.id)) }
  async createCompanionPairing(input: { codeHash: string; redemptionSecretHash: string; expiresAt: Date }) { const now = new Date(); const row: CompanionPairingRecord = { id: randomUUID(), ...input, userId: null, interviewId: null, status: 'pending', approvedAt: null, redeemedAt: null, cancelledAt: null, createdAt: now, updatedAt: now }; this.pairings.push(row); return { id: row.id, expiresAt: row.expiresAt } }
  async approveCompanionPairing(input: { userId: string; interviewId: string; codeHash: string; now: Date }) { const interview = await this.getInterview(input.userId, input.interviewId); const row = this.pairings.find((item) => item.codeHash === input.codeHash && item.status === 'pending' && item.expiresAt > input.now); if (!interview || interview.status !== 'active' || !row) return null; row.userId = input.userId; row.interviewId = input.interviewId; row.status = 'approved'; row.approvedAt = row.updatedAt = input.now; return { id: row.id, expiresAt: row.expiresAt } }
  async getCompanionPairingStatus(id: string, redemptionSecretHash: string, now: Date) { const row = this.pairings.find((item) => item.id === id && item.redemptionSecretHash === redemptionSecretHash && item.expiresAt > now && (item.status === 'pending' || item.status === 'approved')); return row?.status === 'pending' || row?.status === 'approved' ? row.status : null }
  async redeemCompanionPairing(input: { id: string; redemptionSecretHash: string; tokenHash: string; deviceLabel: string; sessionExpiresAt: Date; now: Date; maxSessionsPerUser: number }) { const row = this.pairings.find((item) => item.id === input.id && item.redemptionSecretHash === input.redemptionSecretHash && item.status === 'approved' && item.expiresAt > input.now); const interview = row?.userId && row.interviewId ? this.interviews.find((item) => item.id === row.interviewId && item.userId === row.userId) : null; if (!row?.userId || !row.interviewId || !interview || interview.status !== 'active') return null; row.status = 'redeemed'; row.redeemedAt = row.updatedAt = input.now; const session = await this.createSession({ userId: row.userId, tokenHash: input.tokenHash, deviceLabel: input.deviceLabel, expiresAt: input.sessionExpiresAt }); await this.trimSessions(row.userId, input.maxSessionsPerUser); return { interviewId: row.interviewId, session } }
  async cancelCompanionPairingsForUser(userId: string, at: Date) { for (const row of this.pairings) if (row.userId === userId && row.status === 'approved') { row.status = 'cancelled'; row.cancelledAt = row.updatedAt = at } }
  async createAuthToken(input: { userId: string; type: AuthTokenType; tokenHash: string; expiresAt: Date }) { this.tokens.push({ ...input, usedAt: null }) }
  async hasValidAuthToken(tokenHash: string, type: AuthTokenType, now: Date) { return this.tokens.some((row) => row.tokenHash === tokenHash && row.type === type && !row.usedAt && row.expiresAt > now) }
  async consumeAuthToken(tokenHash: string, type: AuthTokenType, now: Date) { const token = this.tokens.find((row) => row.tokenHash === tokenHash && row.type === type && !row.usedAt && row.expiresAt > now); if (!token) return null; token.usedAt = now; return this.findUserById(token.userId) }
  async invalidateAuthTokens(userId: string, type: AuthTokenType) { for (const token of this.tokens) if (token.userId === userId && token.type === type && !token.usedAt) token.usedAt = new Date() }
  async updatePasswordAndRevokeSessions(userId: string, passwordHash: string) { const user = await this.findUserById(userId); if (user) user.passwordHash = passwordHash; this.sessions = this.sessions.filter((row) => row.userId !== userId); await this.cancelCompanionPairingsForUser(userId, new Date()) }
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
  assert.equal(typeof account.token, 'string')
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'A@example.com', password: 'correct horse battery', displayName: 'A' } })).statusCode, 409)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@example.com', password: 'wrong-password' } })).statusCode, 401)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode, 401)
  const electronMe = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(account.token) })
  assert.equal(electronMe.json().user.email, 'a@example.com')
  assert.equal(electronMe.json().csrfToken, undefined)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: authorization(account.token) })).statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(account.token) })).statusCode, 401)
  await app.close()
})

test('browser registration, restoration, CSRF protection, and logout use a secure HttpOnly cookie', async () => {
  const store = new MemoryStore()
  const origin = 'https://app.example'
  const app = await buildApp({
    store,
    aiProvider: new TestProvider(),
    production: true,
    allowedOrigins: [origin],
    auth: { maxSessionsPerUser: 10, passwordResetTtlMinutes: 30, emailVerificationTtlHours: 24, publicBaseUrl: origin, betaMode: false },
  })
  const registered = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/browser/register',
    headers: { origin },
    payload: { email: 'browser@example.com', password: 'correct horse battery', displayName: 'Browser User' },
  })
  assert.equal(registered.statusCode, 201)
  const body = registered.json<{ user: { email: string; emailVerified: boolean }; csrfToken: string; token?: string }>()
  assert.equal(body.user.email, 'browser@example.com')
  assert.equal(body.user.emailVerified, false)
  assert.equal(body.token, undefined)
  assert.ok(body.csrfToken.length >= 32)
  const setCookie = String(registered.headers['set-cookie'])
  assert.match(setCookie, /^__Host-floating_assistant_session=/)
  assert.match(setCookie, /; Path=\//)
  assert.match(setCookie, /; HttpOnly/)
  assert.match(setCookie, /; Secure/)
  assert.match(setCookie, /; SameSite=None/)
  const cookie = setCookie.split(';', 1)[0]

  const restored = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })
  assert.equal(restored.statusCode, 200)
  assert.equal(restored.json().user.email, 'browser@example.com')
  assert.equal(restored.json().csrfToken, body.csrfToken)

  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, origin } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, origin, 'x-csrf-token': 'invalid' } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, origin: 'https://attacker.example', 'x-csrf-token': body.csrfToken } })).statusCode, 403)

  const loggedOut = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, origin, 'x-csrf-token': body.csrfToken } })
  assert.equal(loggedOut.statusCode, 204)
  assert.match(String(loggedOut.headers['set-cookie']), /Max-Age=0/)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode, 401)
  await app.close()
})

test('browser login validates origin and credentials without changing bearer authentication', async () => {
  const store = new MemoryStore()
  const origin = 'http://localhost:5174'
  const app = await buildApp({ store, aiProvider: new TestProvider(), allowedOrigins: [origin] })
  const account = await register(app, 'browser-login@example.com')
  const payload = { email: 'browser-login@example.com', password: 'correct horse battery' }

  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/login', payload })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/login', headers: { origin: 'https://attacker.example' }, payload })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/login', headers: { origin }, payload: { ...payload, password: 'wrong-password' } })).statusCode, 401)
  const invalid = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/login', headers: { origin }, payload: { email: 'not-an-email', password: 'password' } })
  assert.equal(invalid.statusCode, 400)
  assert.deepEqual(invalid.json(), { error: 'Please check the submitted information.' })

  const loggedIn = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/login', headers: { origin }, payload })
  assert.equal(loggedIn.statusCode, 200)
  assert.equal(loggedIn.json().token, undefined)
  assert.match(String(loggedIn.headers['set-cookie']), /^floating_assistant_session=/)
  assert.doesNotMatch(String(loggedIn.headers['set-cookie']), /; Secure/)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(account.token) })).statusCode, 200)
  await app.close()
})

test('desktop pairing creates hashed credentials and supports cookie approval plus one-time redemption', async () => {
  const store = new MemoryStore()
  const origin = 'http://localhost:5174'
  const app = await buildApp({ store, aiProvider: new TestProvider(), allowedOrigins: [origin] })
  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email: 'pairing@example.com', password: 'correct horse battery', displayName: 'Pairing User' } })
  const cookie = String(registered.headers['set-cookie']).split(';', 1)[0]
  const csrf = registered.json().csrfToken as string
  const interview = (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers: { cookie, origin, 'x-csrf-token': csrf }, payload: { name: 'Pairing interview', resumeText: 'resume', jobDescriptionText: 'job', instructions: 'concise' } })).json().interview

  const created = await app.inject({ method: 'POST', url: '/api/v1/companion/pairings' })
  assert.equal(created.statusCode, 201)
  const credentials = created.json<{ requestId: string; pairingCode: string; redemptionSecret: string; expiresAt: string }>()
  assert.match(credentials.pairingCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.ok(credentials.redemptionSecret.length >= 40)
  assert.equal(store.pairings[0].codeHash, hashToken(credentials.pairingCode))
  assert.equal(store.pairings[0].redemptionSecretHash, hashToken(credentials.redemptionSecret))
  assert.notEqual(store.pairings[0].codeHash, credentials.pairingCode)
  assert.notEqual(store.pairings[0].redemptionSecretHash, credentials.redemptionSecret)
  assert.equal((new Date(credentials.expiresAt).getTime() - Date.now()) > 4 * 60_000, true)

  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers: { cookie, origin }, payload: { pairingCode: credentials.pairingCode, interviewId: interview.id } })).statusCode, 403)
  const bearer = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'pairing@example.com', password: 'correct horse battery' } })).json<{ token: string }>().token
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers: authorization(bearer), payload: { pairingCode: credentials.pairingCode, interviewId: interview.id } })).statusCode, 403)
  const approved = await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers: { cookie, origin, 'x-csrf-token': csrf }, payload: { pairingCode: credentials.pairingCode, interviewId: interview.id } })
  assert.equal(approved.statusCode, 200)
  assert.equal(approved.json().pairing.status, 'approved')
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers: { cookie, origin, 'x-csrf-token': csrf }, payload: { pairingCode: credentials.pairingCode, interviewId: interview.id } })).statusCode, 404)

  const status = await app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${credentials.requestId}/status`, payload: { redemptionSecret: credentials.redemptionSecret } })
  assert.equal(status.statusCode, 200)
  assert.deepEqual(status.json().pairing, { requestId: credentials.requestId, status: 'approved' })
  assert.equal(status.json().token, undefined)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${credentials.requestId}/status`, payload: { redemptionSecret: 'x'.repeat(43) } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${credentials.requestId}/redeem`, payload: { redemptionSecret: 'x'.repeat(43) } })).statusCode, 404)

  const redeemed = await app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${credentials.requestId}/redeem`, payload: { redemptionSecret: credentials.redemptionSecret, deviceLabel: 'Windows companion <unsafe>' } })
  assert.equal(redeemed.statusCode, 200)
  const redemption = redeemed.json<{ token: string; interviewId: string; expiresAt: string }>()
  assert.equal(redemption.interviewId, interview.id)
  assert.ok(redemption.token.length >= 40)
  assert.equal(store.sessions.some((session) => session.tokenHash === hashToken(redemption.token) && session.deviceLabel === 'Windows companion unsafe'), true)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(redemption.token) })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${credentials.requestId}/redeem`, payload: { redemptionSecret: credentials.redemptionSecret } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: authorization(redemption.token) })).statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: authorization(redemption.token) })).statusCode, 401)
  await app.close()
})

test('pairing rejects invalid, expired, completed, and cross-account approvals', async () => {
  const store = new MemoryStore()
  const origin = 'http://localhost:5174'
  const app = await buildApp({ store, aiProvider: new TestProvider(), allowedOrigins: [origin] })
  const createBrowser = async (email: string) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email, password: 'correct horse battery', displayName: email } })
    return { cookie: String(response.headers['set-cookie']).split(';', 1)[0], csrf: response.json().csrfToken as string }
  }
  const owner = await createBrowser('pair-owner@example.com')
  const other = await createBrowser('pair-other@example.com')
  const createInterview = async (headers: Record<string, string>, name: string) => (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers, payload: { name, resumeText: 'resume', jobDescriptionText: 'job', instructions: 'concise' } })).json().interview
  const ownerHeaders = { cookie: owner.cookie, origin, 'x-csrf-token': owner.csrf }
  const otherHeaders = { cookie: other.cookie, origin, 'x-csrf-token': other.csrf }
  const active = await createInterview(ownerHeaders, 'Active')

  const invalid = await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers: ownerHeaders, payload: { pairingCode: 'AAAA-AAAA', interviewId: active.id } })
  assert.equal(invalid.statusCode, 404)

  const crossPairing = (await app.inject({ method: 'POST', url: '/api/v1/companion/pairings' })).json()
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers: otherHeaders, payload: { pairingCode: crossPairing.pairingCode, interviewId: active.id } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers: ownerHeaders, payload: { pairingCode: crossPairing.pairingCode, interviewId: active.id } })).statusCode, 200)

  const completed = await createInterview(ownerHeaders, 'Completed')
  await app.inject({ method: 'POST', url: `/api/v1/interviews/${completed.id}/complete`, headers: ownerHeaders })
  const completedPairing = (await app.inject({ method: 'POST', url: '/api/v1/companion/pairings' })).json()
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers: ownerHeaders, payload: { pairingCode: completedPairing.pairingCode, interviewId: completed.id } })).statusCode, 409)

  const expired = (await app.inject({ method: 'POST', url: '/api/v1/companion/pairings' })).json()
  store.pairings.find((row) => row.id === expired.requestId)!.expiresAt = new Date(0)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers: ownerHeaders, payload: { pairingCode: expired.pairingCode, interviewId: active.id } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${expired.requestId}/status`, payload: { redemptionSecret: expired.redemptionSecret } })).statusCode, 404)
  await app.close()
})

test('pairing redemption is atomic under concurrent requests and revalidates interview status', async () => {
  const store = new MemoryStore()
  const origin = 'http://localhost:5174'
  const app = await buildApp({ store, aiProvider: new TestProvider(), allowedOrigins: [origin] })
  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email: 'pair-race@example.com', password: 'correct horse battery', displayName: 'Pair Race' } })
  const headers = { cookie: String(registered.headers['set-cookie']).split(';', 1)[0], origin, 'x-csrf-token': registered.json().csrfToken as string }
  const createInterview = async (name: string) => (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers, payload: { name, resumeText: 'resume', jobDescriptionText: 'job', instructions: 'concise' } })).json().interview
  const preparePairing = async (interviewId: string) => {
    const pairing = (await app.inject({ method: 'POST', url: '/api/v1/companion/pairings' })).json()
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers, payload: { pairingCode: pairing.pairingCode, interviewId } })).statusCode, 200)
    return pairing
  }

  const active = await createInterview('Concurrent')
  const pairing = await preparePairing(active.id)
  const responses = await Promise.all([
    app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${pairing.requestId}/redeem`, payload: { redemptionSecret: pairing.redemptionSecret } }),
    app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${pairing.requestId}/redeem`, payload: { redemptionSecret: pairing.redemptionSecret } }),
  ])
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 404])
  const issuedTokens = responses.filter((response) => response.statusCode === 200).map((response) => response.json().token)
  assert.equal(issuedTokens.length, 1)
  assert.equal(store.sessions.filter((session) => session.tokenHash === hashToken(issuedTokens[0])).length, 1)

  const completedAfterApproval = await createInterview('Complete after approval')
  const stalePairing = await preparePairing(completedAfterApproval.id)
  await app.inject({ method: 'POST', url: `/api/v1/interviews/${completedAfterApproval.id}/complete`, headers })
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${stalePairing.requestId}/redeem`, payload: { redemptionSecret: stalePairing.redemptionSecret } })).statusCode, 404)
  await app.close()
})

test('pairing endpoints limit public creation and website code guesses', async () => {
  const store = new MemoryStore()
  const origin = 'http://localhost:5174'
  const app = await buildApp({ store, aiProvider: new TestProvider(), allowedOrigins: [origin] })
  const creations = []
  for (let index = 0; index < 6; index += 1) creations.push(await app.inject({ method: 'POST', url: '/api/v1/companion/pairings' }))
  assert.deepEqual(creations.map((response) => response.statusCode), [201, 201, 201, 201, 201, 429])

  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email: 'pair-limit@example.com', password: 'correct horse battery', displayName: 'Pair Limit' } })
  const headers = { cookie: String(registered.headers['set-cookie']).split(';', 1)[0], origin, 'x-csrf-token': registered.json().csrfToken as string }
  const interview = (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers, payload: { name: 'Rate limited', resumeText: 'resume', jobDescriptionText: 'job', instructions: 'concise' } })).json().interview
  const guesses = []
  const guessSuffixes = '23456789A'
  for (let index = 0; index < 9; index += 1) {
    const code = `AAAA-AAA${guessSuffixes[index]}`
    guesses.push(await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers, payload: { pairingCode: code, interviewId: interview.id } }))
  }
  assert.deepEqual(guesses.map((response) => response.statusCode), [404, 404, 404, 404, 404, 404, 404, 404, 429])
  await app.close()
})

test('password reset invalidates an approved pairing before it can mint a desktop session', async () => {
  const store = new MemoryStore()
  const email = new TestEmailService()
  const origin = 'http://localhost:5174'
  const app = await buildApp({ store, aiProvider: new TestProvider(), emailService: email, allowedOrigins: [origin] })
  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email: 'pair-reset@example.com', password: 'correct horse battery', displayName: 'Pair Reset' } })
  const headers = { cookie: String(registered.headers['set-cookie']).split(';', 1)[0], origin, 'x-csrf-token': registered.json().csrfToken as string }
  const interview = (await app.inject({ method: 'POST', url: '/api/v1/interviews', headers, payload: { name: 'Reset pairing', resumeText: 'resume', jobDescriptionText: 'job', instructions: 'concise' } })).json().interview
  const pairing = (await app.inject({ method: 'POST', url: '/api/v1/companion/pairings' })).json()
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/companion/pairings/approve', headers, payload: { pairingCode: pairing.pairingCode, interviewId: interview.id } })).statusCode, 200)

  await app.inject({ method: 'POST', url: '/api/v1/auth/browser/forgot-password', headers: { origin }, payload: { email: 'pair-reset@example.com' } })
  const resetToken = new URL(email.passwordResetUrl).searchParams.get('token')!
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/reset-password', headers: { origin }, payload: { token: resetToken, password: 'a replacement password' } })).statusCode, 204)
  assert.equal(store.pairings.find((row) => row.id === pairing.requestId)?.status, 'cancelled')
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/companion/pairings/${pairing.requestId}/redeem`, payload: { redemptionSecret: pairing.redemptionSecret } })).statusCode, 404)
  await app.close()
})

test('cookie-authenticated users remain isolated across accounts', async () => {
  const store = new MemoryStore()
  const origin = 'http://localhost:5174'
  const app = await buildApp({ store, aiProvider: new TestProvider(), allowedOrigins: [origin] })
  const createBrowser = async (email: string) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email, password: 'correct horse battery', displayName: email } })
    return { cookie: String(response.headers['set-cookie']).split(';', 1)[0], csrf: response.json().csrfToken as string }
  }
  const a = await createBrowser('cookie-a@example.com')
  const b = await createBrowser('cookie-b@example.com')
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/profiles',
    headers: { cookie: a.cookie, origin, 'x-csrf-token': a.csrf },
    payload: { name: 'Private A', resumeText: 'private resume', defaultInstructions: 'private instructions' },
  })
  assert.equal(created.statusCode, 201)
  const profileId = created.json().profile.id as string
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/profiles/${profileId}`, headers: { cookie: b.cookie } })).statusCode, 404)
  await app.close()
})

test('browser verification and password recovery are origin checked, generic, expiring, and single use', async () => {
  const store = new MemoryStore()
  const email = new TestEmailService()
  const origin = 'http://localhost:5174'
  const app = await buildApp({
    store,
    aiProvider: new TestProvider(),
    emailService: email,
    allowedOrigins: [origin],
    auth: { maxSessionsPerUser: 10, passwordResetTtlMinutes: 30, emailVerificationTtlHours: 24, publicBaseUrl: 'http://localhost:3001', webAppBaseUrl: origin, betaMode: false },
  })
  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email: 'browser-recovery@example.com', password: 'correct horse battery', displayName: 'Recovery User' } })
  const cookie = String(registered.headers['set-cookie']).split(';', 1)[0]
  const csrf = registered.json().csrfToken as string
  assert.equal(new URL(email.verificationUrl).origin, origin)
  const firstVerificationUrl = email.verificationUrl
  const resend = await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', headers: { cookie, origin, 'x-csrf-token': csrf } })
  assert.equal(resend.statusCode, 204)
  assert.notEqual(email.verificationUrl, firstVerificationUrl)
  const verificationToken = new URL(email.verificationUrl).searchParams.get('token')!
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/verify-email', payload: { token: verificationToken } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/verify-email', headers: { origin }, payload: { token: verificationToken } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/verify-email', headers: { origin }, payload: { token: verificationToken } })).statusCode, 400)
  const known = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/forgot-password', headers: { origin }, payload: { email: 'browser-recovery@example.com' } })
  const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/forgot-password', headers: { origin }, payload: { email: 'missing@example.com' } })
  assert.equal(known.statusCode, 200)
  assert.deepEqual(known.json(), unknown.json())
  assert.equal(new URL(email.passwordResetUrl).origin, origin)
  let resetToken = new URL(email.passwordResetUrl).searchParams.get('token')!
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/reset-password/validate', payload: { token: resetToken } })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/reset-password/validate', headers: { origin }, payload: { token: resetToken } })).statusCode, 200)
  store.tokens.find((row) => row.tokenHash === hashToken(resetToken))!.expiresAt = new Date(0)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/reset-password/validate', headers: { origin }, payload: { token: resetToken } })).statusCode, 400)

  await app.inject({ method: 'POST', url: '/api/v1/auth/browser/forgot-password', headers: { origin }, payload: { email: 'browser-recovery@example.com' } })
  resetToken = new URL(email.passwordResetUrl).searchParams.get('token')!
  const reset = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/reset-password', headers: { origin }, payload: { token: resetToken, password: 'a new strong password' } })
  assert.equal(reset.statusCode, 204)
  assert.match(String(reset.headers['set-cookie']), /Max-Age=0/)
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/browser/reset-password', headers: { origin }, payload: { token: resetToken, password: 'another strong password' } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode, 401)
  await app.close()
})

test('browser account settings update, list and revoke sessions, and confirm deletion', async () => {
  const store = new MemoryStore()
  const origin = 'http://localhost:5174'
  const app = await buildApp({ store, aiProvider: new TestProvider(), allowedOrigins: [origin] })
  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email: 'settings@example.com', password: 'correct horse battery', displayName: 'Original Name' } })
  const cookie = String(registered.headers['set-cookie']).split(';', 1)[0]
  const csrf = registered.json().csrfToken as string
  await app.inject({ method: 'POST', url: '/api/v1/auth/browser/login', headers: { origin }, payload: { email: 'settings@example.com', password: 'correct horse battery' } })

  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/auth/me', headers: { cookie, origin }, payload: { displayName: 'Updated Name' } })).statusCode, 403)
  const updated = await app.inject({ method: 'PUT', url: '/api/v1/auth/me', headers: { cookie, origin, 'x-csrf-token': csrf }, payload: { displayName: 'Updated Name' } })
  assert.equal(updated.statusCode, 200)
  assert.equal(updated.json().user.displayName, 'Updated Name')
  const sessions = await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: { cookie } })
  assert.equal(sessions.statusCode, 200)
  assert.equal(sessions.json().sessions.length, 2)
  assert.equal(sessions.json().sessions.filter((session: { current: boolean }) => session.current).length, 1)
  const revoked = await app.inject({ method: 'POST', url: '/api/v1/auth/sessions/logout-others', headers: { cookie, origin, 'x-csrf-token': csrf } })
  assert.equal(revoked.json().revoked, 1)

  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/auth/me', headers: { cookie, origin, 'x-csrf-token': csrf }, payload: { password: 'correct horse battery', confirmation: 'NO' } })).statusCode, 400)
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/auth/me', headers: { cookie, origin, 'x-csrf-token': csrf }, payload: { password: 'wrong password', confirmation: 'DELETE' } })).statusCode, 401)
  assert.ok(await store.findUserByEmail('settings@example.com'))
  const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/auth/me', headers: { cookie, origin, 'x-csrf-token': csrf }, payload: { password: 'correct horse battery', confirmation: 'DELETE' } })
  assert.equal(deleted.statusCode, 204)
  assert.match(String(deleted.headers['set-cookie']), /Max-Age=0/)
  assert.equal(await store.findUserByEmail('settings@example.com'), null)
  await app.close()
})

test('browser verification resend reports a sanitized provider failure', async () => {
  const store = new MemoryStore()
  const origin = 'http://localhost:5174'
  const failingEmail: EmailService = {
    async sendPasswordReset() {},
    async sendEmailVerification() { throw new Error('provider details must remain private') },
  }
  const app = await buildApp({ store, aiProvider: new TestProvider(), emailService: failingEmail, allowedOrigins: [origin] })
  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email: 'delivery-failure@example.com', password: 'correct horse battery', displayName: 'Delivery Failure' } })
  assert.equal(registered.statusCode, 201)
  const failed = await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', headers: { cookie: String(registered.headers['set-cookie']).split(';', 1)[0], origin, 'x-csrf-token': registered.json().csrfToken } })
  assert.equal(failed.statusCode, 500)
  assert.deepEqual(failed.json(), { error: 'The request could not be completed.' })
  assert.doesNotMatch(failed.body, /provider details/)
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
  for (const expected of ['users', 'auth_sessions', 'auth_tokens', 'beta_invites', 'candidate_profiles', 'interview_sessions', 'companion_pairings', 'interview_turns', 'usage_events']) assert.ok(names.includes(expected))
  await db.close()
})

test('PostgreSQL pairing state rolls back when desktop session creation fails', async () => {
  const directory = path.resolve('drizzle')
  const sqlFiles = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
  const db = new PGlite()
  for (const sqlFile of sqlFiles) {
    const sql = await readFile(path.join(directory, sqlFile), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) await db.exec(statement)
  }
  const userId = randomUUID()
  const interviewId = randomUUID()
  const pairingId = randomUUID()
  await db.query('insert into users (id, email, password_hash, display_name) values ($1, $2, $3, $4)', [userId, 'database-pairing@example.com', 'hash', 'Database Pairing'])
  await db.query("insert into interview_sessions (id, user_id, name, resume_text, job_description_text, instructions, status) values ($1, $2, $3, $4, $5, $6, 'active')", [interviewId, userId, 'Database pairing', 'resume', 'job', 'concise'])
  await db.query("insert into companion_pairings (id, code_hash, redemption_secret_hash, user_id, interview_id, status, expires_at, approved_at) values ($1, $2, $3, $4, $5, 'approved', $6, now())", [pairingId, hashToken('ABCD-EFGH'), hashToken('s'.repeat(43)), userId, interviewId, new Date(Date.now() + 60_000)])

  await db.exec('begin')
  let sessionInsertFailed = false
  try {
    await db.query("update companion_pairings set status='redeemed', redeemed_at=now() where id=$1 and status='approved'", [pairingId])
    await db.query('insert into auth_sessions (user_id, token_hash, device_label, expires_at) values ($1, $2, $3, $4)', [userId, null, 'Windows companion', new Date(Date.now() + 60_000)])
    await db.exec('commit')
  } catch {
    sessionInsertFailed = true
    await db.exec('rollback')
  }
  assert.equal(sessionInsertFailed, true)
  const afterRollback = await db.query<{ status: string }>('select status from companion_pairings where id=$1', [pairingId])
  assert.equal(afterRollback.rows[0]?.status, 'approved')

  const first = await db.query<{ id: string }>("update companion_pairings set status='redeemed', redeemed_at=now() where id=$1 and status='approved' returning id", [pairingId])
  const replay = await db.query<{ id: string }>("update companion_pairings set status='redeemed', redeemed_at=now() where id=$1 and status='approved' returning id", [pairingId])
  assert.equal(first.rows.length, 1)
  assert.equal(replay.rows.length, 0)
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

  assert.equal(
    new URL(email.passwordResetUrl).pathname,
    '/reset-password'
  )
  assert.ok(token)
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

test('document extraction requires authentication and preserves browser CSRF enforcement', async () => {
  const store = new MemoryStore()
  const origin = 'http://localhost:5174'
  const app = await buildApp({ store, aiProvider: new TestProvider(), allowedOrigins: [origin], auth: { maxSessionsPerUser: 10, passwordResetTtlMinutes: 30, emailVerificationTtlHours: 24, publicBaseUrl: 'http://localhost:3001', webAppBaseUrl: origin, betaMode: false } })
  const payload = Buffer.from('Synthetic candidate resume')
  const uploadHeaders = { 'content-type': 'application/octet-stream', 'x-document-name': 'resume.txt' }

  const anonymous = await app.inject({ method: 'POST', url: '/api/v1/documents/extract', headers: uploadHeaders, payload })
  assert.equal(anonymous.statusCode, 401)

  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/browser/register', headers: { origin }, payload: { email: 'document@example.com', password: 'correct horse battery', displayName: 'Document Test' } })
  assert.equal(registered.statusCode, 201)
  const cookie = String(registered.headers['set-cookie']).split(';', 1)[0]
  const csrf = registered.json().csrfToken as string

  const missingCsrf = await app.inject({ method: 'POST', url: '/api/v1/documents/extract', headers: { ...uploadHeaders, cookie, origin }, payload })
  assert.equal(missingCsrf.statusCode, 403)
  const wrongOrigin = await app.inject({ method: 'POST', url: '/api/v1/documents/extract', headers: { ...uploadHeaders, cookie, origin: 'https://attacker.example', 'x-csrf-token': csrf }, payload })
  assert.equal(wrongOrigin.statusCode, 403)

  const extracted = await app.inject({ method: 'POST', url: '/api/v1/documents/extract', headers: { ...uploadHeaders, cookie, origin, 'x-csrf-token': csrf }, payload })
  assert.equal(extracted.statusCode, 200)
  assert.deepEqual(extracted.json().document, { filename: 'resume.txt', kind: 'txt', text: 'Synthetic candidate resume', characters: 26 })
  assert.equal(store.profiles.length, 0)
  assert.equal(store.interviews.length, 0)
  await app.close()
})
