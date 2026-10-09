import assert from 'node:assert/strict'
import test from 'node:test'
import { AnswerService, type AnswerRequest } from './answerService'

const request: AnswerRequest = {
  request: {
    id: 'request-1',
    text: 'What was your role?',
    normalizedText: 'what was your role',
    source: 'microphone',
    timestamp: 1,
    requestType: 'conversation',
  },
  route: 'CONVERSATION',
  userText: 'What was your role?',
  instructions: 'Answer briefly.',
}

function streamResponse(text: string) {
  const body = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

test('transient HTTP failure retries once before any output', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return calls === 1
      ? new Response('{"error":{"message":"temporary"}}', { status: 503 })
      : streamResponse('Recovered answer')
  }) as typeof fetch

  try {
    const answer = await new Promise<string>((resolve, reject) => {
      const service = new AnswerService('test-key', {
        fastModel: 'fast-model',
        codingModel: 'coding-model',
        fastReasoningEffort: 'low',
        codingReasoningEffort: 'high',
        development: false,
      }, {
        onDelta: () => undefined,
        onComplete: (_request, text) => resolve(text),
        onError: (_request, message) => reject(new Error(message)),
      })
      service.start(request)
    })
    assert.equal(calls, 2)
    assert.equal(answer, 'Recovered answer')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('authentication failure is not retried', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response('{"error":{"message":"invalid key"}}', { status: 401 })
  }) as typeof fetch

  try {
    const message = await new Promise<string>((resolve) => {
      const service = new AnswerService('test-key', {
        fastModel: 'fast-model',
        codingModel: 'coding-model',
        fastReasoningEffort: 'low',
        codingReasoningEffort: 'high',
        development: false,
      }, {
        onDelta: () => undefined,
        onComplete: () => undefined,
        onError: (_request, error) => resolve(error),
      })
      service.start(request)
    })
    assert.equal(calls, 1)
    assert.equal(message, 'OpenAI authentication failed. Check OPENAI_API_KEY in .env.')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a failed generation does not prevent the next request from completing', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return calls === 1
      ? new Response('{"error":{"message":"bad request"}}', { status: 400 })
      : streamResponse('Second request recovered')
  }) as typeof fetch

  try {
    const events: string[] = []
    let resolveSecond: (value: string) => void = () => undefined
    const secondComplete = new Promise<string>((resolve) => { resolveSecond = resolve })
    const service = new AnswerService('test-key', {
      fastModel: 'fast-model',
      codingModel: 'coding-model',
      fastReasoningEffort: 'low',
      codingReasoningEffort: 'high',
      development: false,
    }, {
      onDelta: () => undefined,
      onComplete: (completedRequest, text) => {
        events.push(`complete:${completedRequest.id}`)
        resolveSecond(text)
      },
      onError: (failedRequest) => {
        events.push(`error:${failedRequest.id}`)
        service.start({
          ...request,
          request: { ...request.request, id: 'request-2', text: 'Follow-up question' },
        })
      },
    })

    service.start(request)
    assert.equal(await secondComplete, 'Second request recovered')
    assert.deepEqual(events, ['error:request-1', 'complete:request-2'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
