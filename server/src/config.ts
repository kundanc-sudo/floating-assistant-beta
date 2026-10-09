import { parseDatabaseSslMode, type DatabaseSslMode } from './db/databaseConnection.js'

export interface ServerConfig {
  port: number
  databaseUrl: string
  databaseSslMode: DatabaseSslMode
  providerKey: string
  fastModel: string
  codingModel: string
  summaryModel: string
  sessionTtlHours: number
  maxSessionsPerUser: number
  passwordResetTtlMinutes: number
  emailVerificationTtlHours: number
  publicBaseUrl: string
  trustProxy: boolean
  allowedOrigins: string[]
  emailProvider: 'console' | 'webhook' | 'resend'
  emailProviderUrl: string
  emailProviderKey: string
  emailFrom: string
  betaMode: boolean
  betaDailyAiRequests: number
  betaDailyTokens: number
  betaConcurrentAiRequests: number
  aiTimeoutMs: number
  databasePoolMax: number
  databaseConnectionTimeoutMs: number
  databaseIdleTimeoutMs: number
  production: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production'
  const databaseUrl = env.DATABASE_URL?.trim() ?? ''
  const databaseSslMode = parseDatabaseSslMode(env.DATABASE_SSL_MODE)
  const providerKey = env.AI_PROVIDER_KEY?.trim() ?? ''
  const renderHostname = env.RENDER_EXTERNAL_HOSTNAME?.trim()
  const publicBaseUrl = env.PUBLIC_BASE_URL?.trim()
    || (renderHostname ? `https://${renderHostname}` : `http://localhost:${positiveInteger(env.PORT, 3001)}`)
  const emailProvider = (env.EMAIL_PROVIDER?.trim() || 'console') as 'console' | 'webhook' | 'resend'
  if (!databaseUrl) throw new Error('DATABASE_URL is required.')
  validateDatabaseUrl(databaseUrl)
  if (production && !providerKey) throw new Error('AI_PROVIDER_KEY is required in production.')
  if (production && databaseSslMode === 'render-internal' && !renderHostname) {
    throw new Error('DATABASE_SSL_MODE=render-internal is only allowed when RENDER_EXTERNAL_HOSTNAME is present.')
  }
  if (production && databaseSslMode !== 'render-internal' && databaseSslMode !== 'require' && databaseSslMode !== 'verify-full' && !databaseRequiresTls(databaseUrl)) {
    throw new Error('Production database connections must require TLS (verify-full preferred) or explicitly use the Render internal private network.')
  }
  if (!['console', 'webhook', 'resend'].includes(emailProvider)) throw new Error('EMAIL_PROVIDER must be console, webhook, or resend.')
  if (production) {
    if (!publicBaseUrl.startsWith('https://')) throw new Error('Production PUBLIC_BASE_URL must use HTTPS.')
    if (/^https:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(publicBaseUrl)) throw new Error('Production PUBLIC_BASE_URL cannot use localhost.')
    if (emailProvider === 'console') throw new Error('Production EMAIL_PROVIDER must be webhook or resend.')
    if (emailProvider === 'webhook' && !env.EMAIL_PROVIDER_URL?.startsWith('https://')) throw new Error('Production webhook EMAIL_PROVIDER_URL must use HTTPS.')
    if (!env.EMAIL_PROVIDER_KEY?.trim()) throw new Error('EMAIL_PROVIDER_KEY is required in production.')
    if (!env.EMAIL_FROM?.trim()) throw new Error('EMAIL_FROM is required in production.')
    if (parseBoolean(env.TRUST_PROXY, false) !== true) throw new Error('Production TRUST_PROXY must be true behind the HTTPS proxy.')
    if ((env.ALLOWED_ORIGINS ?? '').split(',').some((origin) => origin.trim() === '*')) throw new Error('Production ALLOWED_ORIGINS cannot contain * .')
  }
  return {
    port: positiveInteger(env.PORT, 3001),
    databaseUrl,
    databaseSslMode,
    providerKey,
    fastModel: env.AI_FAST_MODEL?.trim() || 'gpt-5.6-luna',
    codingModel: env.AI_CODING_MODEL?.trim() || 'gpt-5.6-sol',
    summaryModel: env.AI_SUMMARY_MODEL?.trim() || 'gpt-4o-mini',
    sessionTtlHours: positiveInteger(env.AUTH_SESSION_TTL_HOURS, 720),
    maxSessionsPerUser: positiveInteger(env.AUTH_MAX_SESSIONS_PER_USER, 10),
    passwordResetTtlMinutes: positiveInteger(env.PASSWORD_RESET_TTL_MINUTES, 30),
    emailVerificationTtlHours: positiveInteger(env.EMAIL_VERIFICATION_TTL_HOURS, 24),
    publicBaseUrl,
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    emailProvider,
    emailProviderUrl: env.EMAIL_PROVIDER_URL?.trim() ?? '',
    emailProviderKey: env.EMAIL_PROVIDER_KEY?.trim() ?? '',
    emailFrom: env.EMAIL_FROM?.trim() || 'no-reply@localhost',
    betaMode: parseBoolean(env.BETA_MODE, false),
    betaDailyAiRequests: positiveInteger(env.BETA_DAILY_AI_REQUESTS, 100),
    betaDailyTokens: positiveInteger(env.BETA_DAILY_TOKENS, 250_000),
    betaConcurrentAiRequests: positiveInteger(env.BETA_CONCURRENT_AI_REQUESTS, 2),
    aiTimeoutMs: positiveInteger(env.AI_TIMEOUT_MS, 120_000),
    databasePoolMax: positiveInteger(env.DATABASE_POOL_MAX, 10),
    databaseConnectionTimeoutMs: positiveInteger(env.DATABASE_CONNECTION_TIMEOUT_MS, 5_000),
    databaseIdleTimeoutMs: positiveInteger(env.DATABASE_IDLE_TIMEOUT_MS, 30_000),
    production,
  }
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback
  if (/^(?:true|1|yes)$/i.test(value)) return true
  if (/^(?:false|0|no)$/i.test(value)) return false
  throw new Error(`Invalid boolean configuration value: ${value}`)
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`Expected a positive integer configuration value, received: ${value}`)
  }
  return parsed
}

function databaseRequiresTls(value: string) {
  const sslMode = new URL(value).searchParams.get('sslmode')?.toLowerCase()
  return sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full'
}

function validateDatabaseUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error()
    if (!url.hostname || !url.pathname.slice(1)) throw new Error()
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.')
  }
}
