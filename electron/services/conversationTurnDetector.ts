import type { AudioSource } from './realtimeAssistantService'

// Transcript stability belongs to UtteranceBuffer. Once a turn reaches this
// detector it can be classified immediately without a second debounce.
export const AUTO_ASSIST_STABILITY_MS = 0
export const TURN_DISPATCH_WATCHDOG_MS = 3000
const DUPLICATE_WINDOW_MS = 30_000
const MAX_RECENT_TRIGGERS = 12

export type AutoAssistStatus =
  | 'OFF'
  | 'LISTENING'
  | 'QUESTION_DETECTED'
  | 'WAITING'
  | 'GENERATING'

export interface AutoAssistTrigger {
  id: string
  segmentId: string
  source: AudioSource
  timestamp: number
  speechStoppedAt?: number
  finalTranscriptAt?: number
  utteranceFinalizedAt?: number
  autoAcceptedAt: number
}

interface FinalConversationSegment {
  id: string
  text: string
  source: AudioSource
  timestamp: number
}

export interface FinalTurnTiming {
  speechStoppedAt?: number
  finalTranscriptAt?: number
  utteranceFinalizedAt?: number
}

interface Scheduler {
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

interface ConversationTurnDetectorOptions {
  onTrigger: (trigger: AutoAssistTrigger) => void
  onStatus?: (status: AutoAssistStatus) => void
  log?: (message: string) => void
  trace?: (turnId: string, event: string, metadata?: string) => void
  now?: () => number
  createId?: () => string
  scheduler?: Scheduler
  stabilityMs?: number
}

const FILLER_WORDS = new Set([
  'yeah', 'yes', 'okay', 'ok', 'right', 'perfect', 'thank', 'you', 'thanks',
  'makes', 'sense', 'cool', 'uh', 'huh', 'um', 'hm', 'hmm', 'exactly',
  'interesting', 'so', 'great', 'sure', 'no', 'got', 'it', 'hello', 'bye',
])

const FILLER_PHRASES = new Set([
  'okay', 'yeah', 'yes', 'no', 'right', 'perfect', 'great', 'thank you',
  'thanks', 'got it', 'makes sense', 'uh', 'um', 'hmm', 'hello', 'bye',
])

const QUESTION_OPENERS = /^(?:who|what|when|where|why|how|which|whose|can|could|would|will|do|does|did|is|are|was|were|have|has|had|should|may|might|whats|wheres|whos)\b/
const REQUEST_OPENERS = /^(?:please\s+)?(?:tell me|explain|walk me through|describe|give me|write|implement|create|compare|discuss|outline|summari[sz]e|show me|help me|optimi[sz]e)\b/
const CONTEXTUAL_REQUESTS = [
  /^(?:and\s+)?(?:your\s+)?(?:role|experience|responsibilities|background|project)(?:\s+there|\s+with\s+.+)?$/,
  /^(?:biggest|most difficult|current)\s+(?:challenge|situation|responsibilities|project)(?:\s+you\s+faced)?$/,
  /^(?:time\s+|space\s+)?complexity$/,
  /^reason for leaving$/,
  /^and then$/,
  /^could you elaborate$/,
  /^tell me (?:a little )?more(?: about that)?$/,
  /^what about\s+.+$/,
  /^any experience with\s+.+$/,
  /^experience (?:working )?with\s+.+$/,
]

export class ConversationTurnDetector {
  private enabled = false
  private triggerSource: AudioSource = 'microphone'
  private timer: unknown | null = null
  private candidate: FinalConversationSegment | null = null
  private candidateTiming: FinalTurnTiming | null = null
  private stableCandidate: FinalConversationSegment | null = null
  private stableTiming: FinalTurnTiming | null = null
  private awaitingTriggerId: string | null = null
  private awaitingTrigger: AutoAssistTrigger | null = null
  private awaitingFingerprint: string | null = null
  private dispatchWatchdog: unknown | null = null
  private activeGenerationId: string | null = null
  private activeFingerprint: string | null = null
  private recentTriggers: Array<{ fingerprint: string; timestamp: number }> = []
  private readonly now: () => number
  private readonly createId: () => string
  private readonly scheduler: Scheduler
  private readonly stabilityMs: number

  constructor(private readonly options: ConversationTurnDetectorOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? (() => crypto.randomUUID())
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    }
    this.stabilityMs = options.stabilityMs ?? AUTO_ASSIST_STABILITY_MS
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.clearTemporaryState()
      this.emitStatus('OFF')
      return
    }
    this.emitStatus(this.activeGenerationId ? 'GENERATING' : 'LISTENING')
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setTriggerSource(source: AudioSource): void {
    if (this.triggerSource === source) return
    this.triggerSource = source
    this.cancelPending('trigger source changed')
  }

  partialTranscript(): void {
    // Partial transcript is deliberately UI-only and can never trigger.
  }

  speechStarted(source: AudioSource): void {
    if (!this.enabled) {
      this.options.log?.('ignored - disabled')
      return
    }
    if (source !== this.triggerSource) {
      this.options.log?.(`ignored - non-trigger source=${source}`)
      return
    }
    if (this.timer || this.stableCandidate) {
      this.cancelPending('speech resumed')
      this.options.log?.('cancelled - speech resumed')
    }
  }

  finalSegment(segment: FinalConversationSegment, timing: FinalTurnTiming = {}): void {
    this.options.trace?.(segment.id, 'DETECTOR_RECEIVED', `source=${segment.source}`)
    if (!this.enabled) {
      this.options.log?.('ignored - disabled')
      this.options.trace?.(segment.id, 'DETECTOR_DECISION', 'actionable=false reason=disabled')
      return
    }
    if (segment.source !== this.triggerSource) {
      const reason = segment.source === 'microphone' && this.triggerSource === 'system'
        ? 'mic-auto-suppressed'
        : 'non-trigger-source'
      this.options.log?.(`ignored - source=${segment.source} autoEligible=false reason=${reason}`)
      this.options.trace?.(
        segment.id,
        'DETECTOR_DECISION',
        `source=${segment.source} autoEligible=false reason=${reason}`,
      )
      return
    }
    const normalized = normalizeTurnText(segment.text)
    const classification = classifyAnswerableTurn(normalized)
    if (!classification.actionable) {
      this.options.log?.(classification.reason)
      this.options.trace?.(
        segment.id,
        'DETECTOR_DECISION',
        `actionable=false reason=${classification.reason}`,
      )
      return
    }

    this.cancelTimer()
    this.candidate = { ...segment }
    this.candidateTiming = { ...timing }
    this.stableCandidate = null
    this.stableTiming = null
    this.options.log?.(`source=${segment.source} actionable=true autoEligible=true reason=${classification.reason}`)
    this.emitStatus('QUESTION_DETECTED')
    if (this.stabilityMs === 0) {
      this.onStable()
      return
    }
    this.timer = this.scheduler.setTimeout(() => this.onStable(), this.stabilityMs)
    this.options.log?.(`trigger scheduled (${this.stabilityMs}ms)`)
  }

  manualGenerationStarted(requestId?: string): void {
    const consumed = Boolean(this.timer || this.candidate || this.stableCandidate || this.awaitingTriggerId)
    this.clearTemporaryState()
    if (requestId) this.activeGenerationId = requestId
    if (consumed) this.options.log?.('manual generation consumed pending trigger')
    if (this.enabled) this.emitStatus(requestId ? 'GENERATING' : 'LISTENING')
  }

  generationStarted(requestId: string, triggerId?: string): void {
    if (triggerId && this.awaitingTriggerId && triggerId !== this.awaitingTriggerId) return
    this.cancelDispatchWatchdog()
    this.awaitingTriggerId = null
    this.awaitingTrigger = null
    this.activeFingerprint = this.awaitingFingerprint
    this.awaitingFingerprint = null
    this.activeGenerationId = requestId
    if (this.enabled) this.emitStatus('GENERATING')
  }

  triggerRejected(triggerId: string): void {
    if (this.awaitingTriggerId !== triggerId) return
    this.cancelDispatchWatchdog()
    this.awaitingTriggerId = null
    this.awaitingTrigger = null
    if (this.awaitingFingerprint) this.forgetFingerprint(this.awaitingFingerprint)
    this.awaitingFingerprint = null
    this.options.log?.('trigger rejected')
    if (this.enabled) this.emitStatus(this.activeGenerationId ? 'GENERATING' : 'LISTENING')
  }

  generationFinished(requestId: string): void {
    if (this.activeGenerationId !== requestId) return
    this.activeGenerationId = null
    this.activeFingerprint = null
    if (!this.enabled) return
    if (this.stableCandidate) {
      const candidate = this.stableCandidate
      const timing = this.stableTiming
      this.stableCandidate = null
      this.stableTiming = null
      this.accept(candidate, timing ?? {})
      return
    }
    this.emitStatus('LISTENING')
  }

  generationFailed(requestId: string): void {
    if (this.activeGenerationId !== requestId) return
    if (this.activeFingerprint) this.forgetFingerprint(this.activeFingerprint)
    this.generationFinished(requestId)
  }

  reset(): void {
    this.clearTemporaryState()
    this.recentTriggers = []
    if (this.enabled) this.emitStatus(this.activeGenerationId ? 'GENERATING' : 'LISTENING')
  }

  stop(): void {
    this.clearTemporaryState()
    this.activeGenerationId = null
    this.activeFingerprint = null
    this.recentTriggers = []
    if (this.enabled) this.emitStatus('LISTENING')
  }

  private onStable(): void {
    this.timer = null
    const candidate = this.candidate
    const timing = this.candidateTiming
    this.candidate = null
    this.candidateTiming = null
    if (!candidate || !this.enabled) return
    if (this.activeGenerationId || this.awaitingTriggerId) {
      this.stableCandidate = candidate
      this.stableTiming = timing
      this.options.log?.('trigger queued - generation active')
      this.options.trace?.(candidate.id, 'DETECTOR_DECISION', 'actionable=true generationActive=true')
      this.options.trace?.(candidate.id, 'QUEUED_OR_DISPATCHED', 'state=queued')
      this.emitStatus('WAITING')
      return
    }
    this.accept(candidate, timing ?? {})
  }

  private accept(candidate: FinalConversationSegment, timing: FinalTurnTiming = {}): void {
    const now = this.now()
    const fingerprint = normalizeTurnText(candidate.text)
    this.recentTriggers = this.recentTriggers
      .filter((entry) => now - entry.timestamp < DUPLICATE_WINDOW_MS)
      .slice(-(MAX_RECENT_TRIGGERS - 1))
    if (this.recentTriggers.some((entry) => entry.fingerprint === fingerprint)) {
      this.options.log?.('duplicate')
      this.options.trace?.(candidate.id, 'DETECTOR_DECISION', 'actionable=false reason=duplicate')
      this.emitStatus('LISTENING')
      return
    }

    this.recentTriggers.push({ fingerprint, timestamp: now })
    const trigger: AutoAssistTrigger = {
      id: this.createId(),
      segmentId: candidate.id,
      source: candidate.source,
      timestamp: now,
      ...timing,
      autoAcceptedAt: now,
    }
    this.awaitingTriggerId = trigger.id
    this.awaitingTrigger = trigger
    this.awaitingFingerprint = fingerprint
    this.options.log?.('trigger accepted')
    this.options.trace?.(candidate.id, 'DETECTOR_DECISION', 'actionable=true generationActive=false')
    this.options.trace?.(candidate.id, 'QUEUED_OR_DISPATCHED', 'state=dispatched')
    this.emitStatus('WAITING')
    this.options.onTrigger(trigger)
    this.scheduleDispatchWatchdog(trigger)
  }

  private cancelPending(reason: string): void {
    this.cancelTimer()
    this.candidate = null
    this.candidateTiming = null
    this.stableCandidate = null
    this.stableTiming = null
    if (reason && this.enabled && !this.activeGenerationId && !this.awaitingTriggerId) {
      this.emitStatus('LISTENING')
    }
  }

  private clearTemporaryState(): void {
    this.cancelTimer()
    this.candidate = null
    this.candidateTiming = null
    this.stableCandidate = null
    this.stableTiming = null
    this.awaitingTriggerId = null
    this.awaitingTrigger = null
    this.awaitingFingerprint = null
    this.cancelDispatchWatchdog()
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer)
    this.timer = null
  }

  private scheduleDispatchWatchdog(trigger: AutoAssistTrigger): void {
    this.cancelDispatchWatchdog()
    this.dispatchWatchdog = this.scheduler.setTimeout(() => {
      this.dispatchWatchdog = null
      if (
        !this.enabled ||
        this.activeGenerationId ||
        this.awaitingTriggerId !== trigger.id ||
        this.awaitingTrigger?.id !== trigger.id
      ) return
      this.options.log?.(`TURN_DISPATCH_STALLED turnId=${trigger.segmentId}`)
      this.options.trace?.(trigger.segmentId, 'TURN_DISPATCH_STALLED', 'recovery=redispatch-once')
      this.options.onTrigger(trigger)
    }, TURN_DISPATCH_WATCHDOG_MS)
  }

  private cancelDispatchWatchdog(): void {
    if (this.dispatchWatchdog !== null) this.scheduler.clearTimeout(this.dispatchWatchdog)
    this.dispatchWatchdog = null
  }

  private emitStatus(status: AutoAssistStatus): void {
    this.options.onStatus?.(status)
  }

  private forgetFingerprint(fingerprint: string): void {
    this.recentTriggers = this.recentTriggers.filter((entry) => entry.fingerprint !== fingerprint)
  }
}

export function normalizeTurnText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isAnswerableTurn(normalizedText: string): boolean {
  return classifyAnswerableTurn(normalizedText).actionable
}

export function classifyAnswerableTurn(normalizedText: string): {
  actionable: boolean
  reason: 'empty' | 'filler' | 'noise' | 'explicit' | 'meaningful-fallback'
} {
  if (!normalizedText) return { actionable: false, reason: 'empty' }
  if (isFillerTurn(normalizedText)) return { actionable: false, reason: 'filler' }
  const classifiableText = stripLeadingDiscourse(normalizedText)
  if (!classifiableText || isFillerTurn(classifiableText)) {
    return { actionable: false, reason: 'filler' }
  }
  if (QUESTION_OPENERS.test(classifiableText) ||
    REQUEST_OPENERS.test(classifiableText) ||
    CONTEXTUAL_REQUESTS.some((pattern) => pattern.test(classifiableText))) {
    return { actionable: true, reason: 'explicit' }
  }

  const lexicalWords = classifiableText.split(' ').filter(Boolean)
  if (lexicalWords.length === 0) return { actionable: false, reason: 'empty' }
  if (lexicalWords.length === 1 && lexicalWords[0].length < 2) {
    return { actionable: false, reason: 'noise' }
  }
  return { actionable: true, reason: 'meaningful-fallback' }
}

export function isFillerTurn(normalizedText: string): boolean {
  if (!normalizedText) return true
  if (FILLER_PHRASES.has(normalizedText)) return true
  return normalizedText.split(' ').every((word) => FILLER_WORDS.has(word))
}

function stripLeadingDiscourse(normalizedText: string): string {
  let result = normalizedText
  while (true) {
    const next = result.replace(
      /^(?:okay|ok|so|well|right|yeah|and|but|actually|basically|alright|all right)\s+/,
      '',
    )
    if (next === result) return result
    result = next
  }
}
