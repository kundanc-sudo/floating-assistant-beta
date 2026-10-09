import type {
  AcceptedRequest,
  AnswerDelta,
} from './realtimeAssistantService'

export type AnswerRoute = 'CONVERSATION' | 'TECHNICAL' | 'CODING'
export interface ImageInput {
  label: string
  imageDataUrl: string
}

export interface AnswerRequest {
  request: AcceptedRequest
  route: AnswerRoute
  userText: string
  instructions: string
  imageInputs?: ImageInput[]
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

class RetryableAnswerError extends Error {}

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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const completeText = await this.streamAttempt(input, controller, startedAt)
        if (this.activeRequestId !== input.request.id) return
        this.log(`[PERF] response completed route=${input.route} total=${Math.round(performance.now() - startedAt)}ms`)
        this.activeRequestId = null
        this.controller = null
        this.events.onComplete(input.request, completeText)
        return
      } catch (error) {
        if (controller.signal.aborted || this.activeRequestId !== input.request.id) return
        if (attempt === 0 && error instanceof RetryableAnswerError) {
          this.log(`[ANSWER] transient failure; retrying once requestId=${input.request.id}`)
          continue
        }
        this.activeRequestId = null
        this.controller = null
        this.events.onError(
          input.request,
          error instanceof Error ? error.message : 'The answer could not be generated.',
        )
        return
      }
    }
  }

  private async streamAttempt(
    input: AnswerRequest,
    controller: AbortController,
    startedAt: number,
  ): Promise<string> {
    let firstDeltaAt: number | null = null
    let completeText = ''
    try {
      const dispatchedAt = performance.now()
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
            content: buildResponseContent(input.userText, input.imageInputs ?? []),
          }],
        }),
      })
      this.trace(input.request.traceTurnId, 'RESPONSE_HEADERS')
      this.log(`[PERF] response-headers route=${input.route} dispatch-to-headers=${Math.round(performance.now() - dispatchedAt)}ms`)
      if (!response.ok) {
        const detail = await response.text()
        const message = this.formatHttpError(response.status, detail)
        if (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500) {
          throw new RetryableAnswerError(message)
        }
        throw new Error(message)
      }
      if (!response.body) throw new RetryableAnswerError('The answer stream was empty.')

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
            if (this.activeRequestId !== input.request.id) return completeText
            completeText += event.delta
            if (firstDeltaAt === null) {
              firstDeltaAt = performance.now()
              this.trace(input.request.traceTurnId, 'FIRST_TOKEN')
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
      if (this.activeRequestId !== input.request.id) return completeText
      if (!completeText.trim()) throw new RetryableAnswerError('OpenAI returned an empty answer.')
      return completeText
    } catch (error) {
      if (
        error instanceof TypeError &&
        !completeText &&
        !controller.signal.aborted
      ) {
        throw new RetryableAnswerError('The OpenAI connection was interrupted before the answer started.')
      }
      throw error
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

  private trace(turnId: string | undefined, event: string) {
    if (this.options.development && turnId) {
      console.info(`[TURN_TRACE] turnId=${turnId} event=${event} timestamp=${Date.now()}`)
    }
  }
}

export function buildResponseContent(userText: string, imageInputs: ImageInput[]) {
  return [
    { type: 'input_text', text: userText },
    ...imageInputs.flatMap((image) => [
      { type: 'input_text', text: image.label },
      { type: 'input_image', image_url: image.imageDataUrl, detail: 'high' },
    ]),
  ]
}
