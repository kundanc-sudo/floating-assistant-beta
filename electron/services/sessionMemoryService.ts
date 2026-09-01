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
const SUMMARY_MODEL = 'gpt-4o-mini'

export class SessionMemoryService {
  private summary = ''
  private recentSegments: ConversationSegment[] = []
  private recentInteractions: RecentInteraction[] = []
  private summaryInFlight = false
  private generation = 0

  constructor(
    private readonly apiKey: string,
    private readonly log: (message: string) => void = () => undefined,
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
    this.recentSegments.push(...conversation.map((segment) => ({ ...segment })))
    this.scheduleSummaryIfNeeded()
  }

  recordInteraction(
    requestId: string,
    conversation: ConversationSegment[],
    assistantAnswer: string,
    expectedGeneration: number,
  ): void {
    if (expectedGeneration !== this.generation) return
    const answer = assistantAnswer.trim()
    if (!answer) return
    this.recentInteractions.push({
      requestId,
      conversation: conversation.map((segment) => ({ ...segment })),
      assistantAnswer: answer,
      timestamp: Date.now(),
    })
    this.recentInteractions = this.recentInteractions.slice(-MAX_RECENT_INTERACTIONS)
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

    void this.summarize(previousSummary, snapshot)
      .then((nextSummary) => {
        if (generation !== this.generation) return
        this.summary = nextSummary
        const summarizedIds = new Set(snapshot.map((segment) => segment.id))
        this.recentSegments = this.recentSegments.filter(
          (segment) => !summarizedIds.has(segment.id),
        )
        this.log(`[MEMORY] summarized segments=${snapshot.length}`)
      })
      .catch(() => {
        this.log('[MEMORY] summary update failed; previous memory retained')
      })
      .finally(() => {
        if (generation !== this.generation) return
        this.summaryInFlight = false
        this.scheduleSummaryIfNeeded()
      })
  }

  private async summarize(
    previousSummary: string,
    segments: ConversationSegment[],
  ): Promise<string> {
    if (!this.apiKey) throw new Error('Missing API key')
    const transcript = segments
      .map((segment) => `${segment.source.toUpperCase()}: ${segment.text}`)
      .join('\n')
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        store: false,
        input: `Create a compact factual rolling meeting summary in English. Preserve current topics, named technologies, decisions, constraints, unresolved questions, and referents needed for follow-ups. Remove greetings, filler, repetition, and noise. Prefer newer information when topics change.\n\nPREVIOUS SUMMARY:\n${previousSummary || '(none)'}\n\nSEGMENTS TO COMPRESS:\n${transcript}`,
      }),
    })
    if (!response.ok) throw new Error(`Summary request failed: ${response.status}`)
    const body = (await response.json()) as {
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    }
    const summary = body.output
      ?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === 'output_text')
      .map((content) => content.text ?? '')
      .join('')
      .trim()
    if (!summary) throw new Error('Summary response was empty')
    return summary
  }
}
