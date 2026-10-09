export const SHORT_PAUSE_MS = 250
export const NORMAL_END_OF_TURN_MS = 500
export const INCOMPLETE_SENTENCE_WAIT_MS = 1800
export const MAX_UTTERANCE_WAIT_MS = 45_000

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
  onFinalized: (utterance: string, timing: UtteranceTiming) => void
  log?: (message: string) => void
  now?: () => number
  scheduler?: {
    setTimeout: (callback: () => void, delayMs: number) => unknown
    clearTimeout: (handle: unknown) => void
  }
}

export interface UtteranceTiming {
  turnId?: string
  speechStoppedAt?: number
  finalTranscriptAt: number
  utteranceFinalizedAt: number
}

export class UtteranceBuffer {
  private pendingUtterance = ''
  private firstFragmentAt = 0
  private pendingTurnId: string | undefined
  private lastSpeechStoppedAt: number | undefined
  private lastFinalTranscriptAt = 0
  private timer: unknown | null = null
  private readonly now: () => number
  private readonly scheduler: NonNullable<UtteranceBufferOptions['scheduler']>

  constructor(private readonly options: UtteranceBufferOptions) {
    this.now = options.now ?? Date.now
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    }
  }

  speechStopped(timestamp = this.now()): void {
    this.lastSpeechStoppedAt = timestamp
  }

  speechStarted(): void {
    this.options.log?.(this.pendingUtterance ? 'speech resumed' : 'speech started')
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer)
      this.timer = null
      this.options.log?.('timer reset')
    }
  }

  addFragment(fragment: string, finalTranscriptAt = this.now(), turnId?: string): string | undefined {
    const trimmed = fragment.trim()
    if (!trimmed || NOISE_FRAGMENTS.test(this.normalize(trimmed))) {
      if (this.pendingUtterance) this.scheduleFinalization()
      return this.pendingTurnId
    }

    if (!this.pendingUtterance) {
      this.firstFragmentAt = finalTranscriptAt
      this.pendingTurnId = turnId
    }
    this.lastFinalTranscriptAt = finalTranscriptAt
    this.pendingUtterance = `${this.pendingUtterance} ${trimmed}`.trim()
    this.scheduleFinalization()
    return this.pendingTurnId
  }

  ignoredFragment(): void {
    if (this.pendingUtterance) this.scheduleFinalization()
  }

  private scheduleFinalization(): void {
    const incomplete = isLikelyIncompleteUtterance(this.pendingUtterance)
    const delay = this.getDelay(this.pendingUtterance, incomplete)
    const elapsed = this.now() - this.firstFragmentAt
    const remainingMaximum = Math.max(0, MAX_UTTERANCE_WAIT_MS - elapsed)

    if (this.timer) this.scheduler.clearTimeout(this.timer)
    if (remainingMaximum === 0) {
      this.finalize()
      return
    }

    this.options.onWaiting()
    this.options.log?.(
      incomplete ? 'waiting for continuation' : 'short pause',
    )
    this.timer = this.scheduler.setTimeout(
      () => this.finalize(),
      Math.min(delay, remainingMaximum),
    )
  }

  clear(): void {
    if (this.timer) this.scheduler.clearTimeout(this.timer)
    this.timer = null
    this.pendingUtterance = ''
    this.firstFragmentAt = 0
    this.pendingTurnId = undefined
    this.lastSpeechStoppedAt = undefined
    this.lastFinalTranscriptAt = 0
  }

  private finalize(): void {
    const utterance = this.pendingUtterance.trim()
    const timing: UtteranceTiming = {
      turnId: this.pendingTurnId,
      speechStoppedAt: this.lastSpeechStoppedAt,
      finalTranscriptAt: this.lastFinalTranscriptAt || this.now(),
      utteranceFinalizedAt: this.now(),
    }
    this.clear()
    if (!utterance) return
    this.options.log?.('utterance finalized')
    this.options.onFinalized(utterance, timing)
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
  if (/(?:\.{3,}|…)[\s"')\]]*$/.test(text.trim())) return true
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
