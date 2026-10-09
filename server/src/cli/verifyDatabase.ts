import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import pg from 'pg'

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: path.join(serverDirectory, '.env'), quiet: true })
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required in server/.env or the process environment.')

const expectedTables = ['auth_sessions', 'auth_tokens', 'beta_invites', 'candidate_profiles', 'interview_sessions', 'interview_turns', 'usage_events', 'users']
const expectedColumns = ['auth_sessions.device_label', 'auth_sessions.last_used_at', 'users.email_verified_at']
const expectedIndexes = ['auth_sessions_user_last_used_idx', 'auth_tokens_hash_unique', 'beta_invites_code_hash_unique', 'usage_events_user_created_idx']
const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  const tables = await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_name = any($1::text[]) order by table_name", [expectedTables])
  const columns = await client.query<{ qualified: string }>("select table_name || '.' || column_name as qualified from information_schema.columns where table_schema='public' and table_name = any($1::text[]) order by qualified", [['users', 'auth_sessions']])
  const indexes = await client.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='public' and indexname = any($1::text[]) order by indexname", [expectedIndexes])
  const actualTables = tables.rows.map((row) => row.table_name)
  const actualColumns = columns.rows.map((row) => row.qualified).filter((name) => expectedColumns.includes(name))
  const actualIndexes = indexes.rows.map((row) => row.indexname)
  const missing = [
    ...expectedTables.filter((name) => !actualTables.includes(name)),
    ...expectedColumns.filter((name) => !actualColumns.includes(name)),
    ...expectedIndexes.filter((name) => !actualIndexes.includes(name)),
  ]
  if (missing.length > 0) throw new Error(`Database verification failed; missing: ${missing.join(', ')}`)
  console.info(JSON.stringify({ tables: actualTables, columns: actualColumns, indexes: actualIndexes }, null, 2))
} finally {
  await client.end()
}
