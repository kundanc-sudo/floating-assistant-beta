import assert from 'node:assert/strict'
import test from 'node:test'
import { loadConfig } from '../src/config.js'

const secureProduction = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example.com/app?sslmode=require',
  AI_PROVIDER_KEY: 'test-provider-key',
  PUBLIC_BASE_URL: 'https://api.example.com',
  WEB_APP_URL: 'https://app.example.com',
  TRUST_PROXY: 'true',
  ALLOWED_ORIGINS: 'https://app.example.com',
  EMAIL_PROVIDER: 'webhook',
  EMAIL_PROVIDER_URL: 'https://mail.example.com/send',
  EMAIL_PROVIDER_KEY: 'test-email-key',
  EMAIL_FROM: 'no-reply@example.com',
} satisfies NodeJS.ProcessEnv

test('production configuration accepts an explicit secure deployment', () => {
  const config = loadConfig(secureProduction)
  assert.equal(config.production, true)
  assert.equal(config.trustProxy, true)
  assert.equal(config.webAppBaseUrl, 'https://app.example.com')
})

test('production configuration accepts Resend without a generic webhook URL', () => {
  const config = loadConfig({
    ...secureProduction,
    EMAIL_PROVIDER: 'resend',
    EMAIL_PROVIDER_URL: '',
  })
  assert.equal(config.emailProvider, 'resend')
  assert.equal(config.emailProviderUrl, '')
})

test('production configuration accepts an injected database URL with explicit required TLS', () => {
  const config = loadConfig({
    ...secureProduction,
    DATABASE_URL: 'postgresql://user:password@internal-db/app',
    DATABASE_SSL_MODE: 'require',
  })
  assert.equal(config.databaseSslMode, 'require')
})

test('production accepts the Render internal private database mode on Render', () => {
  const config = loadConfig({
    ...secureProduction,
    DATABASE_URL: 'postgresql://user:password@dpg-private/app',
    DATABASE_SSL_MODE: 'render-internal',
    RENDER_EXTERNAL_HOSTNAME: 'floating-assistant-api-test.onrender.com',
  })
  assert.equal(config.databaseSslMode, 'render-internal')
})

test('production rejects Render internal mode outside Render', () => {
  assert.throws(() => loadConfig({
    ...secureProduction,
    DATABASE_URL: 'postgresql://user:password@dpg-private/app',
    DATABASE_SSL_MODE: 'render-internal',
    RENDER_EXTERNAL_HOSTNAME: '',
  }))
})

test('production uses the Render-provided HTTPS hostname when PUBLIC_BASE_URL is absent', () => {
  const config = loadConfig({
    ...secureProduction,
    PUBLIC_BASE_URL: '',
    RENDER_EXTERNAL_HOSTNAME: 'floating-assistant-api-test.onrender.com',
  })
  assert.equal(config.publicBaseUrl, 'https://floating-assistant-api-test.onrender.com')
})

test('production rejects an insecure website URL used in account emails', () => {
  assert.throws(() => loadConfig({ ...secureProduction, WEB_APP_URL: 'http://app.example.com' }))
})

for (const [name, override] of [
  ['database TLS', { DATABASE_URL: 'postgresql://user:password@db.example.com/app' }],
  ['provider key', { AI_PROVIDER_KEY: '' }],
  ['HTTPS public URL', { PUBLIC_BASE_URL: 'http://api.example.com' }],
  ['trusted proxy', { TRUST_PROXY: 'false' }],
  ['production email provider', { EMAIL_PROVIDER: 'console' }],
  ['email provider key', { EMAIL_PROVIDER_KEY: '' }],
  ['email sender', { EMAIL_FROM: '' }],
  ['restricted origins', { ALLOWED_ORIGINS: '*' }],
] as const) {
  test(`production configuration rejects missing ${name}`, () => {
    assert.throws(() => loadConfig({ ...secureProduction, ...override }))
  })
}

test('development keeps localhost HTTP available but still requires a database URL', () => {
  const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost/dev' })
  assert.equal(config.publicBaseUrl, 'http://localhost:3001')
  assert.ok(config.allowedOrigins.includes('http://localhost:5174'))
  assert.equal(config.documentMaxFileBytes, 5 * 1024 * 1024)
  assert.equal(config.documentMaxExtractedChars, 500_000)
  assert.throws(() => loadConfig({ NODE_ENV: 'development' }))
})

test('document extraction limits are configurable positive integers', () => {
  const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost/dev', DOCUMENT_MAX_FILE_BYTES: '2048', DOCUMENT_MAX_EXTRACTED_CHARS: '1024', DOCUMENT_MAX_PDF_PAGES: '12', DOCUMENT_PROCESSING_TIMEOUT_MS: '3000' })
  assert.equal(config.documentMaxFileBytes, 2048)
  assert.equal(config.documentMaxExtractedChars, 1024)
  assert.equal(config.documentMaxPdfPages, 12)
  assert.equal(config.documentProcessingTimeoutMs, 3000)
  assert.throws(() => loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost/dev', DOCUMENT_MAX_FILE_BYTES: '0' }))
})

test('configuration rejects an unknown database TLS mode', () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://localhost/dev',
    DATABASE_SSL_MODE: 'prefer',
  }))
})
