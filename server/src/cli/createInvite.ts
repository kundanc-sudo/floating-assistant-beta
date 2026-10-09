import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import pg from 'pg'
import { databaseConnectionString, parseDatabaseSslMode } from '../db/databaseConnection.js'

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: path.join(serverDirectory, '.env'), quiet: true })
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required in server/.env.')
const databaseSslMode = parseDatabaseSslMode(process.env.DATABASE_SSL_MODE)

const emailArgument = argument('email')?.trim().toLowerCase() || null
const hoursArgument = argument('hours')
const hours = Number.parseInt(hoursArgument ?? '168', 10)
if (!Number.isSafeInteger(hours) || hours < 1 || hours > 720) throw new Error('--hours must be between 1 and 720.')
if (emailArgument && !/^\S+@\S+\.\S+$/.test(emailArgument)) throw new Error('--email must be a valid email address.')

const code = randomBytes(24).toString('base64url')
const codeHash = createHash('sha256').update(code).digest('hex')
const expiresAt = new Date(Date.now() + hours * 60 * 60_000)
const client = new pg.Client({ connectionString: databaseConnectionString(databaseUrl, databaseSslMode) })
await client.connect()
try {
  await client.query(
    'insert into beta_invites (code_hash, email, expires_at) values ($1, $2, $3)',
    [codeHash, emailArgument, expiresAt],
  )
} finally {
  await client.end()
}
console.info(`Invite code (shown once): ${code}`)
console.info(`Email restriction: ${emailArgument ?? 'none'}`)
console.info(`Expires: ${expiresAt.toISOString()}`)

function argument(name: string) {
  const equals = process.argv.find((value) => value.startsWith(`--${name}=`))
  if (equals) return equals.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
