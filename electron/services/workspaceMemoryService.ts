export type WorkspaceMessageType = 'user-text' | 'screen-capture' | 'assistant'

export interface WorkspaceMessage {
  id: string
  type: WorkspaceMessageType
  text: string
  timestamp: number
  requestId?: string
}

export interface ProblemState {
  problemTitle?: string
  problemSummary?: string
  language?: string
  requirements: string[]
  constraints: string[]
  currentApproach?: string
  currentComplexity?: { time?: string; space?: string }
  currentCode?: string
  solutionVersion: number
  changeHistory: Array<{ version: number; description: string; timestamp: number }>
  lastUpdatedAt: number
}

export interface WorkspaceContext {
  summary: string
  recentMessages: WorkspaceMessage[]
  currentProblem: ProblemState | null
}

const MAX_RECENT_MESSAGES = 16
const RECENT_MESSAGES_TO_KEEP = 8
const MAX_RECENT_CHARACTERS = 48000
const MAX_CONTEXT_CHARACTERS = 30000
const MAX_MESSAGE_CHARACTERS = 16000
const MAX_CHANGE_HISTORY = 8
const SUMMARY_MODEL = 'gpt-4o-mini'

export class WorkspaceMemoryService {
  private messages: WorkspaceMessage[] = []
  private summary = ''
  private currentProblem: ProblemState | null = null
  private summaryInFlight = false

  constructor(
    private readonly apiKey: string,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  addMessage(message: WorkspaceMessage): void {
    this.messages.push({ ...message, text: message.text.slice(0, MAX_MESSAGE_CHARACTERS) })
    this.scheduleSummaryIfNeeded()
  }

  getRecentMessages(): WorkspaceMessage[] {
    return this.messages.map((message) => ({ ...message }))
  }

  createContext(): WorkspaceContext {
    return {
      summary: this.summary,
      recentMessages: this.getContextMessages(),
      currentProblem: this.currentProblem
        ? {
            ...this.currentProblem,
            requirements: [...this.currentProblem.requirements],
            constraints: [...this.currentProblem.constraints],
            currentComplexity: { ...this.currentProblem.currentComplexity },
            changeHistory: this.currentProblem.changeHistory.map((change) => ({ ...change })),
          }
        : null,
    }
  }

  private getContextMessages() {
    const selected: WorkspaceMessage[] = []
    let characters = 0
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index]
      if (selected.length > 0 && characters + message.text.length > MAX_CONTEXT_CHARACTERS) break
      selected.unshift({ ...message })
      characters += message.text.length
    }
    return selected
  }

  recordAssistantResponse(message: WorkspaceMessage): void {
    this.addMessage(message)
    this.updateCanonicalProblem(message.text)
  }

  private updateCanonicalProblem(answer: string): void {
    const solutionSection = /(?:^|\n)#{0,3}\s*(?:UPDATED SOLUTION|SOLUTION|CORRECTED CODE)\s*(?:\n|$)/i.test(answer)
    const codeMatches = [...answer.matchAll(/```([\w+#.-]*)\s*\n([\s\S]*?)```/g)]
    const codeOnlyResponse = codeMatches.length === 1 &&
      answer.replace(/```[\w+#.-]*\s*\n[\s\S]*?```/g, '').trim().length === 0
    if ((!solutionSection && !codeOnlyResponse) || codeMatches.length === 0) return

    const latestCode = codeMatches.at(-1)
    if (!latestCode) return
    const startsNewProblem = /(?:^|\n)#{0,3}\s*MY THOUGHTS\s*(?:\n|$)/i.test(answer) &&
      !/(?:^|\n)#{0,3}\s*CHANGE DETECTED\s*(?:\n|$)/i.test(answer)
    const previousProblem = startsNewProblem ? null : this.currentProblem
    const language = latestCode[1]?.trim() || previousProblem?.language
    const code = latestCode[2].trim()
    if (!code || code === previousProblem?.currentCode) return

    const version = (previousProblem?.solutionVersion ?? 0) + 1
    const recommended = answer.match(/(?:OPTIMAL \/ RECOMMENDED APPROACH|RECOMMENDED)[^\n]*\n+([^\n]+)/i)?.[1]?.trim()
    const time = answer.match(/Time(?: Complexity)?:\s*(O\([^\n]+\))/i)?.[1]
    const space = answer.match(/Space(?: Complexity)?:\s*(O\([^\n]+\))/i)?.[1]
    const understanding = answer.match(/PROBLEM UNDERSTANDING\s*\n+([\s\S]*?)(?:\n\s*(?:APPROACHES|BRUTE FORCE|SOLUTION))/i)?.[1]
      ?.replace(/^\s*[-*]\s*/gm, '')
      .trim()

    this.currentProblem = {
      problemTitle: previousProblem?.problemTitle,
      problemSummary: understanding || previousProblem?.problemSummary,
      language,
      requirements: understanding
        ? understanding.split('\n').map((item) => item.trim()).filter(Boolean)
        : (previousProblem?.requirements ?? []),
      constraints: previousProblem?.constraints ?? [],
      currentApproach: recommended || previousProblem?.currentApproach,
      currentComplexity: {
        time: time || previousProblem?.currentComplexity?.time,
        space: space || previousProblem?.currentComplexity?.space,
      },
      currentCode: code,
      solutionVersion: version,
      changeHistory: [
        ...(previousProblem?.changeHistory ?? []),
        { version, description: version === 1 ? 'Initial complete solution' : 'Updated canonical solution', timestamp: Date.now() },
      ].slice(-MAX_CHANGE_HISTORY),
      lastUpdatedAt: Date.now(),
    }
    this.log(`[WORKSPACE] canonical solution updated v${version}`)
  }

  private scheduleSummaryIfNeeded(): void {
    const characters = this.messages.reduce((total, message) => total + message.text.length, 0)
    if (
      this.summaryInFlight ||
      (this.messages.length <= MAX_RECENT_MESSAGES && characters <= MAX_RECENT_CHARACTERS)
    ) return
    const compressCount = Math.max(1, this.messages.length - RECENT_MESSAGES_TO_KEEP)
    const snapshot = this.messages.slice(0, compressCount)
    const snapshotIds = new Set(snapshot.map((message) => message.id))
    const previousSummary = this.summary
    this.summaryInFlight = true
    void this.summarize(previousSummary, snapshot)
      .then((summary) => {
        this.summary = summary
        this.messages = this.messages.filter((message) => !snapshotIds.has(message.id))
        this.log(`[WORKSPACE] summarized messages=${snapshot.length}`)
      })
      .catch(() => this.log('[WORKSPACE] summary failed; existing memory retained'))
      .finally(() => {
        this.summaryInFlight = false
        this.scheduleSummaryIfNeeded()
      })
  }

  private async summarize(previous: string, messages: WorkspaceMessage[]) {
    if (!this.apiKey) throw new Error('Missing API key')
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        store: false,
        input: `Compact this coding workspace history. Preserve the active problem, requirements, language, approaches, solution changes, user preferences, unresolved errors, and referents needed for follow-ups. Do not include filler.\n\nPREVIOUS SUMMARY:\n${previous || '(none)'}\n\nMESSAGES:\n${messages.map((message) => `${message.type.toUpperCase()}: ${message.text}`).join('\n\n')}`,
      }),
    })
    if (!response.ok) throw new Error(`Workspace summary failed: ${response.status}`)
    const body = (await response.json()) as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }
    const summary = body.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('').trim()
    if (!summary) throw new Error('Workspace summary was empty')
    return summary
  }
}
