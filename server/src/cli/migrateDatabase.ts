import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { databaseConnectionString } from '../db/databaseConnection.js'

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: path.join(serverDirectory, '.env'), quiet: true })
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required in the process environment or server/.env.')
const databaseSslMode = process.env.DATABASE_SSL_MODE?.trim().toLowerCase() || 'url'
if (databaseSslMode !== 'url' && databaseSslMode !== 'require') {
  throw new Error('DATABASE_SSL_MODE must be url or require.')
}

const pool = new pg.Pool({
  connectionString: databaseConnectionString(databaseUrl, databaseSslMode),
  max: 2,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
})
try {
  await migrate(drizzle(pool), { migrationsFolder: path.join(serverDirectory, 'drizzle') })
  console.info('Reviewed Drizzle migrations applied successfully.')
} finally {
  await pool.end()
}
