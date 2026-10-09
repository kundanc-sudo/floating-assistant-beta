import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotEnv } from 'dotenv'
import { WebSocketServer } from 'ws'
import { OpenAiProvider } from './ai/provider.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createPostgresStore } from './db/postgresStore.js'
import { ConsoleEmailService, ResendEmailService, WebhookEmailService } from './email/emailService.js'
import { createGracefulShutdown } from './gracefulShutdown.js'
import { RateLimiter } from './share/rateLimiter.js'
import { ShareSessionManager, type PublishedEvent } from './share/shareSessionManager.js'
import { viewerPage } from './viewerPage.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
loadDotEnv({ path: path.resolve(currentDirectory, '../.env'), quiet: true })
const config = loadConfig()
const database = createPostgresStore(config.databaseUrl, {
  sslMode: config.databaseSslMode,
  max: config.databasePoolMax,
  connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
  idleTimeoutMillis: config.databaseIdleTimeoutMs,
})
if (process.env.NODE_ENV !== 'test') await database.verifySchema()
const aiProvider = new OpenAiProvider(config.providerKey, {
  fast: config.fastModel,
  coding: config.codingModel,
  summary: config.summaryModel,
}, config.aiTimeoutMs)
const emailService = config.emailProvider === 'resend'
  ? new ResendEmailService(config.emailProviderKey, config.emailFrom)
  : config.emailProvider === 'webhook'
    ? new WebhookEmailService(config.emailProviderUrl, config.emailProviderKey, config.emailFrom)
    : new ConsoleEmailService(!config.production)
const app = await buildApp({
  store: database.store,
  aiProvider,
  sessionTtlHours: config.sessionTtlHours,
  logger: config.production,
  development: !config.production,
  trustProxy: config.trustProxy,
  allowedOrigins: config.allowedOrigins,
  emailService,
  auth: {
    maxSessionsPerUser: config.maxSessionsPerUser,
    passwordResetTtlMinutes: config.passwordResetTtlMinutes,
    emailVerificationTtlHours: config.emailVerificationTtlHours,
    publicBaseUrl: config.publicBaseUrl,
    betaMode: config.betaMode,
  },
  aiPolicy: {
    dailyRequests: config.betaDailyAiRequests,
    dailyTokens: config.betaDailyTokens,
    concurrentRequests: config.betaConcurrentAiRequests,
    timeoutMs: config.aiTimeoutMs,
  },
})

const ttlMinutes = positiveInteger(process.env.SHARE_SESSION_TTL_MINUTES, 60)
const viewerBaseUrl = (process.env.VIEWER_BASE_URL ?? config.publicBaseUrl).replace(/\/$/, '')
const allowedOrigins = new Set((process.env.SHARE_ALLOWED_ORIGINS ?? `${config.publicBaseUrl},http://localhost:5173`).split(',').map((value) => value.trim()).filter(Boolean))
const shares = new ShareSessionManager(ttlMinutes * 60_000)
const joinLimiter = new RateLimiter(12, 60_000)
const createLimiter = new RateLimiter(20, 60_000)

app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(viewerPage))
app.get('/view', async (_request, reply) => reply.type('text/html; charset=utf-8').send(viewerPage))
app.post('/api/share/session', async (request, reply) => {
  if (!originAllowed(request.headers.origin)) return reply.code(403).send({ error: 'Origin not allowed.' })
  if (!createLimiter.allow(request.ip)) return reply.code(429).send({ error: 'Too many requests.' })
  const created = shares.create()
  return reply.code(201).send({ ...created, viewerUrl: `${viewerBaseUrl}/view` })
})
app.post('/api/share/session/:id/publish', async (request, reply) => {
  if (!originAllowed(request.headers.origin)) return reply.code(403).send({ error: 'Origin not allowed.' })
  const secret = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? ''
  const event = validatePublishedEvent(request.body)
  if (!secret) return reply.code(401).send({ error: 'Host authorization required.' })
  if (!event) return reply.code(400).send({ error: 'Invalid response event.' })
  return shares.publish((request.params as { id: string }).id, secret, event)
    ? reply.code(202).send({ accepted: true })
    : reply.code(404).send({ error: 'Session not found.' })
})
app.post('/api/share/session/:id/stop', async (request, reply) => {
  const secret = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? ''
  if (!secret) return reply.code(401).send({ error: 'Host authorization required.' })
  return shares.stop((request.params as { id: string }).id, secret)
    ? { stopped: true }
    : reply.code(404).send({ error: 'Session not found.' })
})

const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 })
app.server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const ip = request.socket.remoteAddress ?? 'unknown'
  if (url.pathname !== '/ws' || !joinLimiter.allow(ip)) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n')
    return socket.destroy()
  }
  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    const snapshot = shares.join(url.searchParams.get('token') ?? '', webSocket)
    if (!snapshot) return webSocket.close(4003, 'Invalid or expired token.')
    webSocket.send(JSON.stringify(snapshot))
  })
})

const cleanup = setInterval(() => {
  shares.removeExpired()
  joinLimiter.cleanup()
  createLimiter.cleanup()
}, 60_000)
cleanup.unref()

const shutdown = createGracefulShutdown({
  deadlineMs: 10_000,
  stopBackgroundWork: () => clearInterval(cleanup),
  closeSockets: () => sockets.close(),
  closeServer: () => app.close(),
  closeDatabase: () => database.close(),
  log: (message) => console.info(message),
  onDeadline: () => {
    console.error('[SERVER] graceful shutdown deadline exceeded')
    process.exit(1)
  },
})
process.once('SIGINT', () => void shutdown('SIGINT').catch(() => { process.exitCode = 1 }))
process.once('SIGTERM', () => void shutdown('SIGTERM').catch(() => { process.exitCode = 1 }))

await app.listen({ port: config.port, host: '0.0.0.0' })
console.info(`[SERVER] listening on 0.0.0.0:${config.port}`)
console.info(`[SERVER] environment=${config.production ? 'production' : 'development'} publicHost=${new URL(config.publicBaseUrl).host}`)

function originAllowed(origin: string | undefined) {
  return !origin || allowedOrigins.has(origin)
}

function validatePublishedEvent(value: unknown): PublishedEvent | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.requestId !== 'string' || candidate.requestId.length > 128) return null
  if (candidate.type === 'response_start' || candidate.type === 'response_complete') return { type: candidate.type, requestId: candidate.requestId }
  if (candidate.type === 'response_delta' && typeof candidate.delta === 'string' && candidate.delta.length <= 64_000) return { type: candidate.type, requestId: candidate.requestId, delta: candidate.delta }
  return null
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}
