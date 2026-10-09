const MIN_MEANINGFUL_WORDS = 2
const MIN_SINGLE_PHRASE_CHARACTERS = 4

const NOISE_TRANSCRIPTS = new Set([
  'uh', 'um', 'hm', 'hmm', 'ah', 'okay', 'yeah', 'yes', 'you', 'the',
  'thank you', 'thanks for watching', 'music', 'silence', 'background noise',
  'inaudible',
])

export function isMeaningfulTranscript(normalizedText: string): boolean {
  if (!normalizedText || NOISE_TRANSCRIPTS.has(normalizedText)) return false
  if (/^(uh+|um+|hm+|ah+|oh+|mm+|huh+)$/.test(normalizedText)) return false
  if (normalizedText === 'why' || normalizedText === 'how') return true

  const words = normalizedText
    .split(' ')
    .filter((word) => word.length > 1 && !NOISE_TRANSCRIPTS.has(word))

  return (
    words.length >= MIN_MEANINGFUL_WORDS ||
    (words.length === 1 && words[0].length >= MIN_SINGLE_PHRASE_CHARACTERS)
  )
}

