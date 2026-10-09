import type { AudioSource } from './realtimeAssistantService'

export interface ConversationSegment {
  id: string
  text: string
  source: AudioSource
  timestamp: number
}

export interface RecentInteraction {
  requestId: string
  conversation: ConversationSegment[]
  assistantAnswer: string
  timestamp: number
}

export interface AnswerContext {
  sessionSummary: string
  recentConversation: ConversationSegment[]
  currentConversation: ConversationSegment[]
  recentInteractions: RecentInteraction[]
}

const MAX_RECENT_SEGMENTS = 24
const MAX_RECENT_CHARACTERS = 8000
const RECENT_SEGMENTS_TO_KEEP = 12
const MAX_RECENT_INTERACTIONS = 3
const MAX_RETAINED_SEGMENTS_AFTER_SUMMARY_FAILURE = 48
const MAX_RETAINED_CHARACTERS_AFTER_SUMMARY_FAILURE = 16_000
export class SessionMemoryService {
  private summary = ''
  private recentSegments: ConversationSegment[] = []
  private recentInteractions: RecentInteraction[] = []
  private summaryInFlight = false
  private generation = 0

  constructor(
    private readonly log: (message: string) => void = () => undefined,
    private readonly remoteSummarize?: (previousSummary: string, segments: ConversationSegment[]) => Promise<string>,
  ) {}

  reset(): void {
    this.generation += 1
    this.summary = ''
    this.recentSegments = []
    this.recentInteractions = []
    this.summaryInFlight = false
    this.log('[MEMORY] reset')
  }

  getGeneration(): number {
    return this.generation
  }

  getRecentInteractions(): RecentInteraction[] {
    return this.recentInteractions.map((interaction) => ({
      ...interaction,
      conversation: interaction.conversation.map((segment) => ({ ...segment })),
    }))
  }

  createAnswerContext(currentConversation: ConversationSegment[]): AnswerContext {
    const recentIds = new Set(this.recentSegments.map((segment) => segment.id))
    return {
      sessionSummary: this.summary,
      recentConversation: this.recentSegments.map((segment) => ({ ...segment })),
      currentConversation: currentConversation.map((segment) => ({ ...segment })),
      recentInteractions: this.recentInteractions.map((interaction) => ({
        ...interaction,
        conversation: interaction.conversation
          .filter((segment) => !recentIds.has(segment.id))
          .map((segment) => ({ ...segment })),
      })),
    }
  }

  commitConversation(conversation: ConversationSegment[]): void {
    const existingIds = new Set(this.recentSegments.map((segment) => segment.id))
    this.recentSegments.push(
      ...conversation
        .filter((segment) => !existingIds.has(segment.id))
        .map((segment) => ({ ...segment })),
    )
    this.scheduleSummaryIfNeeded()
  }

  recordInteraction(
    requestId: string,
    conversation: ConversationSegment[],
    assistantAnswer: string,
    expectedGeneration: number,
  ): RecentInteraction | null {
    if (expectedGeneration !== this.generation) return null
    const answer = assistantAnswer.trim()
    if (!answer) return null
    const interaction: RecentInteraction = {
      requestId,
      conversation: conversation.map((segment) => ({ ...segment })),
      assistantAnswer: answer,
      timestamp: Date.now(),
    }
    this.recentInteractions.push(interaction)
    this.recentInteractions = this.recentInteractions.slice(-MAX_RECENT_INTERACTIONS)
    return {
      ...interaction,
      conversation: interaction.conversation.map((segment) => ({ ...segment })),
    }
  }

  private scheduleSummaryIfNeeded(): void {
    const characters = this.recentSegments.reduce(
      (total, segment) => total + segment.text.length,
      0,
    )
    if (
      this.summaryInFlight ||
      (this.recentSegments.length <= MAX_RECENT_SEGMENTS &&
        characters <= MAX_RECENT_CHARACTERS)
    ) return

    const compressCount = Math.max(
      1,
      this.recentSegments.length - RECENT_SEGMENTS_TO_KEEP,
    )
    const snapshot = this.recentSegments
      .slice(0, compressCount)
      .map((segment) => ({ ...segment }))
    const generation = this.generation
    const previousSummary = this.summary
    this.summaryInFlight = true

    let summarySucceeded = false
    void this.summarize(previousSummary, snapshot)
      .then((nextSummary) => {
        if (generation !== this.generation) return
        summarySucceeded = true
        this.summary = nextSummary
        const summarizedIds = new Set(snapshot.map((segment) => segment.id))
        this.recentSegments = this.recentSegments.filter(
          (segment) => !summarizedIds.has(segment.id),
        )
        this.log(`[MEMORY] summarized segments=${snapshot.length}`)
      })
      .catch(() => {
        if (generation === this.generation) this.boundRecentSegmentsAfterFailure()
        this.log('[MEMORY] summary update failed; previous memory retained')
      })
      .finally(() => {
        if (generation !== this.generation) return
        this.summaryInFlight = false
        if (summarySucceeded) this.scheduleSummaryIfNeeded()
      })
  }

  private boundRecentSegmentsAfterFailure(): void {
    const retained: ConversationSegment[] = []
    let characters = 0
    for (let index = this.recentSegments.length - 1; index >= 0; index -= 1) {
      const segment = this.recentSegments[index]
      if (
        retained.length >= MAX_RETAINED_SEGMENTS_AFTER_SUMMARY_FAILURE ||
        (retained.length > 0 && characters + segment.text.length > MAX_RETAINED_CHARACTERS_AFTER_SUMMARY_FAILURE)
      ) break
      retained.unshift(segment)
      characters += segment.text.length
    }
    this.recentSegments = retained
  }

  private async summarize(
    previousSummary: string,
    segments: ConversationSegment[],
  ): Promise<string> {
    if (!this.remoteSummarize) throw new Error('Backend summary service is unavailable')
    return this.remoteSummarize(previousSummary, segments)
  }
}
