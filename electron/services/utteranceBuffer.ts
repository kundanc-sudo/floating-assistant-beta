export const SHORT_PAUSE_MS = 700
export const NORMAL_END_OF_TURN_MS = 1800
export const INCOMPLETE_SENTENCE_WAIT_MS = 3000
export const MAX_UTTERANCE_WAIT_MS = 8000

const TRAILING_CONNECTORS = new Set([
  'and', 'or', 'but', 'because', 'about', 'between', 'with', 'for', 'to',
  'the', 'a', 'an', 'of', 'in', 'on',
])

const INCOMPLETE_PATTERNS = [
  /^(can|could|would) you$/,
  /^(can|could|would) you (tell|explain|show|help)( me)?( about| with)?$/,
  /^what is the difference between$/,
  /^what is difference between$/,
  /^difference between .+ and$/,
  /^how can i$/,
  /^what happens when$/,
  /^i want to know about$/,
  /^tell me about( the)?$/,
  /^could you explain( the)?$/,
]

const NOISE_FRAGMENTS = /^(uh+|um+|hm+|hmm+|ah+|oh+|mm+|huh+|yeah|okay)$/

interface UtteranceBufferOptions {
  onWaiting: () => void
  onFinalized: (utterance: string) => void
  log?: (message: string) => void
}

export class UtteranceBuffer {
  private pendingUtterance = ''
  private firstFragmentAt = 0
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly options: UtteranceBufferOptions) {}

  speechStarted(): void {
    this.options.log?.(this.pendingUtterance ? 'speech resumed' : 'speech started')
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.options.log?.('timer reset')
    }
  }

  addFragment(fragment: string): void {
    const trimmed = fragment.trim()
    if (!trimmed || NOISE_FRAGMENTS.test(this.normalize(trimmed))) {
      if (this.pendingUtterance) this.scheduleFinalization()
      return
    }

    if (!this.pendingUtterance) this.firstFragmentAt = Date.now()
    this.pendingUtterance = `${this.pendingUtterance} ${trimmed}`.trim()
    this.scheduleFinalization()
  }

  ignoredFragment(): void {
    if (this.pendingUtterance) this.scheduleFinalization()
  }

  private scheduleFinalization(): void {
    const incomplete = isLikelyIncompleteUtterance(this.pendingUtterance)
    const delay = this.getDelay(this.pendingUtterance, incomplete)
    const elapsed = Date.now() - this.firstFragmentAt
    const remainingMaximum = Math.max(0, MAX_UTTERANCE_WAIT_MS - elapsed)

    if (this.timer) clearTimeout(this.timer)
    if (remainingMaximum === 0) {
      this.finalize()
      return
    }

    this.options.onWaiting()
    this.options.log?.(
      incomplete ? 'waiting for continuation' : 'short pause',
    )
    this.timer = setTimeout(
      () => this.finalize(),
      Math.min(delay, remainingMaximum),
    )
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pendingUtterance = ''
    this.firstFragmentAt = 0
  }

  private finalize(): void {
    const utterance = this.pendingUtterance.trim()
    this.clear()
    if (!utterance) return
    this.options.log?.('utterance finalized')
    this.options.onFinalized(utterance)
  }

  private getDelay(text: string, incomplete: boolean): number {
    if (incomplete) return INCOMPLETE_SENTENCE_WAIT_MS
    if (/[?.!]\s*$/.test(text)) return SHORT_PAUSE_MS
    return NORMAL_END_OF_TURN_MS
  }

  private normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  }
}

export function isLikelyIncompleteUtterance(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return true

  const lastWord = normalized.split(' ').at(-1) ?? ''
  return (
    TRAILING_CONNECTORS.has(lastWord) ||
    INCOMPLETE_PATTERNS.some((pattern) => pattern.test(normalized))
  )
}
