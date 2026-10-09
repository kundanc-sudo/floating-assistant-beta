import type { ApiClient } from './apiClient'
import type { AcceptedRequest, AnswerDelta } from './realtimeAssistantService'

export type AnswerRoute = 'CONVERSATION' | 'TECHNICAL' | 'CODING'
export interface AnswerRequest {
  request: AcceptedRequest
  route: AnswerRoute
  userText: string
  instructions: string
  imageInputs?: Array<{ label: string; imageDataUrl: string }>
}

interface Events {
  onDelta: (update: AnswerDelta) => void
  onComplete: (request: AcceptedRequest, answer: string) => void
  onError: (request: AcceptedRequest, message: string) => void
}

export class ApiAnswerService {
  private controller: AbortController | null = null
  constructor(
    private readonly api: ApiClient,
    private readonly sessionId: () => string | undefined,
    private readonly events: Events,
  ) {}

  start(input: AnswerRequest) {
    this.cancelResponse()
    const sessionId = this.sessionId()
    if (!sessionId) throw new Error('Start an interview before generating an answer.')
    const controller = new AbortController()
    this.controller = controller
    void this.consume(input, sessionId, controller)
  }

  cancelResponse() { this.controller?.abort(); this.controller = null }

  private async consume(input: AnswerRequest, sessionId: string, controller: AbortController) {
    let answer = ''
    try {
      const stream = await this.api.stream('/api/v1/ai/responses', { sessionId, route: input.route, userText: input.userText, instructions: input.instructions, imageInputs: input.imageInputs }, controller.signal)
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const raw = frame.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim()
          if (!raw) continue
          const event = JSON.parse(raw) as { type: string; delta?: string }
          if (event.type === 'delta' && event.delta) {
            answer += event.delta
            this.events.onDelta({ requestId: input.request.id, requestText: input.request.text, requestType: input.request.requestType, source: input.request.source, delta: event.delta, reset: answer === event.delta })
          }
          if (event.type === 'complete') this.events.onComplete(input.request, answer)
        }
        if (done) break
      }
    } catch (error) {
      if (!controller.signal.aborted) this.events.onError(input.request, error instanceof Error ? error.message : 'The answer could not be generated.')
    } finally {
      if (this.controller === controller) this.controller = null
    }
  }
}
