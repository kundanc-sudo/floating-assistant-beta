import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from 'pg-connection-string'
import { databaseConnectionString } from '../src/db/databaseConnection.js'

test('database connection leaves URL-managed TLS unchanged', () => {
  const value = 'postgresql://user:password@db.example.com/app?sslmode=verify-full'
  assert.equal(databaseConnectionString(value, 'url'), value)
})

test('database connection requires TLS for an injected managed URL', () => {
  const result = new URL(databaseConnectionString(
    'postgresql://user:password@internal-db/app?application_name=floating-assistant',
    'require',
  ))
  assert.equal(result.searchParams.get('sslmode'), 'require')
  assert.equal(result.searchParams.get('application_name'), 'floating-assistant')
})

test('verify-full keeps CA and hostname verification enabled', () => {
  const connectionString = databaseConnectionString(
    'postgresql://user:password@db.example.com/app',
    'verify-full',
  )
  const parsed = parse(connectionString)
  assert.equal(parsed.sslmode, 'verify-full')
  assert.equal(typeof parsed.ssl, 'object')
  assert.equal('rejectUnauthorized' in (parsed.ssl as object), false)
})

test('Render internal connection explicitly disables TLS for the private endpoint', () => {
  const connectionString = databaseConnectionString(
    'postgresql://user:password@dpg-private/app?application_name=floating-assistant',
    'render-internal',
  )
  const result = new URL(connectionString)
  assert.equal(result.searchParams.get('sslmode'), 'disable')
  assert.equal(result.searchParams.get('application_name'), 'floating-assistant')
  assert.equal(parse(connectionString).ssl, false)
})

test('Render internal mode rejects conflicting certificate configuration', () => {
  assert.throws(() => databaseConnectionString(
    'postgresql://user:password@dpg-private/app?sslrootcert=/run/secrets/ca.pem',
    'render-internal',
  ))
})

test('Render internal mode does not silently override URL-managed TLS', () => {
  assert.throws(() => databaseConnectionString(
    'postgresql://user:password@db.example.com/app?sslmode=require',
    'render-internal',
  ))
})
