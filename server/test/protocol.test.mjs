import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'
import { ShareSessionManager } from '../dist/share/shareSessionManager.js'

const testPort = process.env.SHARE_TEST_PORT ?? '32123'
const baseUrl = process.env.SHARE_TEST_URL ?? `http://localhost:${testPort}`
const child = process.env.SHARE_TEST_URL ? null : spawn(process.execPath, ['dist/server.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    PORT: testPort,
    VIEWER_BASE_URL: baseUrl,
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    NODE_ENV: 'test',
  },
  stdio: 'ignore',
})
process.once('exit', () => child?.kill())
if (child) await waitForServer(baseUrl)

const createdResponse = await fetch(`${baseUrl}/api/share/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
assert.equal(createdResponse.status, 201)
const created = await createdResponse.json()
assert.equal(typeof created.sessionId, 'string')
assert.match(created.viewerToken, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/)
assert.equal(typeof created.hostSecret, 'string')
assert.equal(created.viewerUrl, `${baseUrl}/view`)

const invalidClose = await openUntilClose(`${baseUrl.replace('http', 'ws')}/ws?token=WRONG-TOKEN`)
assert.equal(invalidClose.code, 4003)

const viewer = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws?token=${created.viewerToken}`)
const snapshot = await nextMessage(viewer)
assert.deepEqual(Object.keys(snapshot).sort(), ['expiresAt', 'requestId', 'response', 'streaming', 'type'])
assert.equal(snapshot.type, 'snapshot')
assert.equal(snapshot.response, '')

const viewerCannotPublish = await publish(created, created.viewerToken, {
  type: 'response_start', requestId: 'forbidden',
})
assert.equal(viewerCannotPublish.status, 404)

await expectEvent(viewer, created, { type: 'response_start', requestId: 'answer-a' })
await expectEvent(viewer, created, { type: 'response_delta', requestId: 'answer-a', delta: 'public' })
await expectEvent(viewer, created, { type: 'response_delta', requestId: 'answer-a', delta: ' class Solution {}' })
await expectEvent(viewer, created, { type: 'response_complete', requestId: 'answer-a' })

const lateViewer = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws?token=${created.viewerToken}`)
const lateSnapshot = await nextMessage(lateViewer)
assert.equal(lateSnapshot.response, 'public class Solution {}')
assert.equal(lateSnapshot.requestId, 'answer-a')
assert.equal(lateSnapshot.streaming, false)

await expectEvent(viewer, created, { type: 'response_start', requestId: 'answer-b' })
await expectEvent(viewer, created, { type: 'response_delta', requestId: 'answer-b', delta: 'second answer' })

const disallowedOrigin = await fetch(`${baseUrl}/api/share/session`, {
  method: 'POST', headers: { Origin: 'https://untrusted.example' },
})
assert.equal(disallowedOrigin.status, 403)

const ended = nextMessage(viewer)
const stopResponse = await fetch(`${baseUrl}/api/share/session/${created.sessionId}/stop`, {
  method: 'POST', headers: { Authorization: `Bearer ${created.hostSecret}` },
})
assert.equal(stopResponse.status, 200)
assert.equal((await ended).type, 'session_ended')
const stoppedToken = await openUntilClose(`${baseUrl.replace('http', 'ws')}/ws?token=${created.viewerToken}`)
assert.equal(stoppedToken.code, 4003)
lateViewer.close()

const manager = new ShareSessionManager(5)
const expiring = manager.create()
await new Promise((resolve) => setTimeout(resolve, 10))
assert.equal(manager.join(expiring.viewerToken, fakeSocket()), null)

console.info('Sharing protocol tests passed.')
child?.kill()

async function publish(session, secret, event) {
  return fetch(`${baseUrl}/api/share/session/${session.sessionId}/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
}

async function expectEvent(socket, session, event) {
  const incoming = nextMessage(socket)
  const response = await publish(session, session.hostSecret, event)
  assert.equal(response.status, 202)
  const received = await incoming
  assert.deepEqual(received, event)
  const forbiddenKeys = ['transcript', 'screenshot', 'typedPrompt', 'workspace', 'apiKey', 'hostSecret', 'prompt']
  for (const key of forbiddenKeys) assert.equal(key in received, false)
}

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message.')), 3000)
    socket.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
    socket.once('error', reject)
  })
}

function openUntilClose(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    socket.once('error', reject)
  })
}

function fakeSocket() {
  return { once() {}, send() {}, close() {}, readyState: 1, OPEN: 1 }
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('The sharing test server did not start.')
}
