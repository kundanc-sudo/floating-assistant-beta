export interface EnglishTranscriptValidation {
  valid: boolean
  text: string
  normalizedArtifact: boolean
  reason?: 'empty' | 'no-letters' | 'unexpected-script'
}

const MAX_ISOLATED_NON_LATIN_LETTERS = 2
const MAX_NON_LATIN_RATIO = 0.2
const MIN_SUBSTANTIAL_NON_LATIN_LETTERS = 3
const LETTER_PATTERN = /\p{L}/u
const LATIN_PATTERN = /\p{Script=Latin}/u

const INTERNAL_PROMPT_SIGNATURES = [
  'the audio contains english conversation',
  'transcribe spoken english accurately',
  'technical terms may include',
  'using english characters',
  'you are a concise helpful desktop assistant',
  'classify intent only do not answer the transcript',
]

export function isTranscriptionArtifact(text: string): boolean {
  const normalized = normalizeForComparison(text)
  if (!normalized) return false
  if (INTERNAL_PROMPT_SIGNATURES.some((phrase) => normalized.includes(phrase))) {
    return true
  }

  const transcriptWords = new Set(normalized.split(' '))
  return INTERNAL_PROMPT_SIGNATURES.some((phrase) => {
    const phraseWords = phrase.split(' ')
    const sharedWords = phraseWords.filter((word) => transcriptWords.has(word)).length
    return sharedWords >= 4 && sharedWords / phraseWords.length >= 0.6
  })
}

export function validateEnglishTranscript(transcript: string): EnglishTranscriptValidation {
  const trimmed = transcript.trim()
  if (!trimmed) return { valid: false, text: '', normalizedArtifact: false, reason: 'empty' }

  const characters = Array.from(trimmed)
  const letters = characters.filter((character) => LETTER_PATTERN.test(character))
  if (letters.length === 0) {
    return { valid: false, text: '', normalizedArtifact: false, reason: 'no-letters' }
  }

  const latinCount = letters.filter((character) => LATIN_PATTERN.test(character)).length
  const nonLatinCount = letters.length - latinCount
  const nonLatinRatio = nonLatinCount / letters.length

  if (nonLatinRatio >= MAX_NON_LATIN_RATIO || nonLatinCount >= MIN_SUBSTANTIAL_NON_LATIN_LETTERS || latinCount === 0) {
    return { valid: false, text: '', normalizedArtifact: false, reason: 'unexpected-script' }
  }

  if (nonLatinCount > 0 && nonLatinCount <= MAX_ISOLATED_NON_LATIN_LETTERS) {
    const normalized = characters
      .map((character) => LETTER_PATTERN.test(character) && !LATIN_PATTERN.test(character) ? ' ' : character)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    return { valid: true, text: normalized, normalizedArtifact: true }
  }

  return { valid: true, text: trimmed, normalizedArtifact: false }
}

export function isValidEnglishTranscript(text: string): boolean {
  return validateEnglishTranscript(text).valid
}

export function hasSubstantialUnexpectedScript(text: string): boolean {
  const letters = Array.from(text).filter((character) => LETTER_PATTERN.test(character))
  if (letters.length === 0) return false
  const nonLatinCount = letters.filter((character) => !LATIN_PATTERN.test(character)).length
  return nonLatinCount >= MIN_SUBSTANTIAL_NON_LATIN_LETTERS || nonLatinCount / letters.length >= MAX_NON_LATIN_RATIO
}

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
