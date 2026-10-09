import assert from 'node:assert/strict'
import test from 'node:test'
import {
  answerDisplayReducer,
  initialAnswerDisplayState,
  isNearLiveAnswerEdge,
  type AnswerDisplayState,
} from './answerDisplayState'

function completeAnswer(
  state: AnswerDisplayState,
  id: string,
  question: string,
  answer: string,
) {
  const started = answerDisplayReducer(state, {
    type: 'start', id, question, delta: answer, createdAt: Number(id.slice(1)),
  })
  return answerDisplayReducer(started, { type: 'complete', id })
}

test('completed Answer A remains available when Answer B starts', () => {
  const withA = completeAnswer(initialAnswerDisplayState, 'a1', 'Question A', 'Answer A')
  const withB = answerDisplayReducer(withA, {
    type: 'start', id: 'a2', question: 'Question B', delta: 'B', createdAt: 2,
  })
  assert.equal(withB.current?.id, 'a2')
  assert.equal(withB.completed[0]?.answer, 'Answer A')
})

test('streaming B changes only B and leaves completed A byte-for-byte unchanged', () => {
  const withA = completeAnswer(initialAnswerDisplayState, 'a1', 'Question A', 'Answer A')
  const immutableA = withA.completed[0]
  const startedB = answerDisplayReducer(withA, {
    type: 'start', id: 'a2', question: 'Question B', delta: 'Answer ', createdAt: 2,
  })
  const streamedB = answerDisplayReducer(startedB, { type: 'append', id: 'a2', delta: 'B' })
  assert.strictEqual(streamedB.completed[0], immutableA)
  assert.equal(streamedB.completed[0]?.answer, 'Answer A')
  assert.equal(streamedB.current?.answer, 'Answer B')
})

test('stale tokens cannot mutate the current or completed answer', () => {
  const withA = completeAnswer(initialAnswerDisplayState, 'a1', 'Question A', 'Answer A')
  const withB = answerDisplayReducer(withA, {
    type: 'start', id: 'a2', question: 'Question B', delta: 'B', createdAt: 2,
  })
  assert.strictEqual(
    answerDisplayReducer(withB, { type: 'append', id: 'a1', delta: ' stale' }),
    withB,
  )
})

test('pinning A survives streaming and completing B', () => {
  let state = completeAnswer(initialAnswerDisplayState, 'a1', 'Question A', 'Answer A')
  state = answerDisplayReducer(state, { type: 'pin', id: 'a1' })
  state = answerDisplayReducer(state, {
    type: 'start', id: 'a2', question: 'Question B', delta: 'Answer B', createdAt: 2,
  })
  state = answerDisplayReducer(state, { type: 'complete', id: 'a2' })
  assert.equal(state.pinnedId, 'a1')
  assert.equal(state.current?.id, 'a2')
})

test('failed B remains separate and does not destroy A', () => {
  const withA = completeAnswer(initialAnswerDisplayState, 'a1', 'Question A', 'Answer A')
  const failedB = answerDisplayReducer(withA, {
    type: 'fail', id: 'a2', question: 'Question B', error: 'Failed', createdAt: 2,
  })
  assert.equal(failedB.current?.status, 'failed')
  assert.equal(failedB.completed[0]?.answer, 'Answer A')
})

test('A, B, and C remain in chronological completed history', () => {
  let state = initialAnswerDisplayState
  state = completeAnswer(state, 'a1', 'Question A', 'Answer A')
  state = completeAnswer(state, 'a2', 'Question B', 'Answer B')
  state = completeAnswer(state, 'a3', 'Question C', 'Answer C')
  assert.deepEqual(state.completed.map((entry) => entry.id), ['a1', 'a2', 'a3'])
})

test('history preview does not modify current generation state', () => {
  let state = completeAnswer(initialAnswerDisplayState, 'a1', 'Question A', 'Answer A')
  state = answerDisplayReducer(state, {
    type: 'start', id: 'a2', question: 'Question B', delta: 'B', createdAt: 2,
  })
  const current = state.current
  state = answerDisplayReducer(state, { type: 'preview', id: 'a1' })
  assert.strictEqual(state.current, current)
  assert.equal(state.previewId, 'a1')
})

test('clear view preserves completed session history', () => {
  const withA = completeAnswer(initialAnswerDisplayState, 'a1', 'Question A', 'Answer A')
  const cleared = answerDisplayReducer(withA, { type: 'clear-view' })
  assert.equal(cleared.current, null)
  assert.equal(cleared.completed.length, 1)
})

test('smart-scroll follows only near the live edge and preserves an older reading position', () => {
  assert.equal(isNearLiveAnswerEdge(1_000, 680, 300), true)
  assert.equal(isNearLiveAnswerEdge(1_000, 300, 300), false)
})
