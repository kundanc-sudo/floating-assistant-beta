import type { ProductBootstrap } from './productShellService'

export type DesktopPairingStatus =
  | 'idle'
  | 'pending'
  | 'approved'
  | 'expired'
  | 'failed'
  | 'cancelled'
  | 'connected'

export interface DesktopPairingConnection {
  interview: { id: string; name: string; company?: string; role?: string }
  bootstrap: ProductBootstrap
}

export interface DesktopPairingPublicState {
  status: DesktopPairingStatus
  pairingCode?: string
  expiresAt?: string
  error?: string
  connection?: DesktopPairingConnection
}

interface PairingCreation {
  requestId: string
  pairingCode: string
  redemptionSecret: string
  expiresAt: string
}

interface PairingAttempt extends PairingCreation {
  generation: number
  polling: boolean
  redemptionStarted: boolean
}

interface AnonymousApiClient {
  requestAnonymous<T>(path: string, init?: RequestInit): Promise<T>
}

interface PairingScheduler {
  now(): number
  schedule(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

const defaultScheduler: PairingScheduler = {
  now: Date.now,
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class CompanionPairingService {
  private state: DesktopPairingPublicState = { status: 'idle' }
  private attempt?: PairingAttempt
  private timer?: unknown
  private generation = 0

  constructor(
    private readonly api: AnonymousApiClient,
    private readonly onRedeemed: (value: { token: string; interviewId: string; expiresAt: string }) => Promise<DesktopPairingConnection>,
    private readonly onState: (state: DesktopPairingPublicState) => void = () => {},
    private readonly scheduler: PairingScheduler = defaultScheduler,
    private readonly pollIntervalMs = 2_500,
  ) {}

  getState(): DesktopPairingPublicState {
    return clonePublicState(this.state)
  }

  async start(): Promise<DesktopPairingPublicState> {
    this.stopAttempt()
    const generation = ++this.generation
    this.publish({ status: 'pending' })

    try {
      const created = await this.api.requestAnonymous<PairingCreation>('/api/v1/companion/pairings', { method: 'POST' })
      if (generation !== this.generation) return this.getState()
      if (!isPairingCreation(created) || Date.parse(created.expiresAt) <= this.scheduler.now()) {
        throw new Error('The server returned an invalid pairing request.')
      }
      this.attempt = { ...created, generation, polling: false, redemptionStarted: false }
      this.publish({ status: 'pending', pairingCode: created.pairingCode, expiresAt: created.expiresAt })
      this.schedulePoll(generation)
    } catch {
      if (generation === this.generation) {
        this.stopAttempt()
        this.publish({ status: 'failed', error: 'A pairing code could not be created. Check your connection and try again.' })
      }
    }
    return this.getState()
  }

  cancel(): DesktopPairingPublicState {
    if (!this.attempt && !['pending', 'approved'].includes(this.state.status)) return this.getState()
    ++this.generation
    this.stopAttempt()
    this.publish({ status: 'cancelled' })
    return this.getState()
  }

  dispose() {
    ++this.generation
    this.stopAttempt()
  }

  private schedulePoll(generation: number) {
    this.clearTimer()
    this.timer = this.scheduler.schedule(() => { void this.poll(generation) }, this.pollIntervalMs)
  }

  private async poll(generation: number) {
    const attempt = this.attempt
    if (!attempt || generation !== this.generation || attempt.generation !== generation || attempt.polling) return
    if (this.hasExpired(attempt)) {
      this.expire(generation)
      return
    }

    attempt.polling = true
    try {
      const result = await this.api.requestAnonymous<{ pairing: { requestId: string; status: 'pending' | 'approved' } }>(
        `/api/v1/companion/pairings/${encodeURIComponent(attempt.requestId)}/status`,
        { method: 'POST', body: JSON.stringify({ redemptionSecret: attempt.redemptionSecret }) },
      )
      if (generation !== this.generation || this.attempt !== attempt) return
      if (result?.pairing?.requestId !== attempt.requestId || !['pending', 'approved'].includes(result?.pairing?.status)) {
        throw new Error('Invalid pairing status.')
      }
      if (result.pairing.status === 'approved') {
        this.publish({ status: 'approved', pairingCode: attempt.pairingCode, expiresAt: attempt.expiresAt })
        await this.redeem(attempt, generation)
        return
      }
      this.publish({ status: 'pending', pairingCode: attempt.pairingCode, expiresAt: attempt.expiresAt })
    } catch (error) {
      if (generation !== this.generation || this.attempt !== attempt) return
      if (this.hasExpired(attempt) || errorStatus(error) === 404) {
        this.expire(generation)
        return
      }
      this.publish({
        status: 'pending',
        pairingCode: attempt.pairingCode,
        expiresAt: attempt.expiresAt,
        error: 'The connection was interrupted. Pairing will keep trying until the code expires.',
      })
    } finally {
      attempt.polling = false
    }

    if (generation === this.generation && this.attempt === attempt) this.schedulePoll(generation)
  }

  private async redeem(attempt: PairingAttempt, generation: number) {
    if (attempt.redemptionStarted) return
    attempt.redemptionStarted = true
    try {
      const redeemed = await this.api.requestAnonymous<{ token: string; interviewId: string; expiresAt: string }>(
        `/api/v1/companion/pairings/${encodeURIComponent(attempt.requestId)}/redeem`,
        {
          method: 'POST',
          body: JSON.stringify({ redemptionSecret: attempt.redemptionSecret, deviceLabel: 'Windows companion' }),
        },
      )
      if (generation !== this.generation || this.attempt !== attempt) return
      if (!isRedemption(redeemed)) throw new Error('Invalid pairing redemption.')
      const connection = await this.onRedeemed(redeemed)
      if (generation !== this.generation || this.attempt !== attempt) return
      this.stopAttempt()
      this.publish({ status: 'connected', connection })
    } catch {
      if (generation !== this.generation || this.attempt !== attempt) return
      this.stopAttempt()
      this.publish({
        status: 'failed',
        error: 'The connection result could not be confirmed. Generate a new code instead of retrying this one.',
      })
    }
  }

  private hasExpired(attempt: PairingAttempt) {
    return Date.parse(attempt.expiresAt) <= this.scheduler.now()
  }

  private expire(generation: number) {
    if (generation !== this.generation) return
    this.stopAttempt()
    this.publish({ status: 'expired', error: 'This pairing code expired. Generate a new code to try again.' })
  }

  private stopAttempt() {
    this.clearTimer()
    this.attempt = undefined
  }

  private clearTimer() {
    if (this.timer !== undefined) this.scheduler.cancel(this.timer)
    this.timer = undefined
  }

  private publish(state: DesktopPairingPublicState) {
    this.state = clonePublicState(state)
    this.onState(this.getState())
  }
}

function clonePublicState(state: DesktopPairingPublicState): DesktopPairingPublicState {
  return {
    ...state,
    connection: state.connection
      ? { interview: { ...state.connection.interview }, bootstrap: structuredClone(state.connection.bootstrap) }
      : undefined,
  }
}

function isPairingCreation(value: unknown): value is PairingCreation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.requestId === 'string' && typeof candidate.pairingCode === 'string' &&
    typeof candidate.redemptionSecret === 'string' && candidate.redemptionSecret.length >= 32 &&
    typeof candidate.expiresAt === 'string' && Number.isFinite(Date.parse(candidate.expiresAt))
}

function isRedemption(value: unknown): value is { token: string; interviewId: string; expiresAt: string } {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.token === 'string' && candidate.token.length >= 32 &&
    typeof candidate.interviewId === 'string' && typeof candidate.expiresAt === 'string'
}

function errorStatus(error: unknown) {
  return error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : undefined
}
