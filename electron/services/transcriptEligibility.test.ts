import assert from 'node:assert/strict'
import test from 'node:test'
import { isMeaningfulTranscript } from './transcriptEligibility'

test('short technical interview prompts remain meaningful', () => {
  for (const prompt of ['hashmap', 'kafka', 'encapsulation']) {
    assert.equal(isMeaningfulTranscript(prompt), true, prompt)
  }
})

test('short follow-ups and two-word technical prompts remain meaningful', () => {
  for (const prompt of ['why', 'how', 'and aws', 'rest soap']) {
    assert.equal(isMeaningfulTranscript(prompt), true, prompt)
  }
})

test('audio filler remains ineligible', () => {
  for (const filler of ['', 'uh', 'ummm', 'hmm', 'okay', 'thank you']) {
    assert.equal(isMeaningfulTranscript(filler), false, filler)
  }
})

