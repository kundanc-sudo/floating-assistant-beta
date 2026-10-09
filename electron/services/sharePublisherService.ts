import type { AnswerDelta, AcceptedRequest } from './realtimeAssistantService'

export type SharingState = 'OFF' | 'STARTING' | 'ON' | 'UNAVAILABLE'

export interface SharingStatus {
  state: SharingState
  sessionId?: string
  viewerToken?: string
  viewerUrl?: string
  expiresAt?: number
  error?: string
}

interface CreatedSession {
  sessionId: string
  viewerToken: string
  hostSecret: string
  viewerUrl: string
  expiresAt: number
}

export class SharePublisherService {
  private session: CreatedSession | null = null
  private status: SharingStatus = { state: 'OFF' }
  private publishQueue: Promise<void> = Promise.resolve()
  private publishedRequestId: string | null = null

  constructor(
    private readonly serverUrl: string,
    private readonly onStatus: (status: SharingStatus) => void,
    private readonly development: boolean,
  ) {}

  getStatus() {
    return { ...this.status }
  }

  async start() {
    if (this.session) return this.getStatus()
    this.setStatus({ state: 'STARTING' })
    try {
      const response = await fetch(`${this.serverUrl}/api/share/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error(`Sharing server returned HTTP ${response.status}.`)
      const session = await response.json() as Partial<CreatedSession>
      if (
        !session.sessionId || !session.viewerToken || !session.hostSecret ||
        !session.viewerUrl || typeof session.expiresAt !== 'number'
      ) throw new Error('Sharing server returned an invalid session.')
      this.session = session as CreatedSession
      this.publishedRequestId = null
      this.setStatus({
        state: 'ON',
        sessionId: this.session.sessionId,
        viewerToken: this.session.viewerToken,
        viewerUrl: this.session.viewerUrl,
        expiresAt: this.session.expiresAt,
      })
    } catch (error) {
      this.session = null
      this.setStatus({
        state: 'UNAVAILABLE',
        error: error instanceof Error ? error.message : 'Sharing is unavailable.',
      })
    }
    return this.getStatus()
  }

  async stop() {
    const session = this.session
    this.session = null
    this.publishedRequestId = null
    this.publishQueue = Promise.resolve()
    this.setStatus({ state: 'OFF' })
    if (!session) return this.getStatus()
    try {
      await fetch(`${this.serverUrl}/api/share/session/${encodeURIComponent(session.sessionId)}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.hostSecret}` },
        signal: AbortSignal.timeout(5000),
      })
    } catch (error) {
      this.warn(error)
    }
    return this.getStatus()
  }

  publishDelta(update: AnswerDelta) {
    const session = this.session
    if (!session) return
    if (this.publishedRequestId !== update.requestId) {
      this.publishedRequestId = update.requestId
      this.enqueue(session, { type: 'response_start', requestId: update.requestId })
    }
    this.enqueue(session, {
      type: 'response_delta',
      requestId: update.requestId,
      delta: update.delta,
    })
  }

  publishComplete(request: AcceptedRequest) {
    const session = this.session
    if (!session || this.publishedRequestId !== request.id) return
    this.enqueue(session, { type: 'response_complete', requestId: request.id })
  }

  private enqueue(session: CreatedSession, event: object) {
    this.publishQueue = this.publishQueue
      .then(async () => {
        if (this.session !== session) return
        const response = await fetch(
          `${this.serverUrl}/api/share/session/${encodeURIComponent(session.sessionId)}/publish`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.hostSecret}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
            signal: AbortSignal.timeout(4000),
          },
        )
        if (!response.ok) throw new Error(`Sharing publish failed with HTTP ${response.status}.`)
        if (this.session === session && this.status.state === 'UNAVAILABLE') {
          this.setStatus({ ...this.status, state: 'ON', error: undefined })
        }
      })
      .catch((error) => {
        this.warn(error)
        if (this.session === session) {
          this.setStatus({
            ...this.status,
            state: 'UNAVAILABLE',
            error: 'Sharing connection lost. The assistant is still working.',
          })
        }
      })
  }

  private setStatus(status: SharingStatus) {
    this.status = { ...status }
    this.onStatus(this.getStatus())
  }

  private warn(error: unknown) {
    if (this.development) {
      console.warn(`[SHARE] ${error instanceof Error ? error.message : 'request failed'}`)
    }
  }
}
