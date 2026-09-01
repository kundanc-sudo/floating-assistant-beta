import type {
  AcceptedRequest,
  AnswerDelta,
} from './realtimeAssistantService'

export type AnswerRoute = 'CONVERSATION' | 'TECHNICAL' | 'CODING'

export interface AnswerRequest {
  request: AcceptedRequest
  route: AnswerRoute
  userText: string
  instructions: string
  imageDataUrl?: string
}

interface AnswerServiceEvents {
  onDelta: (update: AnswerDelta) => void
  onComplete: (request: AcceptedRequest, answer: string) => void
  onError: (request: AcceptedRequest, message: string) => void
}

interface AnswerServiceOptions {
  fastModel: string
  codingModel: string
  fastReasoningEffort: string
  codingReasoningEffort: string
  development: boolean
}

interface ResponseStreamEvent {
  type?: string
  delta?: string
  response?: {
    error?: { message?: string } | null
    incomplete_details?: { reason?: string } | null
  }
  error?: { message?: string }
}

export class AnswerService {
  private controller: AbortController | null = null
  private activeRequestId: string | null = null

  constructor(
    private readonly apiKey: string,
    private readonly options: AnswerServiceOptions,
    private readonly events: AnswerServiceEvents,
  ) {}

  start(input: AnswerRequest): void {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is missing from D:\\project\\.env.')
    this.cancelResponse()
    const controller = new AbortController()
    this.controller = controller
    this.activeRequestId = input.request.id
    void this.stream(input, controller)
  }

  cancelResponse(): void {
    this.controller?.abort()
    this.controller = null
    this.activeRequestId = null
  }

  private async stream(input: AnswerRequest, controller: AbortController) {
    const startedAt = performance.now()
    let firstDeltaAt: number | null = null
    let completeText = ''
    try {
      const coding = input.route === 'CODING'
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: coding ? this.options.codingModel : this.options.fastModel,
          store: false,
          stream: true,
          stream_options: { include_obfuscation: false },
          instructions: input.instructions,
          reasoning: {
            effort: coding
              ? this.options.codingReasoningEffort
              : this.options.fastReasoningEffort,
          },
          text: { verbosity: coding ? 'medium' : 'low' },
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: input.userText },
              ...(input.imageDataUrl
                ? [{ type: 'input_image', image_url: input.imageDataUrl, detail: 'high' }]
                : []),
            ],
          }],
        }),
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(this.formatHttpError(response.status, detail))
      }
      if (!response.body) throw new Error('The answer stream was empty.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          if (!data || data === '[DONE]') continue
          let event: ResponseStreamEvent
          try {
            event = JSON.parse(data) as ResponseStreamEvent
          } catch {
            continue
          }
          if (event.type === 'response.output_text.delta' && event.delta) {
            if (this.activeRequestId !== input.request.id) return
            completeText += event.delta
            if (firstDeltaAt === null) {
              firstDeltaAt = performance.now()
              this.log(`[PERF] first response delta route=${input.route} request-to-first-token=${Math.round(firstDeltaAt - startedAt)}ms`)
            }
            this.events.onDelta({
              requestId: input.request.id,
              requestText: input.request.text,
              requestType: input.request.requestType,
              source: input.request.source,
              delta: event.delta,
              reset: completeText === event.delta,
            })
          }
          if (event.type === 'response.failed' || event.type === 'error') {
            throw new Error(
              event.response?.error?.message ??
                event.error?.message ??
                'OpenAI could not generate the answer.',
            )
          }
          if (event.type === 'response.incomplete') {
            throw new Error(
              `The answer was incomplete${event.response?.incomplete_details?.reason ? `: ${event.response.incomplete_details.reason}` : '.'}`,
            )
          }
        }
        if (done) break
      }
      if (this.activeRequestId !== input.request.id) return
      if (!completeText.trim()) throw new Error('OpenAI returned an empty answer.')
      this.log(`[PERF] response completed route=${input.route} total=${Math.round(performance.now() - startedAt)}ms`)
      this.activeRequestId = null
      this.controller = null
      this.events.onComplete(input.request, completeText)
    } catch (error) {
      if (controller.signal.aborted || this.activeRequestId !== input.request.id) return
      this.activeRequestId = null
      this.controller = null
      this.events.onError(
        input.request,
        error instanceof Error ? error.message : 'The answer could not be generated.',
      )
    }
  }

  private formatHttpError(status: number, detail: string) {
    if (status === 401) return 'OpenAI authentication failed. Check OPENAI_API_KEY in .env.'
    try {
      const body = JSON.parse(detail) as { error?: { message?: string } }
      if (body.error?.message) return body.error.message
    } catch {
      // Ignore non-JSON error bodies.
    }
    return `OpenAI answer request failed with HTTP ${status}.`
  }

  private log(message: string) {
    if (this.options.development) console.info(message)
  }
}
