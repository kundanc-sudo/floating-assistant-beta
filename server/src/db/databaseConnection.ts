export function databaseConnectionString(databaseUrl: string, sslMode: 'url' | 'require') {
  if (sslMode === 'url') return databaseUrl
  const url = new URL(databaseUrl)
  url.searchParams.set('sslmode', 'require')
  return url.toString()
}
