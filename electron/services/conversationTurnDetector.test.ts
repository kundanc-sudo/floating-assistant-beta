import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTO_ASSIST_STABILITY_MS,
  ConversationTurnDetector,
  TURN_DISPATCH_WATCHDOG_MS,
  type AutoAssistTrigger,
} from './conversationTurnDetector'

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
    clearTimeout: (handle: unknown) => {
      this.tasks.delete(handle as number)
    },
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

function setup(
  triggerSource: 'microphone' | 'system' = 'microphone',
  stabilityMs = AUTO_ASSIST_STABILITY_MS,
) {
  const clock = new FakeClock()
  const triggers: AutoAssistTrigger[] = []
  let sequence = 0
  const detector = new ConversationTurnDetector({
    onTrigger: (trigger) => triggers.push(trigger),
    now: () => clock.now,
    createId: () => `trigger-${++sequence}`,
    scheduler: clock.scheduler,
    stabilityMs,
  })
  detector.setTriggerSource(triggerSource)
  detector.setEnabled(true)
  const segment = (text: string, source: 'microphone' | 'system' = triggerSource) => ({
    id: `segment-${++sequence}`,
    text,
    source,
    timestamp: clock.now,
  })
  return { clock, detector, triggers, segment }
}

test('partial transcript never triggers', () => {
  const { clock, detector, triggers } = setup()
  detector.partialTranscript()
  clock.advance(AUTO_ASSIST_STABILITY_MS * 2)
  assert.equal(triggers.length, 0)
})

test('final meaningful question triggers exactly once without a second debounce', () => {
  const { clock, detector, triggers, segment } = setup()
  detector.finalSegment(segment('Can you tell me about your current project?'))
  assert.equal(triggers.length, 1)
  clock.advance(AUTO_ASSIST_STABILITY_MS * 2)
  assert.equal(triggers.length, 1)
})

test('speech during stability cancels and the next final segment restarts it', () => {
  const { clock, detector, triggers, segment } = setup('microphone', 900)
  detector.finalSegment(segment('Can you tell me about'))
  clock.advance(500)
  detector.speechStarted('microphone')
  clock.advance(500)
  assert.equal(triggers.length, 0)
  detector.finalSegment(segment('Can you tell me about a difficult project you worked on?'))
  clock.advance(900)
  assert.equal(triggers.length, 1)
})

test('filler does not trigger', () => {
  const { clock, detector, triggers, segment } = setup()
  detector.finalSegment(segment('Okay, perfect.'))
  clock.advance(AUTO_ASSIST_STABILITY_MS)
  assert.equal(triggers.length, 0)
})

test('command-style request triggers', () => {
  const { clock, detector, triggers, segment } = setup()
  detector.finalSegment(segment('Tell me about your current project.'))
  clock.advance(AUTO_ASSIST_STABILITY_MS)
  assert.equal(triggers.length, 1)
})

test('short contextual question triggers', () => {
  const { clock, detector, triggers, segment } = setup()
  detector.finalSegment(segment('How did you resolve that?'))
  clock.advance(AUTO_ASSIST_STABILITY_MS)
  assert.equal(triggers.length, 1)
})

test('leading conversational filler does not hide an actionable question', () => {
  const { detector, triggers, segment } = setup()
  detector.finalSegment(segment('Okay, so which project have you done right now?'))
  assert.equal(triggers.length, 1)
})

test('duplicate completed transcript does not trigger twice', () => {
  const { clock, detector, triggers, segment } = setup()
  const text = 'What was your role?'
  detector.finalSegment(segment(text))
  clock.advance(AUTO_ASSIST_STABILITY_MS)
  detector.generationStarted('answer-1', triggers[0].id)
  detector.generationFinished('answer-1')
  detector.finalSegment(segment(text))
  clock.advance(AUTO_ASSIST_STABILITY_MS)
  assert.equal(triggers.length, 1)
})

test('manual generation consumes a pending automatic trigger', () => {
  const { clock, detector, triggers, segment } = setup('microphone', 900)
  detector.finalSegment(segment('Explain your architecture.'))
  clock.advance(400)
  detector.manualGenerationStarted('manual-answer')
  clock.advance(900)
  assert.equal(triggers.length, 0)
})

test('reset clears pending detector state', () => {
  const { clock, detector, triggers, segment } = setup('microphone', 900)
  detector.finalSegment(segment('Give me an example of a conflict.'))
  detector.reset()
  clock.advance(900)
  assert.equal(triggers.length, 0)
})

test('stop clears the pending detector timer safely', () => {
  const { clock, detector, triggers, segment } = setup('microphone', 900)
  detector.finalSegment(segment('Why are you looking for a change?'))
  detector.stop()
  clock.advance(900)
  assert.equal(triggers.length, 0)
})

test('speech finalized while an answer streams is queued for the next generation', () => {
  const { clock, detector, triggers, segment } = setup()
  detector.finalSegment(segment('Tell me about your current project.'))
  clock.advance(AUTO_ASSIST_STABILITY_MS)
  detector.generationStarted('answer-1', triggers[0].id)

  detector.finalSegment(segment('What was your role?'))
  clock.advance(AUTO_ASSIST_STABILITY_MS)
  assert.equal(triggers.length, 1)

  detector.generationFinished('answer-1')
  assert.equal(triggers.length, 2)
})

test('failed automatic generation can be triggered again', () => {
  const { detector, triggers, segment } = setup()
  detector.finalSegment(segment('What was your role?'))
  detector.generationStarted('answer-1', triggers[0].id)
  detector.generationFailed('answer-1')
  detector.finalSegment(segment('What was your role?'))
  assert.equal(triggers.length, 2)
})

test('dispatch watchdog recovers a stalled trigger exactly once', () => {
  const { clock, detector, triggers, segment } = setup()
  detector.finalSegment(segment('What project are you working on right now?'))
  assert.equal(triggers.length, 1)
  clock.advance(TURN_DISPATCH_WATCHDOG_MS)
  assert.equal(triggers.length, 2)
  assert.equal(triggers[1].id, triggers[0].id)
  clock.advance(TURN_DISPATCH_WATCHDOG_MS * 2)
  assert.equal(triggers.length, 2)
})

test('generation acknowledgement cancels dispatch watchdog', () => {
  const { clock, detector, triggers, segment } = setup()
  detector.finalSegment(segment('What project are you working on right now?'))
  detector.generationStarted('answer-1', triggers[0].id)
  clock.advance(TURN_DISPATCH_WATCHDOG_MS * 2)
  assert.equal(triggers.length, 1)
})

test('slow Answer A queues Question B and dispatches it only after A completes', () => {
  const { detector, triggers, segment } = setup('system')
  const questionA = segment('What database did you use?', 'system')
  detector.finalSegment(questionA)
  detector.generationStarted('answer-a', triggers[0].id)

  const questionB = segment('Why did you choose PostgreSQL?', 'system')
  detector.finalSegment(questionB)
  assert.equal(triggers.length, 1)

  detector.generationFinished('answer-a')
  assert.equal(triggers.length, 2)
  assert.equal(triggers[0].segmentId, questionA.id)
  assert.equal(triggers[1].segmentId, questionB.id)
})

test('overlap policy keeps one queued turn and prefers the newest while generation is active', () => {
  const { detector, triggers, segment } = setup('system')
  detector.finalSegment(segment('Tell me about your current project.', 'system'))
  detector.generationStarted('answer-a', triggers[0].id)
  const questionB = segment('What database did you use?', 'system')
  const questionC = segment('Why did you choose PostgreSQL?', 'system')
  detector.finalSegment(questionB)
  detector.finalSegment(questionC)
  detector.generationFinished('answer-a')
  assert.equal(triggers.length, 2)
  assert.equal(triggers[1].segmentId, questionC.id)
})

test('substantially identical finalized transcripts produce one automatic trigger', () => {
  const { detector, triggers, segment } = setup('system')
  detector.finalSegment(segment('What database did you use?', 'system'))
  detector.generationStarted('answer-a', triggers[0].id)
  detector.generationFinished('answer-a')
  detector.finalSegment(segment('what database did you use', 'system'))
  assert.equal(triggers.length, 1)
})

test('MIC+SYSTEM: SYSTEM question triggers automatic generation', () => {
  const { clock, detector, triggers, segment } = setup('system')
  detector.finalSegment(segment('Can you optimize this?', 'system'))
  clock.advance(AUTO_ASSIST_STABILITY_MS)
  assert.equal(triggers.length, 1)
  assert.equal(triggers[0].source, 'system')
})

test('MIC+SYSTEM: MIC question-like speech cannot trigger automatic generation', () => {
  const { clock, detector, triggers, segment } = setup('system')
  detector.finalSegment(segment('Can you explain the project architecture?', 'microphone'))
  clock.advance(AUTO_ASSIST_STABILITY_MS)
  assert.equal(triggers.length, 0)
})

test('MIC+SYSTEM: reading an answer through MIC does not create a second generation', () => {
  const { detector, triggers, segment } = setup('system')
  detector.finalSegment(segment('Tell me about yourself.', 'system'))
  detector.generationStarted('answer-a', triggers[0].id)
  detector.finalSegment(segment('I am a software engineer with extensive experience.', 'microphone'))
  detector.generationFinished('answer-a')
  assert.equal(triggers.length, 1)
})

test('MIC+SYSTEM: SYSTEM A, MIC answer, SYSTEM B produces exactly two generations', () => {
  const { detector, triggers, segment } = setup('system')
  detector.finalSegment(segment('Tell me about yourself.', 'system'))
  detector.generationStarted('answer-a', triggers[0].id)
  detector.finalSegment(segment('I am a software engineer with extensive experience.', 'microphone'))
  detector.generationFinished('answer-a')
  detector.finalSegment(segment('What project are you currently working on?', 'system'))
  detector.generationStarted('answer-b', triggers[1].id)
  assert.equal(triggers.length, 2)
  assert.deepEqual(triggers.map((trigger) => trigger.source), ['system', 'system'])
})

test('SYSTEM-only: SYSTEM questions continue triggering normally', () => {
  const { detector, triggers, segment } = setup('system')
  detector.finalSegment(segment('What was your role?', 'system'))
  assert.equal(triggers.length, 1)
})

test('MIC-only: MIC remains the explicit automatic trigger source', () => {
  const { detector, triggers, segment } = setup('microphone')
  detector.finalSegment(segment('What was your role?', 'microphone'))
  assert.equal(triggers.length, 1)
  assert.equal(triggers[0].source, 'microphone')
})

const actionableTurns = [
  'And why did you not give me answers in five to six lines?',
  'So what exactly did you do there?',
  'Okay and your role in that?',
  'Your biggest challenge there?',
  'And AWS?',
  'What about Kubernetes?',
  'Walk me through that.',
  'Explain that part.',
  'How about the database side?',
  'Any reason for that?',
  'What happened after that?',
  'Can you go little deeper?',
  'Tell me more.',
  'Difference between those two?',
  'Encapsulation',
  'Explain encapsulation',
  'Java collections',
  'Difference between ArrayList and LinkedList',
  'Your experience with AWS',
  'How did you handle that issue',
  'Tell me about yourself.',
  'What was your role?',
  'Why are you looking for a change?',
  'Walk me through your current project.',
  'How did you resolve it?',
  'What data sources did you use?',
  'Complexity?',
  'Can you optimize this?',
  'And your role there?',
  'Biggest challenge?',
  'Why?',
  'How?',
  'Your experience with AWS?',
  'Any experience with healthcare data?',
  'Experience working with stakeholders?',
  'Reason for leaving?',
  'And then?',
]

for (const text of actionableTurns) {
  test(`recognizes actionable finalized turn: ${text}`, () => {
    const { detector, triggers, segment } = setup()
    detector.finalSegment(segment(text))
    assert.equal(triggers.length, 1)
  })
}

for (const text of [
  'okay', 'yeah', 'yes', 'right', 'perfect', 'great', 'thank you', 'thanks',
  'got it', 'makes sense', 'uh', 'um', 'hmm', 'okay yeah', 'yeah right',
  'perfect thank you', 'okay got it',
]) {
  test(`suppresses acknowledgment: ${text}`, () => {
    const { detector, triggers, segment } = setup()
    detector.finalSegment(segment(text))
    assert.equal(triggers.length, 0)
  })
}
