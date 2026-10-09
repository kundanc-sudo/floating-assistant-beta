export type DatabaseSslMode = 'url' | 'require' | 'verify-full' | 'render-internal'

export function parseDatabaseSslMode(value: string | undefined): DatabaseSslMode {
  const normalized = value?.trim().toLowerCase() || 'url'
  if (normalized === 'url' || normalized === 'require' || normalized === 'verify-full' || normalized === 'render-internal') return normalized
  throw new Error('DATABASE_SSL_MODE must be url, require, verify-full, or render-internal.')
}

export function databaseConnectionString(databaseUrl: string, sslMode: DatabaseSslMode) {
  if (sslMode === 'url') return databaseUrl
  const url = new URL(databaseUrl)
  if (sslMode === 'require' || sslMode === 'verify-full') {
    url.searchParams.set('sslmode', sslMode)
    return url.toString()
  }
  for (const parameter of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslnegotiation']) {
    if (url.searchParams.has(parameter)) {
      throw new Error(`DATABASE_SSL_MODE=render-internal cannot be combined with ${parameter}.`)
    }
  }
  url.searchParams.set('sslmode', 'disable')
  return url.toString()
}
