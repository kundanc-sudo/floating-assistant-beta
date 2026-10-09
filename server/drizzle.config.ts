import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { databaseConnectionString, parseDatabaseSslMode } from './src/db/databaseConnection.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const environmentPath = path.join(serverDirectory, '.env')
config({ path: environmentPath, quiet: true })

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  throw new Error(`DATABASE_URL is required in ${environmentPath} or the process environment.`)
}
const databaseSslMode = parseDatabaseSslMode(process.env.DATABASE_SSL_MODE)

export default defineConfig({
  schema: path.relative(process.cwd(), path.join(serverDirectory, 'src', 'db', 'schema.ts')).replaceAll('\\', '/'),
  out: path.relative(process.cwd(), path.join(serverDirectory, 'drizzle')).replaceAll('\\', '/'),
  dialect: 'postgresql',
  dbCredentials: { url: databaseConnectionString(databaseUrl, databaseSslMode) },
  strict: true,
})
