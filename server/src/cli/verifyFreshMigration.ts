import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: path.join(serverDirectory, '.env'), quiet: true })
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required in server/.env or the process environment.')

const databaseName = `floating_assistant_phase3a_${Date.now()}_${randomBytes(3).toString('hex')}`
const quotedDatabaseName = `"${databaseName}"`
const admin = new pg.Client({ connectionString: databaseUrl })
let created = false
await admin.connect()
try {
  await admin.query(`create database ${quotedDatabaseName}`)
  created = true
  const temporaryUrl = new URL(databaseUrl)
  temporaryUrl.pathname = `/${databaseName}`
  const pool = new pg.Pool({ connectionString: temporaryUrl.toString(), max: 2 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(serverDirectory, 'drizzle') })
    const result = await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' order by table_name")
    const expected = ['auth_sessions', 'auth_tokens', 'beta_invites', 'candidate_profiles', 'interview_sessions', 'interview_turns', 'usage_events', 'users']
    const tables = result.rows.map((row) => row.table_name)
    const missing = expected.filter((name) => !tables.includes(name))
    if (missing.length > 0) throw new Error(`Fresh migration is missing tables: ${missing.join(', ')}`)
    console.info(`Fresh PostgreSQL migration passed (${expected.length} application tables).`)
  } finally {
    await pool.end()
  }
} finally {
  if (created) {
    await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [databaseName])
    await admin.query(`drop database ${quotedDatabaseName}`)
  }
  await admin.end()
}
