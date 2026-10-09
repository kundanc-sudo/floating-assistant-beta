import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INCOMPLETE_SENTENCE_WAIT_MS,
  SHORT_PAUSE_MS,
  UtteranceBuffer,
} from './utteranceBuffer'
import { ConversationTurnDetector } from './conversationTurnDetector'

class FakeClock {
  now = 0
  private nextId = 1
  private tasks = new Map<number, { at: number; callback: () => void }>()
  readonly scheduler = {
    setTimeout: (callback: () => void, delayMs: number) => {
      const id = this.nextId++
      this.tasks.set(id, { at: this.now + delayMs, callback })
      return id
    },
    clearTimeout: (handle: unknown) => this.tasks.delete(handle as number),
  }
  advance(milliseconds: number) {
    const target = this.now + milliseconds
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      this.tasks.delete(next[0])
      this.now = next[1].at
      next[1].callback()
    }
    this.now = target
  }
}

test('complete turn finalizes once and detector adds no second delay', () => {
  const clock = new FakeClock()
  let triggerCount = 0
  const detector = new ConversationTurnDetector({
    onTrigger: () => { triggerCount += 1 },
    now: () => clock.now,
    createId: () => 'trigger',
    scheduler: clock.scheduler,
  })
  detector.setEnabled(true)
  const buffer = new UtteranceBuffer({
    onWaiting: () => undefined,
    onFinalized: (text, timing) => detector.finalSegment({
      id: 'segment', text, source: 'microphone', timestamp: clock.now,
    }, timing),
    now: () => clock.now,
    scheduler: clock.scheduler,
  })
  buffer.speechStopped(0)
  buffer.addFragment('Tell me about yourself.', 0)
  clock.advance(SHORT_PAUSE_MS - 1)
  assert.equal(triggerCount, 0)
  clock.advance(1)
  assert.equal(triggerCount, 1)
})

test('exact live rejected question dispatches once without any later speech event', () => {
  const clock = new FakeClock()
  const dispatched: string[] = []
  const detector = new ConversationTurnDetector({
    onTrigger: (trigger) => dispatched.push(trigger.segmentId),
    now: () => clock.now,
    createId: () => 'trigger-final-question',
    scheduler: clock.scheduler,
  })
  detector.setEnabled(true)
  const buffer = new UtteranceBuffer({
    onWaiting: () => undefined,
    onFinalized: (text, timing) => detector.finalSegment({
      id: timing.turnId ?? 'missing-turn-id',
      text,
      source: 'microphone',
      timestamp: clock.now,
    }, timing),
    now: () => clock.now,
    scheduler: clock.scheduler,
  })

  buffer.addFragment(
    'And why did you not give me answers in five to six lines?',
    0,
    'turn-final-question',
  )
  clock.advance(SHORT_PAUSE_MS)

  assert.deepEqual(dispatched, ['turn-final-question'])
})

test('incomplete turn waits for continuation and produces one merged turn', () => {
  const clock = new FakeClock()
  const finalized: string[] = []
  const buffer = new UtteranceBuffer({
    onWaiting: () => undefined,
    onFinalized: (text) => finalized.push(text),
    now: () => clock.now,
    scheduler: clock.scheduler,
  })
  buffer.addFragment('Can you tell me about...', 0)
  clock.advance(900)
  buffer.speechStarted()
  buffer.addFragment('your current project?', clock.now)
  clock.advance(SHORT_PAUSE_MS)
  assert.deepEqual(finalized, ['Can you tell me about... your current project?'])
  assert.ok(clock.now < INCOMPLETE_SENTENCE_WAIT_MS + SHORT_PAUSE_MS)
})

test('separate MIC and SYSTEM buffers preserve source and never merge fragments', () => {
  const clock = new FakeClock()
  const finalized: Array<{ source: 'microphone' | 'system'; text: string }> = []
  const createBuffer = (source: 'microphone' | 'system') => new UtteranceBuffer({
    onWaiting: () => undefined,
    onFinalized: (text) => finalized.push({ source, text }),
    now: () => clock.now,
    scheduler: clock.scheduler,
  })
  const microphone = createBuffer('microphone')
  const system = createBuffer('system')

  system.addFragment('Tell me about your current project.', 0, 'system-turn')
  microphone.addFragment('I am currently working on a platform.', 0, 'mic-turn')
  clock.advance(SHORT_PAUSE_MS)

  assert.deepEqual(finalized, [
    { source: 'system', text: 'Tell me about your current project.' },
    { source: 'microphone', text: 'I am currently working on a platform.' },
  ])
})

test('ellipsis-ended partial question waits for its meaningful continuation', () => {
  const clock = new FakeClock()
  const finalized: string[] = []
  const buffer = new UtteranceBuffer({
    onWaiting: () => undefined,
    onFinalized: (text) => finalized.push(text),
    now: () => clock.now,
    scheduler: clock.scheduler,
  })

  buffer.addFragment('So in your current project...', 0, 'partial-turn')
  clock.advance(900)
  assert.deepEqual(finalized, [])
  buffer.addFragment('how exactly did you handle the deployment?', clock.now)
  clock.advance(SHORT_PAUSE_MS)
  assert.deepEqual(finalized, [
    'So in your current project... how exactly did you handle the deployment?',
  ])
})

test('self-correction remains one turn and prefers waiting for the rephrased question', () => {
  const clock = new FakeClock()
  const finalized: string[] = []
  const buffer = new UtteranceBuffer({
    onWaiting: () => undefined,
    onFinalized: (text) => finalized.push(text),
    now: () => clock.now,
    scheduler: clock.scheduler,
  })

  buffer.addFragment('Tell me about your AWS...', 0, 'corrected-turn')
  clock.advance(700)
  buffer.addFragment('actually, let me rephrase that...', clock.now)
  clock.advance(700)
  buffer.addFragment('How did you deploy the application?', clock.now)
  clock.advance(SHORT_PAUSE_MS)
  assert.equal(finalized.length, 1)
  assert.match(finalized[0], /How did you deploy the application\?$/)
})

test('a 25-second continuously developing question is not split by the safety timeout', () => {
  const clock = new FakeClock()
  const finalized: string[] = []
  const buffer = new UtteranceBuffer({
    onWaiting: () => undefined,
    onFinalized: (text) => finalized.push(text),
    now: () => clock.now,
    scheduler: clock.scheduler,
  })

  for (let index = 0; index < 62; index += 1) {
    buffer.addFragment(`context${index}`, clock.now, 'long-turn')
    clock.advance(400)
  }
  assert.deepEqual(finalized, [])
  buffer.addFragment('what would you improve?', clock.now, 'long-turn')
  clock.advance(SHORT_PAUSE_MS)
  assert.equal(finalized.length, 1)
  assert.match(finalized[0], /^context0 /)
  assert.match(finalized[0], /what would you improve\?$/)
})
