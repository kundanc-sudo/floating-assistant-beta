import assert from 'node:assert/strict'
import test from 'node:test'
import { AnswerService } from './answerService'
import {
  InterviewContextService,
  buildInterviewSystemInstructions,
  buildInterviewUserMessage,
} from './interviewContextService'

const resume = 'Alex Morgan is a backend software engineer with experience building Java and Spring Boot microservices on AWS. Alex worked on an order processing platform and improved API response time through caching and database query optimization.'
const jobDescription = 'Looking for a backend engineer with Java, Spring Boot, AWS, microservices, API development and performance optimization.'
const instructions = 'Answer as the candidate in a natural spoken interview style. Use only experience supported by the resume. For introductions keep the answer concise and focused on recent relevant experience.'

function createLoadedContext() {
  const service = new InterviewContextService()
  service.setField('resume', resume)
  service.setField('jobDescription', jobDescription)
  service.setField('instructions', instructions)
  return service
}

function streamResponse(text: string) {
  const body = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

test('model request contains persistent instructions, resume, JD, memory, and current question', async () => {
  const context = createLoadedContext().getSnapshot()
  const systemInstructions = buildInterviewSystemInstructions('Base instructions.', context)
  const userText = buildInterviewUserMessage({
    sessionSummary: 'Alex is discussing backend engineering experience.',
    relevantConversation: 'INTERVIEWER: Tell me about recent backend work.',
    previousInteractions: 'QUESTION: What project are you working on?\nANSWER: An AWS order-processing platform.',
    currentQuestion: 'Can you introduce yourself?',
  })
  const originalFetch = globalThis.fetch
  let payload: Record<string, unknown> | undefined
  globalThis.fetch = (async (_url, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>
    return streamResponse('I am Alex, a backend software engineer focused on Java and Spring Boot services on AWS.')
  }) as typeof fetch

  try {
    await new Promise<void>((resolve, reject) => {
      const answerService = new AnswerService('test-key', {
        fastModel: 'fast-model',
        codingModel: 'coding-model',
        fastReasoningEffort: 'low',
        codingReasoningEffort: 'high',
        development: false,
      }, {
        onDelta: () => undefined,
        onComplete: () => resolve(),
        onError: (_request, message) => reject(new Error(message)),
      })
      answerService.start({
        request: {
          id: 'interview-request',
          text: 'Can you introduce yourself?',
          normalizedText: 'can you introduce yourself',
          source: 'system',
          timestamp: 1,
          requestType: 'conversation',
        },
        route: 'CONVERSATION',
        instructions: systemInstructions,
        userText,
      })
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  const serialized = JSON.stringify(payload)
  assert.match(serialized, /natural spoken interview style/)
  assert.match(serialized, /Java and Spring Boot microservices on AWS/)
  assert.match(serialized, /Looking for a backend engineer/)
  assert.match(serialized, /AWS order-processing platform/)
  assert.match(serialized, /Can you introduce yourself/)
  assert.match(serialized, /Answer as the candidate, not as an AI assistant/)
})

test('follow-up request contains previous Q&A needed to resolve a referent', () => {
  const userText = buildInterviewUserMessage({
    sessionSummary: '',
    relevantConversation: '',
    previousInteractions: 'QUESTION: What project are you working on?\nANSWER: I work on an AWS order-processing platform.',
    currentQuestion: 'What was your role in that?',
  })
  assert.match(userText, /AWS order-processing platform/)
  assert.match(userText, /What was your role in that/)
})

test('one loaded context remains identical across five answer constructions', () => {
  const service = createLoadedContext()
  const expected = service.getSnapshot()
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(service.getSnapshot(), expected)
    const requestInstructions = buildInterviewSystemInstructions('Base.', service.getSnapshot())
    assert.match(requestInstructions, /Alex Morgan/)
    assert.match(requestInstructions, /Looking for a backend engineer/)
  }
})

test('reset clears resume, JD, instructions, and ready status', () => {
  const service = createLoadedContext()
  const status = service.reset()
  assert.deepEqual(service.getSnapshot(), {
    instructions: '',
    resumeText: '',
    jobDescriptionText: '',
  })
  assert.equal(status.ready, false)
  assert.equal(status.resumeLoaded, false)
  assert.equal(status.jobDescriptionLoaded, false)
  assert.equal(status.instructionsLoaded, false)
})
