import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import {
  RealtimeAssistantService,
  type LiveAssistantStatus,
} from './realtimeAssistantService'

function createEvents(statuses: LiveAssistantStatus[], errors: string[] = []) {
  return {
    onStatus: (status: LiveAssistantStatus) => statuses.push(status),
    onTranscript: () => undefined,
    onAnswerDelta: () => undefined,
    onAnswerComplete: () => undefined,
    onStaleAnswer: () => undefined,
    onError: (message: string) => errors.push(message),
    onTranscriptFragment: () => undefined,
    onSpeechStopped: () => undefined,
  }
}

async function createServer() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    server,
    url: `ws://127.0.0.1:${address.port}`,
  }
}

async function closeServer(server: WebSocketServer) {
  for (const client of server.clients) client.terminate()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

test('stop is safe and idempotent while the socket is CONNECTING', async () => {
  const { server, url } = await createServer()
  const statuses: LiveAssistantStatus[] = []
  const assistant = new RealtimeAssistantService(
    'microphone',
    createEvents(statuses),
    { url },
  )

  try {
    const starting = assistant.start('test-key')
    assert.doesNotThrow(() => {
      assistant.stop()
      assistant.stop()
    })
    await assert.doesNotReject(starting)
    assert.equal(statuses.at(-1), 'IDLE')
  } finally {
    assistant.stop()
    await closeServer(server)
  }
})

test('an OPEN socket closes cleanly and intentional stop prevents reconnect', async () => {
  const { server, url } = await createServer()
  const statuses: LiveAssistantStatus[] = []
  let connectionCount = 0
  server.on('connection', () => { connectionCount += 1 })
  const assistant = new RealtimeAssistantService(
    'system',
    createEvents(statuses),
    { url },
  )

  try {
    await assistant.start('test-key')
    assert.equal(connectionCount, 1)
    assistant.stop()
    assistant.stop()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    assert.equal(connectionCount, 1)
    assert.equal(statuses.at(-1), 'IDLE')
  } finally {
    assistant.stop()
    await closeServer(server)
  }
})

test('an invalid API key error is fatal and does not enter the reconnect loop', async () => {
  const { server, url } = await createServer()
  const statuses: LiveAssistantStatus[] = []
  const errors: string[] = []
  let connectionCount = 0
  server.on('connection', (socket) => {
    connectionCount += 1
    socket.send(JSON.stringify({
      type: 'error',
      error: {
        code: 'invalid_api_key',
        message: 'Incorrect API key provided: secret-value-that-must-not-be-shown',
      },
    }))
  })
  const assistant = new RealtimeAssistantService(
    'microphone',
    createEvents(statuses, errors),
    { url },
  )

  try {
    await assistant.start('test-key')
    await new Promise((resolve) => setTimeout(resolve, 1100))
    assert.equal(connectionCount, 1)
    assert.equal(statuses.includes('ERROR'), true)
    assert.equal(errors.at(-1), 'Realtime authentication failed. Request a new backend session credential.')
    assert.equal(errors.some((message) => message.includes('secret-value')), false)
  } finally {
    assistant.stop()
    await closeServer(server)
  }
})
