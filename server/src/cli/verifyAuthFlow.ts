import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { buildApp } from '../app.js'
import type { AiProvider } from '../ai/provider.js'
import { createPostgresStore } from '../db/postgresStore.js'
import { parseDatabaseSslMode } from '../db/databaseConnection.js'
import { TestEmailService } from '../email/emailService.js'

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: path.join(serverDirectory, '.env'), quiet: true })
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required in server/.env or the process environment.')
const databaseSslMode = parseDatabaseSslMode(process.env.DATABASE_SSL_MODE)

const database = createPostgresStore(databaseUrl, { sslMode: databaseSslMode })
const email = new TestEmailService()
const provider: AiProvider = {
  async *stream() { yield { delta: 'unused' } },
  async createRealtimeSecret() { return { value: 'unused' } },
  async summarize() { return 'unused' },
}
const app = await buildApp({ store: database.store, aiProvider: provider, emailService: email })
const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`
const address = `phase3-smoke-${suffix}@example.invalid`
const password = `Smoke-${randomBytes(18).toString('base64url')}`
let userId = ''
try {
  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: address, password, displayName: 'Phase 3 smoke' } })
  if (registered.statusCode !== 201) throw new Error(`Registration smoke test failed with HTTP ${registered.statusCode}.`)
  userId = registered.json().user.id
  const verificationToken = new URL(email.verificationUrl).searchParams.get('token')
  if (!verificationToken) throw new Error('Verification email did not contain a token.')
  const verified = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token: verificationToken } })
  if (verified.statusCode !== 200) throw new Error(`Verification smoke test failed with HTTP ${verified.statusCode}.`)
  const loggedIn = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: address, password } })
  if (loggedIn.statusCode !== 200) throw new Error(`Login smoke test failed with HTTP ${loggedIn.statusCode}.`)
  const token = loggedIn.json().token
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } })
  if (me.statusCode !== 200 || me.json().user.emailVerified !== true) throw new Error('Authenticated identity smoke test failed.')
  console.info('PostgreSQL registration, verification, login, and auth/me smoke test passed.')
} finally {
  if (userId) await database.store.deleteUser(userId)
  await app.close()
  await database.close()
}
