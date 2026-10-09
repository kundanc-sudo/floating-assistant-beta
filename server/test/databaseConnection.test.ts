import assert from 'node:assert/strict'
import test from 'node:test'
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
