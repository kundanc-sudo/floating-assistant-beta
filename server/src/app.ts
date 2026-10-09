import { Readable } from 'node:stream'
import rateLimit from '@fastify/rate-limit'
import Fastify, { LogController, type FastifyReply, type FastifyRequest } from 'fastify'
import { AuthService, bearerToken, publicUser } from './auth/authService.js'
import type { AiProvider, AiRequest, ProviderUsage } from './ai/provider.js'
import type { AuthSessionRecord, ProductStore, UserRecord } from './db/store.js'
import { ConsoleEmailService, type EmailService } from './email/emailService.js'

interface Dependencies {
  store: ProductStore
  aiProvider: AiProvider
  sessionTtlHours?: number
  logger?: boolean
  development?: boolean
  trustProxy?: boolean
  allowedOrigins?: string[]
  emailService?: EmailService
  auth?: {
    maxSessionsPerUser: number
    passwordResetTtlMinutes: number
    emailVerificationTtlHours: number
    publicBaseUrl: string
    betaMode: boolean
  }
  aiPolicy?: {
    dailyRequests: number
    dailyTokens: number
    concurrentRequests: number
    timeoutMs: number
  }
}

type AuthedRequest = FastifyRequest & { authenticatedUser?: UserRecord; authenticatedSession?: AuthSessionRecord; sessionToken?: string }
const uuid = { type: 'string', format: 'uuid' } as const
const text = (maxLength: number, minLength = 0) => ({ type: 'string', minLength, maxLength })
const optionalText = (maxLength: number) => ({ anyOf: [{ type: 'string', maxLength }, { type: 'null' }] })
const noExtra = { additionalProperties: false } as const

export async function buildApp(deps: Dependencies) {
  const app = Fastify({ logger: deps.logger ?? false, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 6 * 1024 * 1024, trustProxy: deps.trustProxy ?? false })
  await app.register(rateLimit, { global: false })
  const auth = new AuthService(deps.store, deps.emailService ?? new ConsoleEmailService(false), {
    sessionTtlHours: deps.sessionTtlHours ?? 720,
    maxSessionsPerUser: deps.auth?.maxSessionsPerUser ?? 10,
    passwordResetTtlMinutes: deps.auth?.passwordResetTtlMinutes ?? 30,
    emailVerificationTtlHours: deps.auth?.emailVerificationTtlHours ?? 24,
    publicBaseUrl: deps.auth?.publicBaseUrl ?? 'http://localhost:3001',
    betaMode: deps.auth?.betaMode ?? false,
    development: deps.development ?? false,
  })
  const allowedOrigins = new Set(deps.allowedOrigins ?? [])
  const aiPolicy = deps.aiPolicy ?? { dailyRequests: 100, dailyTokens: 250_000, concurrentRequests: 2, timeoutMs: 120_000 }
  const aiConcurrency = new UserConcurrencyLimiter(aiPolicy.concurrentRequests)

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (!origin || !request.url.startsWith('/api/')) return
    if (!allowedOrigins.has(origin)) return reply.code(403).send({ error: 'Origin not allowed.', code: 'ORIGIN_NOT_ALLOWED' })
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin')
    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        .header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      return reply.code(204).send()
    }
  })

  app.addHook('onResponse', async (request, reply) => {
    if (!deps.logger) return
    const authenticated = request as AuthedRequest
    request.log.info({
      event: 'request_complete',
      requestId: request.id,
      route: request.routeOptions.url,
      status: reply.statusCode,
      userId: authenticated.authenticatedUser?.id,
      elapsedMs: Math.round(reply.elapsedTime),
    })
  })

  app.setErrorHandler((error, _request, reply) => {
    const status = Number((error as { statusCode?: number }).statusCode) || 500
    const safeStatus = status >= 400 && status < 500 ? status : 500
    const message = error instanceof Error ? error.message : 'Invalid request.'
    const errorCode = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined
    if (safeStatus >= 500 && deps.logger) {
      _request.log.error({
        event: 'request_failed',
        requestId: _request.id,
        method: _request.method,
        route: _request.routeOptions.url,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode,
      })
    }
    if (safeStatus >= 500 && deps.development) {
      const diagnostic = error as Error & { code?: string }
      console.error('[API] request failed', {
        requestId: _request.id,
        method: _request.method,
        route: _request.routeOptions.url,
        errorName: diagnostic.name,
        errorCode: diagnostic.code,
        message: sanitizeDiagnostic(message),
      })
    }
    reply.code(safeStatus).send({ error: safeStatus === 500 ? 'The request could not be completed.' : message, ...(safeStatus < 500 && errorCode ? { code: errorCode } : {}) })
  })

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request.headers.authorization)
    const authenticated = await auth.authenticate(token)
    if (!authenticated) return reply.code(401).send({ error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' })
    ;(request as AuthedRequest).authenticatedUser = authenticated.user
    ;(request as AuthedRequest).authenticatedSession = authenticated.session
    ;(request as AuthedRequest).sessionToken = token
  }
  const userOf = (request: FastifyRequest) => (request as AuthedRequest).authenticatedUser!

  app.get('/health', async () => ({ ok: true }))
  app.get('/health/live', async () => ({ status: 'live' }))
  app.get('/health/ready', async (_request, reply) => {
    try {
      await deps.store.checkHealth()
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ status: 'not_ready' })
    }
  })

  app.post('/api/v1/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', ...noExtra, required: ['email', 'password', 'displayName'], properties: { email: { type: 'string', format: 'email', maxLength: 254 }, password: text(128, 8), displayName: text(100, 1), inviteCode: text(256) } } },
  }, async (request, reply) => {
    const body = request.body as { email: string; password: string; displayName: string; inviteCode?: string }
    return reply.code(201).send(await auth.register(body.email, body.password, body.displayName, body.inviteCode, deviceLabel(request)))
  })
  app.post('/api/v1/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', ...noExtra, required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', maxLength: 254 }, password: text(128, 1) } } },
  }, async (request) => {
    const body = request.body as { email: string; password: string }
    return auth.login(body.email, body.password, deviceLabel(request))
  })
  app.post('/api/v1/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    await auth.logout((request as AuthedRequest).sessionToken ?? '')
    return reply.code(204).send()
  })
  app.get('/api/v1/auth/me', { preHandler: authenticate }, async (request) => ({ user: publicUser(userOf(request)) }))
  app.put('/api/v1/auth/me', {
    preHandler: authenticate,
    schema: { body: { type: 'object', ...noExtra, required: ['displayName'], properties: { displayName: text(100, 1) } } },
  }, async (request, reply) => {
    const user = await deps.store.updateUser(userOf(request).id, (request.body as { displayName: string }).displayName.trim())
    return user ? { user: publicUser(user) } : reply.code(404).send({ error: 'User not found.' })
  })
  app.delete('/api/v1/auth/me', {
    preHandler: authenticate,
    schema: { body: { type: 'object', ...noExtra, required: ['password', 'confirmation'], properties: { password: text(128, 1), confirmation: { type: 'string', const: 'DELETE' } } } },
  }, async (request, reply) => {
    const body = request.body as { password: string; confirmation: string }
    await auth.deleteAccount(userOf(request), body.password, body.confirmation)
    return reply.code(204).send()
  })
  app.get('/api/v1/auth/sessions', { preHandler: authenticate }, async (request) => ({
    sessions: await auth.listSessions(userOf(request).id, sessionOf(request).id),
  }))
  app.post('/api/v1/auth/sessions/logout-others', { preHandler: authenticate }, async (request) => ({
    revoked: await auth.signOutOtherSessions(userOf(request).id, sessionOf(request).id),
  }))
  app.post('/api/v1/auth/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: { body: { type: 'object', ...noExtra, required: ['email'], properties: { email: { type: 'string', format: 'email', maxLength: 254 } } } },
  }, async (request) => auth.requestPasswordReset((request.body as { email: string }).email))
  app.post('/api/v1/auth/reset-password', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: { body: { type: 'object', ...noExtra, required: ['token', 'password'], properties: { token: text(256, 32), password: text(128, 8) } } },
  }, async (request, reply) => {
    const body = request.body as { token: string; password: string }
    await auth.resetPassword(body.token, body.password)
    return reply.code(204).send()
  })
  app.post('/api/v1/auth/verify-email', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: { body: { type: 'object', ...noExtra, required: ['token'], properties: { token: text(256, 32) } } },
  }, async (request) => ({ user: publicUser((await auth.verifyEmail((request.body as { token: string }).token))!) }))
  app.get('/verify-email', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: { querystring: { type: 'object', ...noExtra, required: ['token'], properties: { token: text(256, 32) } } },
  }, async (request, reply) => {
    await auth.verifyEmail((request.query as { token: string }).token)
    return reply.type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>Email verified</title><p>Your email is verified. You can return to Floating Assistant.</p>')
  })
  app.get('/reset-password', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: { querystring: { type: 'object', ...noExtra, required: ['token'], properties: { token: text(256, 32) } } },
  }, async (request, reply) => {
    const token = escapeHtml((request.query as { token: string }).token)
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><title>Reset password</title><h1>Reset your password</h1><p>In Floating Assistant, choose <strong>Forgot password?</strong> and paste this one-time token:</p><p><code>${token}</code></p><p>This token expires and can be used only once.</p>`)
  })
  app.post('/api/v1/auth/resend-verification', {
    preHandler: authenticate,
    config: { rateLimit: { max: 3, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    await auth.resendVerification(userOf(request))
    return reply.code(204).send()
  })

  app.get('/api/v1/profiles', { preHandler: authenticate }, async (request) => ({ profiles: await deps.store.listProfiles(userOf(request).id) }))
  app.post('/api/v1/profiles', {
    preHandler: authenticate,
    schema: { body: profileBody(true) },
  }, async (request, reply) => reply.code(201).send({ profile: await deps.store.createProfile(userOf(request).id, request.body as never) }))
  app.get('/api/v1/profiles/:id', { preHandler: authenticate, schema: { params: idParams() } }, async (request, reply) => {
    const profile = await deps.store.getProfile(userOf(request).id, (request.params as { id: string }).id)
    return profile ? { profile } : reply.code(404).send({ error: 'Profile not found.' })
  })
  app.put('/api/v1/profiles/:id', {
    preHandler: authenticate,
    schema: { params: idParams(), body: profileBody(false) },
  }, async (request, reply) => {
    const profile = await deps.store.updateProfile(userOf(request).id, (request.params as { id: string }).id, request.body as never)
    return profile ? { profile } : reply.code(404).send({ error: 'Profile not found.' })
  })
  app.delete('/api/v1/profiles/:id', { preHandler: authenticate, schema: { params: idParams() } }, async (request, reply) => {
    const deleted = await deps.store.deleteProfile(userOf(request).id, (request.params as { id: string }).id)
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'Profile not found.' })
  })

  app.get('/api/v1/interviews', { preHandler: authenticate }, async (request) => ({ interviews: await deps.store.listInterviews(userOf(request).id) }))
  app.post('/api/v1/interviews', {
    preHandler: authenticate,
    schema: { body: interviewBody(true) },
  }, async (request, reply) => {
    const body = request.body as InterviewInput
    if (body.profileId && !await deps.store.getProfile(userOf(request).id, body.profileId)) return reply.code(400).send({ error: 'Profile not found.' })
    const interview = await deps.store.createInterview(userOf(request).id, normalizeInterview(body))
    return reply.code(201).send({ interview })
  })
  app.get('/api/v1/interviews/:id', { preHandler: authenticate, schema: { params: idParams() } }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const interview = await deps.store.getInterview(userOf(request).id, id)
    if (!interview) return reply.code(404).send({ error: 'Interview not found.' })
    const turns = await deps.store.listTurns(userOf(request).id, id)
    return { interview, turns }
  })
  app.put('/api/v1/interviews/:id', {
    preHandler: authenticate,
    schema: { params: idParams(), body: interviewBody(false) },
  }, async (request, reply) => {
    const interview = await deps.store.updateInterview(userOf(request).id, (request.params as { id: string }).id, normalizeInterview(request.body as InterviewInput))
    return interview ? { interview } : reply.code(404).send({ error: 'Interview not found.' })
  })
  app.post('/api/v1/interviews/:id/complete', { preHandler: authenticate, schema: { params: idParams() } }, async (request, reply) => {
    const interview = await deps.store.completeInterview(userOf(request).id, (request.params as { id: string }).id)
    return interview ? { interview } : reply.code(404).send({ error: 'Interview not found.' })
  })
  app.delete('/api/v1/interviews/:id', { preHandler: authenticate, schema: { params: idParams() } }, async (request, reply) => {
    const deleted = await deps.store.deleteInterview(userOf(request).id, (request.params as { id: string }).id)
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'Interview not found.' })
  })
  app.get('/api/v1/interviews/:id/turns', { preHandler: authenticate, schema: { params: idParams() } }, async (request, reply) => {
    const turns = await deps.store.listTurns(userOf(request).id, (request.params as { id: string }).id)
    return turns ? { turns } : reply.code(404).send({ error: 'Interview not found.' })
  })
  app.post('/api/v1/interviews/:id/turns', {
    preHandler: authenticate,
    schema: { params: idParams(), body: { type: 'object', ...noExtra, required: ['requestId', 'sequence', 'question', 'answer'], properties: { requestId: text(128, 1), sequence: { type: 'integer', minimum: 1, maximum: 100000 }, question: text(32000, 1), answer: text(128000, 1) } } },
  }, async (request, reply) => {
    const turn = await deps.store.createTurn(userOf(request).id, (request.params as { id: string }).id, request.body as never)
    return turn ? reply.code(201).send({ turn }) : reply.code(404).send({ error: 'Interview not found.' })
  })
  app.get('/api/v1/usage', { preHandler: authenticate }, async (request) => ({ usage: await deps.store.listUsage(userOf(request).id) }))
  app.get('/api/v1/export', { preHandler: authenticate }, async (request) => ({
    exportedAt: new Date().toISOString(),
    user: publicUser(userOf(request)),
    ...(await deps.store.exportUserData(userOf(request).id)),
  }))

  app.post('/api/v1/ai/responses', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { body: aiBody() },
  }, async (request, reply) => {
    const body = request.body as AiRequest & { sessionId: string }
    if (!await deps.store.getInterview(userOf(request).id, body.sessionId)) return reply.code(404).send({ error: 'Interview not found.' })
    const userId = userOf(request).id
    if (!userOf(request).emailVerifiedAt) return reply.code(403).send({ error: 'Verify your email before using AI features.', code: 'EMAIL_VERIFICATION_REQUIRED' })
    const daily = await deps.store.getUsageSince(userId, startOfUtcDay())
    if (daily.requests >= aiPolicy.dailyRequests || daily.inputTokens + daily.outputTokens >= aiPolicy.dailyTokens) {
      return reply.code(429).send({ error: 'Daily usage limit reached.', code: 'DAILY_USAGE_LIMIT_REACHED' })
    }
    const release = aiConcurrency.acquire(userId)
    if (!release) return reply.code(429).send({ error: 'Too many AI requests are already running.', code: 'AI_CONCURRENCY_LIMIT' })
    const model = body.route === 'CODING' ? 'coding' : 'fast'
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(new Error('AI request timed out.')), aiPolicy.timeoutMs)
    request.raw.on('aborted', () => abort.abort())
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) abort.abort()
    })
    const output = async function* () {
      let usage: ProviderUsage = {}
      try {
        for await (const event of deps.aiProvider.stream(body, abort.signal)) {
          if (event.usage) usage = event.usage
          if (event.delta) yield `data: ${JSON.stringify({ type: 'delta', delta: event.delta })}\n\n`
        }
        await deps.store.createUsage({ userId, sessionId: body.sessionId, type: 'answer', model, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null })
        request.log.info({ event: 'ai_complete', requestId: request.id, userId, sessionId: body.sessionId, route: body.route, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        yield `data: ${JSON.stringify({ type: 'complete' })}\n\n`
      } finally {
        clearTimeout(timeout)
        release()
      }
    }
    return reply.type('text/event-stream; charset=utf-8').header('Cache-Control', 'no-cache').send(Readable.from(output()))
  })

  app.post('/api/v1/ai/realtime-secret', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', ...noExtra, required: ['sessionId'], properties: { sessionId: uuid } } },
  }, async (request, reply) => {
    const sessionId = (request.body as { sessionId: string }).sessionId
    if (!await deps.store.getInterview(userOf(request).id, sessionId)) return reply.code(404).send({ error: 'Interview not found.' })
    if (!userOf(request).emailVerifiedAt) return reply.code(403).send({ error: 'Verify your email before using AI features.', code: 'EMAIL_VERIFICATION_REQUIRED' })
    return { clientSecret: await deps.aiProvider.createRealtimeSecret() }
  })

  app.post('/api/v1/ai/summary', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', ...noExtra, required: ['sessionId', 'kind', 'previous', 'content'], properties: { sessionId: uuid, kind: { type: 'string', enum: ['session', 'workspace'] }, previous: text(32000), content: text(128000, 1) } } },
  }, async (request, reply) => {
    const body = request.body as { sessionId: string; kind: 'session' | 'workspace'; previous: string; content: string }
    if (!await deps.store.getInterview(userOf(request).id, body.sessionId)) return reply.code(404).send({ error: 'Interview not found.' })
    if (!userOf(request).emailVerifiedAt) return reply.code(403).send({ error: 'Verify your email before using AI features.', code: 'EMAIL_VERIFICATION_REQUIRED' })
    const instruction = body.kind === 'session'
      ? 'Create a compact factual rolling meeting summary in English. Preserve current topics, named technologies, decisions, constraints, unresolved questions, and referents needed for follow-ups. Remove greetings, filler, repetition, and noise. Prefer newer information when topics change.'
      : 'Compact this coding workspace history. Preserve the active problem, requirements, language, approaches, solution changes, user preferences, unresolved errors, and referents needed for follow-ups. Do not include filler.'
    return { summary: await deps.aiProvider.summarize(`${instruction}\n\nPREVIOUS SUMMARY:\n${body.previous || '(none)'}\n\nCONTENT:\n${body.content}`) }
  })

  return app
}

function sanitizeDiagnostic(value: string) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED_PROVIDER_KEY]')
    .slice(0, 1000)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

class UserConcurrencyLimiter {
  private readonly active = new Map<string, number>()
  constructor(private readonly limit: number) {}

  acquire(userId: string): (() => void) | null {
    const current = this.active.get(userId) ?? 0
    if (current >= this.limit) return null
    this.active.set(userId, current + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const next = (this.active.get(userId) ?? 1) - 1
      if (next <= 0) this.active.delete(userId)
      else this.active.set(userId, next)
    }
  }
}

function startOfUtcDay() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function deviceLabel(request: FastifyRequest) {
  const platform = request.headers['sec-ch-ua-platform']
  if (typeof platform === 'string' && platform.trim()) return platform.replaceAll('"', '')
  const agent = request.headers['user-agent'] ?? ''
  if (/windows/i.test(agent)) return 'Windows'
  if (/mac/i.test(agent)) return 'macOS'
  if (/linux/i.test(agent)) return 'Linux'
  return 'Desktop'
}

interface InterviewInput {
  profileId?: string | null
  name?: string
  company?: string | null
  role?: string | null
  resumeText?: string
  jobDescriptionText?: string
  instructions?: string
  status?: 'active' | 'completed'
}

function sessionOf(request: FastifyRequest) {
  return (request as AuthedRequest).authenticatedSession!
}

function normalizeInterview(input: InterviewInput) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as never
}

function idParams() {
  return { type: 'object', ...noExtra, required: ['id'], properties: { id: uuid } }
}

function profileBody(required: boolean) {
  return { type: 'object', ...noExtra, minProperties: 1, required: required ? ['name', 'resumeText', 'defaultInstructions'] : undefined, properties: { name: text(120, 1), resumeText: text(500000, 1), defaultInstructions: text(50000, 1) } }
}

function interviewBody(required: boolean) {
  return { type: 'object', ...noExtra, minProperties: 1, required: required ? ['name', 'resumeText', 'jobDescriptionText', 'instructions'] : undefined, properties: { profileId: { anyOf: [uuid, { type: 'null' }] }, name: text(160, 1), company: optionalText(160), role: optionalText(160), resumeText: text(500000, 1), jobDescriptionText: text(500000), instructions: text(50000, 1), status: { type: 'string', enum: ['active', 'completed'] } } }
}

function aiBody() {
  return { type: 'object', ...noExtra, required: ['sessionId', 'route', 'userText', 'instructions'], properties: { sessionId: uuid, route: { type: 'string', enum: ['CONVERSATION', 'TECHNICAL', 'CODING'] }, userText: text(128000, 1), instructions: text(100000, 1), imageInputs: { type: 'array', maxItems: 8, items: { type: 'object', ...noExtra, required: ['label', 'imageDataUrl'], properties: { label: text(500, 1), imageDataUrl: text(5000000, 1) } } } } }
}
