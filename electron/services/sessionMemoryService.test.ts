import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionMemoryService, type ConversationSegment } from './sessionMemoryService'

function segment(id: string, text: string): ConversationSegment {
  return { id, text, source: 'microphone', timestamp: Number(id.slice(1)) }
}

test('successful interaction is available to history immediately', () => {
  const memory = new SessionMemoryService()
  const question = segment('q1', 'Can you tell me about yourself?')

  const committed = memory.recordInteraction('request-1', [question], 'Answer one.', memory.getGeneration())

  assert.ok(committed)
  assert.deepEqual(memory.getRecentInteractions(), [committed])
})

test('two successful interactions remain in chronological order', () => {
  const memory = new SessionMemoryService()
  memory.recordInteraction('request-1', [segment('q1', 'Question one?')], 'Answer one.', memory.getGeneration())
  memory.recordInteraction('request-2', [segment('q2', 'Question two?')], 'Answer two.', memory.getGeneration())

  const history = memory.getRecentInteractions()
  assert.deepEqual(history.map((item) => item.requestId), ['request-1', 'request-2'])
  assert.deepEqual(history.map((item) => item.assistantAnswer), ['Answer one.', 'Answer two.'])
})

test('failed or empty generation is not committed to history', () => {
  const memory = new SessionMemoryService()
  const committed = memory.recordInteraction(
    'request-failed',
    [segment('q1', 'Question?')],
    '',
    memory.getGeneration(),
  )

  assert.equal(committed, null)
  assert.deepEqual(memory.getRecentInteractions(), [])
})

test('25 interview turns keep recent interaction history bounded and preserve follow-up context', async () => {
  const memory = new SessionMemoryService(undefined, async () => 'Rolling interview summary.')
    for (let index = 1; index <= 25; index += 1) {
      const question = segment(`q${index}`, `Interview question ${index}?`)
      memory.commitConversation([question])
      memory.recordInteraction(
        `request-${index}`,
        [question],
        `Answer ${index}.`,
        memory.getGeneration(),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    const context = memory.createAnswerContext([segment('q26', 'Why?')])
    assert.equal(context.recentInteractions.length, 3)
    assert.deepEqual(
      context.recentInteractions.map((item) => item.requestId),
      ['request-23', 'request-24', 'request-25'],
    )
    assert.equal(context.currentConversation[0]?.text, 'Why?')
    assert.ok(context.sessionSummary.length > 0)
    assert.ok(context.recentConversation.length <= 12)
})

test('summary failure does not retry-loop and bounds retained transcript memory', async () => {
  let summaryCalls = 0
  const memory = new SessionMemoryService(undefined, async () => {
    summaryCalls += 1
    throw new Error('temporary failure')
  })
    for (let index = 1; index <= 100; index += 1) {
      memory.commitConversation([segment(`q${index}`, `Context ${index} ${'x'.repeat(400)}`)])
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    const context = memory.createAnswerContext([])
    assert.equal(summaryCalls, 1)
    assert.ok(context.recentConversation.length <= 48)
    assert.ok(
      context.recentConversation.reduce((total, item) => total + item.text.length, 0) <= 16_000,
    )
})
