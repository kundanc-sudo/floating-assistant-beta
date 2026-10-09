import type { ProductStorage } from './productShellService'

interface SecureClientState {
  token?: string
  defaultAutoAssist?: boolean
  pendingTurns?: PendingTurn[]
}

export interface PendingTurn {
  sessionId: string
  requestId: string
  sequence: number
  question: string
  answer: string
}

export class ApiClient {
  private state: SecureClientState = {}

  constructor(
    readonly baseUrl: string,
    private readonly storage: ProductStorage,
  ) {}

  async initialize() {
    const stored = await this.storage.load()
    if (stored && typeof stored === 'object') {
      const value = stored as SecureClientState
      this.state = {
        token: typeof value.token === 'string' ? value.token : undefined,
        defaultAutoAssist: Boolean(value.defaultAutoAssist),
        pendingTurns: Array.isArray(value.pendingTurns) ? value.pendingTurns.slice(-20) : [],
      }
    }
  }

  hasToken() { return Boolean(this.state.token) }
  getSettings() { return { defaultAutoAssist: Boolean(this.state.defaultAutoAssist) } }
  getPendingTurns() { return [...(this.state.pendingTurns ?? [])] }

  async setToken(token?: string) {
    this.state.token = token
    if (!token) this.state.pendingTurns = []
    await this.persist()
  }

  async setDefaultAutoAssist(value: boolean) {
    this.state.defaultAutoAssist = value
    await this.persist()
  }

  async setPendingTurns(turns: PendingTurn[]) {
    this.state.pendingTurns = turns.slice(-20)
    await this.persist()
  }

  async clear() {
    this.state = {}
    await this.storage.clear()
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')
    if (this.state.token) headers.set('Authorization', `Bearer ${this.state.token}`)
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers })
    } catch {
      throw new Error('The backend is unavailable. Check the server and your network connection.')
    }
    if (!response.ok) {
      if (response.status === 401) await this.setToken(undefined)
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `Backend request failed with HTTP ${response.status}.`)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  async stream(path: string, body: unknown, signal: AbortSignal) {
    const headers = new Headers({ Accept: 'text/event-stream', 'Content-Type': 'application/json' })
    if (this.state.token) headers.set('Authorization', `Bearer ${this.state.token}`)
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal })
    } catch (error) {
      if (signal.aborted) throw error
      throw new Error('The backend connection was interrupted.')
    }
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(result.error ?? `AI request failed with HTTP ${response.status}.`)
    }
    if (!response.body) throw new Error('The backend returned an empty stream.')
    return response.body
  }

  private async persist() {
    await this.storage.save(this.state)
  }
}
