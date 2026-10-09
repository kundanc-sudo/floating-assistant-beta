import assert from 'node:assert/strict'
import test from 'node:test'
import { createGracefulShutdown } from '../src/gracefulShutdown.js'

test('graceful shutdown stops work and closes server before database exactly once', async () => {
  const events: string[] = []
  const shutdown = createGracefulShutdown({
    deadlineMs: 1000,
    stopBackgroundWork: () => { events.push('stop-work') },
    closeSockets: () => { events.push('close-sockets') },
    closeServer: async () => { events.push('close-server') },
    closeDatabase: async () => { events.push('close-database') },
    log: () => undefined,
    onDeadline: () => { events.push('deadline') },
  })
  await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')])
  assert.deepEqual(events, ['stop-work', 'close-sockets', 'close-server', 'close-database'])
})
