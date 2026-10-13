import type { InterviewContext } from './interviewContextService'
import type { RecentInteraction } from './sessionMemoryService'
import { ApiClientError, type ApiClient, type PendingTurn } from './apiClient'
import type { CandidateProfile, InterviewSession, ProductBootstrap, User, UserSettings } from './productShellService'

interface ApiProfile { id: string; userId: string; name: string; resumeText: string; defaultInstructions: string; createdAt: string; updatedAt: string }
interface ApiInterview { id: string; userId: string; profileId?: string | null; name: string; company?: string | null; role?: string | null; resumeText: string; jobDescriptionText: string; instructions: string; status: 'active' | 'completed'; createdAt: string; updatedAt: string; historyTurns?: number }
interface ApiTurn { requestId: string; question: string; answer: string; createdAt: string }

export class ApiProductService {
  private currentUser: User | null = null
  private activeInterviewId?: string
  private turnSequence = 0
  private sessionState: 'ready' | 'offline' = 'ready'
  private sessionGeneration = 0

  constructor(private readonly api: ApiClient) {}

  async initialize() {
    await this.api.initialize()
    await this.restoreSession()
  }

  async retrySessionRestoration() {
    await this.restoreSession()
    return this.getBootstrap()
  }

  private async restoreSession() {
    const generation = ++this.sessionGeneration
    this.currentUser = null
    this.activeInterviewId = undefined
    this.turnSequence = 0
    this.sessionState = 'ready'
    if (!this.api.hasToken()) return
    try {
      const result = await this.api.request<{ user: User }>('/api/v1/auth/me')
      if (generation !== this.sessionGeneration) return
      this.currentUser = result.user
      const pairedInterviewId = this.api.getPairedInterviewId()
      if (pairedInterviewId) {
        try {
          await this.loadActiveInterview(pairedInterviewId, generation)
        } catch (error) {
          if (isNetworkError(error)) throw error
          if (error instanceof ApiClientError && error.status === 401) throw error
          await this.api.clearPairedInterviewId()
        }
      }
      if (generation !== this.sessionGeneration) return
      await this.flushPendingTurns()
    } catch (error) {
      if (generation !== this.sessionGeneration) return
      this.currentUser = null
      this.activeInterviewId = undefined
      this.turnSequence = 0
      this.sessionState = isNetworkError(error) && this.api.hasToken() ? 'offline' : 'ready'
    }
  }

  async getBootstrap(): Promise<ProductBootstrap> {
    if (!this.currentUser) return emptyBootstrap(this.api.getSettings(), this.sessionState)
    const generation = this.sessionGeneration
    const user = this.currentUser
    try {
      const [profiles, interviews] = await Promise.all([
        this.api.request<{ profiles: ApiProfile[] }>('/api/v1/profiles'),
        this.api.request<{ interviews: ApiInterview[] }>('/api/v1/interviews'),
      ])
      if (generation !== this.sessionGeneration || this.currentUser?.id !== user.id) {
        return emptyBootstrap(this.api.getSettings(), this.sessionState)
      }
      return {
        user,
        settings: this.api.getSettings(),
        activeInterviewId: this.activeInterviewId,
        sessionState: 'ready',
        profiles: profiles.profiles.map((profile) => ({ id: profile.id, name: profile.name, resumeLoaded: Boolean(profile.resumeText), instructionsLoaded: Boolean(profile.defaultInstructions), createdAt: Date.parse(profile.createdAt), updatedAt: Date.parse(profile.updatedAt) })),
        interviews: interviews.interviews.map((session) => ({ id: session.id, name: session.name, company: session.company ?? undefined, role: session.role ?? undefined, status: session.status, createdAt: Date.parse(session.createdAt), updatedAt: Date.parse(session.updatedAt), resumeLoaded: Boolean(session.resumeText), jobDescriptionLoaded: Boolean(session.jobDescriptionText), instructionsLoaded: Boolean(session.instructions), historyTurns: session.historyTurns ?? 0 })),
      }
    } catch (error) {
      if (generation !== this.sessionGeneration) return emptyBootstrap(this.api.getSettings(), this.sessionState)
      if (isNetworkError(error) && this.api.hasToken()) {
        this.currentUser = null
        this.activeInterviewId = undefined
        this.sessionState = 'offline'
        return emptyBootstrap(this.api.getSettings(), 'offline')
      }
      if (error instanceof ApiClientError && error.status === 401) {
        this.invalidateSession()
        return emptyBootstrap(this.api.getSettings())
      }
      throw error
    }
  }

  async login(email: string, password: string, displayName?: string, inviteCode?: string) {
    const generation = ++this.sessionGeneration
    this.currentUser = null
    this.activeInterviewId = undefined
    this.sessionState = 'ready'
    const path = displayName?.trim() ? '/api/v1/auth/register' : '/api/v1/auth/login'
    const body = displayName?.trim() ? { email, password, displayName, inviteCode: inviteCode?.trim() || undefined } : { email, password }
    const result = await this.api.requestAnonymous<{ token: string; user: User }>(path, { method: 'POST', body: JSON.stringify(body) })
    if (generation !== this.sessionGeneration) throw new Error('The sign-in request is no longer current.')
    await this.api.setToken(result.token)
    this.currentUser = result.user
    return result.user
  }

  async acceptPairedSession(token: string, interviewId: string) {
    const generation = ++this.sessionGeneration
    this.currentUser = null
    this.activeInterviewId = undefined
    this.sessionState = 'ready'
    await this.api.setPairedSession(token, interviewId)
    const authenticated = await this.api.request<{ user: User }>('/api/v1/auth/me')
    if (generation !== this.sessionGeneration) throw new Error('The pairing request is no longer current.')
    const session = await this.loadActiveInterview(interviewId, generation)
    if (generation !== this.sessionGeneration) throw new Error('The pairing request is no longer current.')
    this.currentUser = authenticated.user
    return session
  }

  async logout() {
    ++this.sessionGeneration
    try { await this.api.request('/api/v1/auth/logout', { method: 'POST' }) } finally {
      this.currentUser = null
      this.activeInterviewId = undefined
      this.turnSequence = 0
      this.sessionState = 'ready'
      await this.api.setToken(undefined)
    }
  }
  getCurrentUser() { return this.currentUser }
  isAuthenticated() { return Boolean(this.currentUser) }
  hasRecoverableSession() { return this.api.hasToken() }
  invalidateSession() {
    ++this.sessionGeneration
    this.currentUser = null
    this.activeInterviewId = undefined
    this.turnSequence = 0
    this.sessionState = 'ready'
  }

  async validateSession() {
    if (!this.currentUser) return false
    if (!this.api.hasToken()) {
      this.invalidateSession()
      return false
    }
    const generation = this.sessionGeneration
    const userId = this.currentUser.id
    const result = await this.api.request<{ user: User }>('/api/v1/auth/me')
    if (generation !== this.sessionGeneration || this.currentUser?.id !== userId) return false
    if (result.user.id !== userId) {
      this.invalidateSession()
      await this.api.setToken(undefined)
      return false
    }
    this.currentUser = result.user
    return true
  }

  async createInterview(input: { name: string; company?: string; role?: string }, context: InterviewContext) {
    const generation = this.sessionGeneration
    const result = await this.api.request<{ interview: ApiInterview }>('/api/v1/interviews', { method: 'POST', body: JSON.stringify({ ...input, resumeText: context.resumeText, jobDescriptionText: context.jobDescriptionText, instructions: context.instructions }) })
    this.assertCurrentGeneration(generation)
    this.activeInterviewId = result.interview.id
    this.turnSequence = 0
    return toInterview(result.interview, [])
  }

  async reopenInterview(id: string) {
    const generation = this.sessionGeneration
    const loaded = await this.api.request<{ interview: ApiInterview; turns: ApiTurn[] }>(`/api/v1/interviews/${id}`)
    this.assertCurrentGeneration(generation)
    if (loaded.interview.status !== 'active') {
      await this.api.request(`/api/v1/interviews/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'active' }) })
      this.assertCurrentGeneration(generation)
      loaded.interview.status = 'active'
    }
    this.activeInterviewId = id
    this.turnSequence = loaded.turns.length
    return toInterview(loaded.interview, loaded.turns)
  }

  async loadActiveInterview(id: string, expectedGeneration = this.sessionGeneration) {
    const loaded = await this.api.request<{ interview: ApiInterview; turns: ApiTurn[] }>(`/api/v1/interviews/${encodeURIComponent(id)}`)
    this.assertCurrentGeneration(expectedGeneration)
    if (loaded.interview.status !== 'active') {
      await this.api.clearPairedInterviewId()
      throw new Error('The paired interview is no longer active.')
    }
    this.activeInterviewId = id
    this.turnSequence = loaded.turns.length
    return toInterview(loaded.interview, loaded.turns)
  }

  async completeActiveInterview(_history: RecentInteraction[]) {
    if (!this.activeInterviewId) return null
    const id = this.activeInterviewId
    const generation = this.sessionGeneration
    const result = await this.api.request<{ interview: ApiInterview }>(`/api/v1/interviews/${id}/complete`, { method: 'POST' })
    this.assertCurrentGeneration(generation)
    this.activeInterviewId = undefined
    await this.api.clearPairedInterviewId()
    return toInterview(result.interview, [])
  }

  async recordTurn(interaction: RecentInteraction) {
    if (!this.activeInterviewId) return
    const question = interaction.conversation.map((segment) => segment.text).join('\n').trim()
    if (!question || !interaction.assistantAnswer.trim()) return
    const turn: PendingTurn = { sessionId: this.activeInterviewId, requestId: interaction.requestId, sequence: ++this.turnSequence, question, answer: interaction.assistantAnswer }
    try {
      await this.sendTurn(turn)
    } catch {
      await this.api.setPendingTurns([...this.api.getPendingTurns(), turn])
    }
  }

  async createProfile(name: string, context: InterviewContext) {
    const result = await this.api.request<{ profile: ApiProfile }>('/api/v1/profiles', { method: 'POST', body: JSON.stringify({ name, resumeText: context.resumeText, defaultInstructions: context.instructions }) })
    return toProfile(result.profile)
  }
  async updateProfile(id: string, name: string, context?: InterviewContext) {
    const body = context ? { name, resumeText: context.resumeText, defaultInstructions: context.instructions } : { name }
    const result = await this.api.request<{ profile: ApiProfile }>(`/api/v1/profiles/${id}`, { method: 'PUT', body: JSON.stringify(body) })
    return toProfile(result.profile)
  }
  async deleteProfile(id: string) { await this.api.request(`/api/v1/profiles/${id}`, { method: 'DELETE' }) }
  async deleteInterview(id: string) { await this.api.request(`/api/v1/interviews/${id}`, { method: 'DELETE' }) }
  async getProfileById(id: string) {
    const result = await this.api.request<{ profile: ApiProfile }>(`/api/v1/profiles/${id}`)
    return toProfile(result.profile)
  }
  async setSettings(settings: UserSettings) { await this.api.setDefaultAutoAssist(settings.defaultAutoAssist); return settings }
  async updateAccount(displayName: string) {
    const generation = this.sessionGeneration
    const result = await this.api.request<{ user: User }>('/api/v1/auth/me', { method: 'PUT', body: JSON.stringify({ displayName }) })
    this.assertCurrentGeneration(generation)
    this.currentUser = result.user
    return result.user
  }
  async clearLocalData() { ++this.sessionGeneration; this.currentUser = null; this.activeInterviewId = undefined; this.turnSequence = 0; this.sessionState = 'ready'; await this.api.clear() }
  async listSessions() {
    return (await this.api.request<{ sessions: Array<{ id: string; deviceLabel: string; lastUsedAt: string; createdAt: string; expiresAt: string; current: boolean }> }>('/api/v1/auth/sessions')).sessions
  }
  async logoutOtherSessions() { return this.api.request<{ revoked: number }>('/api/v1/auth/sessions/logout-others', { method: 'POST' }) }
  async requestPasswordReset(email: string) { return this.api.requestAnonymous<{ message: string }>('/api/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }) }
  async resetPassword(token: string, password: string) { await this.api.requestAnonymous('/api/v1/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }); ++this.sessionGeneration; await this.api.setToken(undefined); this.currentUser = null; this.activeInterviewId = undefined; this.turnSequence = 0 }
  async verifyEmail(token: string) { const result = await this.api.request<{ user: User }>('/api/v1/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }); this.currentUser = result.user; return result.user }
  async resendVerification() { await this.api.request('/api/v1/auth/resend-verification', { method: 'POST' }) }
  async exportData() { return this.api.request<unknown>('/api/v1/export') }
  async deleteAccount(password: string, confirmation: string) { await this.api.request('/api/v1/auth/me', { method: 'DELETE', body: JSON.stringify({ password, confirmation }) }); ++this.sessionGeneration; this.currentUser = null; this.activeInterviewId = undefined; this.turnSequence = 0; await this.api.clear() }
  getActiveInterviewId() { return this.activeInterviewId }
  async createRealtimeSecret() {
    if (!this.activeInterviewId) throw new Error('Start an interview before starting Live Assistant.')
    const result = await this.api.request<{ clientSecret: { value: string } }>('/api/v1/ai/realtime-secret', { method: 'POST', body: JSON.stringify({ sessionId: this.activeInterviewId }) })
    return result.clientSecret.value
  }
  async summarize(kind: 'session' | 'workspace', previous: string, content: string) {
    if (!this.activeInterviewId) throw new Error('No active interview.')
    const result = await this.api.request<{ summary: string }>('/api/v1/ai/summary', { method: 'POST', body: JSON.stringify({ sessionId: this.activeInterviewId, kind, previous, content }) })
    return result.summary
  }

  private async sendTurn(turn: PendingTurn) {
    await this.api.request(`/api/v1/interviews/${turn.sessionId}/turns`, { method: 'POST', body: JSON.stringify(turn) })
  }
  private async flushPendingTurns() {
    const remaining: PendingTurn[] = []
    for (const turn of this.api.getPendingTurns()) {
      try {
        await this.sendTurn(turn)
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) throw error
        remaining.push(turn)
      }
    }
    await this.api.setPendingTurns(remaining)
  }

  private assertCurrentGeneration(expected: number) {
    if (expected !== this.sessionGeneration) throw new StaleSessionError()
  }
}

class StaleSessionError extends Error {
  constructor() { super('The session changed while the request was in progress.'); this.name = 'StaleSessionError' }
}

function isNetworkError(error: unknown) {
  return error instanceof ApiClientError && error.status === 0 && error.code === 'NETWORK_ERROR'
}

function emptyBootstrap(settings: UserSettings, sessionState: 'ready' | 'offline' = 'ready'): ProductBootstrap {
  return { user: null, interviews: [], profiles: [], settings, sessionState }
}
function toProfile(value: ApiProfile): CandidateProfile { return { ...value, createdAt: Date.parse(value.createdAt), updatedAt: Date.parse(value.updatedAt) } }
function toInterview(value: ApiInterview, turns: ApiTurn[]): InterviewSession {
  return { id: value.id, userId: value.userId, name: value.name, company: value.company ?? undefined, role: value.role ?? undefined, status: value.status, createdAt: Date.parse(value.createdAt), updatedAt: Date.parse(value.updatedAt), context: { resumeText: value.resumeText, jobDescriptionText: value.jobDescriptionText, instructions: value.instructions }, history: turns.map((turn) => ({ requestId: turn.requestId, conversation: [{ id: turn.requestId, source: 'system', text: turn.question, timestamp: Date.parse(turn.createdAt) }], assistantAnswer: turn.answer, timestamp: Date.parse(turn.createdAt) })) }
}
