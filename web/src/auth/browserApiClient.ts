import type { AccountSession, AuthenticatedUser, BrowserSession, CandidateProfile, CompanionPairingApproval, ExtractedDocument, InterviewInput, InterviewSummary, InterviewTurn, PreparedInterview, ProfileInput } from './types'

interface ErrorResponse {
  error?: string
  code?: string
}

export class BrowserApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'BrowserApiError'
  }
}

export class BrowserApiClient {
  private csrfToken = ''
  private readonly baseUrl: string

  constructor(baseUrl = import.meta.env.VITE_API_BASE_URL ?? '') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async restoreSession() {
    try {
      const session = await this.request<BrowserSession>('/api/v1/auth/me')
      this.csrfToken = session.csrfToken
      return session.user
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 401) {
        this.csrfToken = ''
        return null
      }
      throw error
    }
  }

  async login(email: string, password: string) {
    const session = await this.request<BrowserSession>('/api/v1/auth/browser/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    this.csrfToken = session.csrfToken
    return session.user
  }

  async register(input: { displayName: string; email: string; password: string; inviteCode?: string }) {
    const session = await this.request<BrowserSession>('/api/v1/auth/browser/register', {
      method: 'POST',
      body: JSON.stringify({ ...input, inviteCode: input.inviteCode?.trim() || undefined }),
    })
    this.csrfToken = session.csrfToken
    return session.user
  }

  async logout() {
    await this.request<void>('/api/v1/auth/logout', { method: 'POST' })
    this.csrfToken = ''
  }

  async verifyEmail(token: string) {
    const response = await this.request<{ user: AuthenticatedUser }>('/api/v1/auth/browser/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
    return response.user
  }

  async resendVerification() {
    await this.request<void>('/api/v1/auth/resend-verification', { method: 'POST' })
  }

  async forgotPassword(email: string) {
    return this.request<{ message: string }>('/api/v1/auth/browser/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  }

  async validatePasswordResetToken(token: string) {
    await this.request<{ valid: true }>('/api/v1/auth/browser/reset-password/validate', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  async resetPassword(token: string, password: string) {
    await this.request<void>('/api/v1/auth/browser/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    })
    this.csrfToken = ''
  }

  async updateDisplayName(displayName: string) {
    const response = await this.request<{ user: AuthenticatedUser }>('/api/v1/auth/me', {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    })
    return response.user
  }

  async listSessions() {
    const response = await this.request<{ sessions: AccountSession[] }>('/api/v1/auth/sessions')
    return response.sessions
  }

  async logoutOtherSessions() {
    return this.request<{ revoked: number }>('/api/v1/auth/sessions/logout-others', { method: 'POST' })
  }

  async deleteAccount(password: string, confirmation: string) {
    await this.request<void>('/api/v1/auth/me', {
      method: 'DELETE',
      body: JSON.stringify({ password, confirmation }),
    })
    this.csrfToken = ''
  }

  async listProfiles() {
    return (await this.request<{ profiles: CandidateProfile[] }>('/api/v1/profiles')).profiles
  }

  async getProfile(id: string) {
    return (await this.request<{ profile: CandidateProfile }>(`/api/v1/profiles/${encodeURIComponent(id)}`)).profile
  }

  async createProfile(input: ProfileInput) {
    return (await this.request<{ profile: CandidateProfile }>('/api/v1/profiles', {
      method: 'POST',
      body: JSON.stringify(input),
    })).profile
  }

  async updateProfile(id: string, input: ProfileInput) {
    return (await this.request<{ profile: CandidateProfile }>(`/api/v1/profiles/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })).profile
  }

  async deleteProfile(id: string) {
    await this.request<void>(`/api/v1/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async createInterview(input: InterviewInput) {
    return (await this.request<{ interview: PreparedInterview }>('/api/v1/interviews', {
      method: 'POST',
      body: JSON.stringify(input),
    })).interview
  }

  async listInterviews() {
    return (await this.request<{ interviews: InterviewSummary[] }>('/api/v1/interviews')).interviews
  }

  async getInterview(id: string) {
    const encodedId = encodeURIComponent(id)
    const [detail, history] = await Promise.all([
      this.request<{ interview: PreparedInterview }>(`/api/v1/interviews/${encodedId}`),
      this.request<{ turns: InterviewTurn[] }>(`/api/v1/interviews/${encodedId}/turns`),
    ])
    return { interview: detail.interview, turns: history.turns }
  }

  async completeInterview(id: string) {
    return (await this.request<{ interview: PreparedInterview }>(`/api/v1/interviews/${encodeURIComponent(id)}/complete`, { method: 'POST' })).interview
  }

  async deleteInterview(id: string) {
    await this.request<void>(`/api/v1/interviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async approveCompanionPairing(pairingCode: string, interviewId: string) {
    return (await this.request<{ pairing: CompanionPairingApproval }>('/api/v1/companion/pairings/approve', {
      method: 'POST',
      body: JSON.stringify({ pairingCode, interviewId }),
    })).pairing
  }

  async extractDocument(file: File) {
    return (await this.request<{ document: ExtractedDocument }>('/api/v1/documents/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Document-Name': encodeURIComponent(file.name),
      },
      body: file,
    })).document
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (this.csrfToken && isStateChanging(init.method)) headers.set('X-CSRF-Token', this.csrfToken)

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, credentials: 'include' })
    } catch {
      throw new BrowserApiError('The service is unavailable. Check your connection and try again.', 0, 'NETWORK_ERROR')
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as ErrorResponse
      throw new BrowserApiError(friendlyMessage(response.status, body), response.status, body.code)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
}

function isStateChanging(method = 'GET') {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

function friendlyMessage(status: number, body: ErrorResponse) {
  if (body.error && !/^body\//i.test(body.error)) return body.error
  if (status === 400) return 'Please check the information you entered and try again.'
  if (status === 401) return 'Email or password is incorrect.'
  if (status === 403) return 'This request is not allowed. Refresh the page and try again.'
  if (status === 409) return 'An account with that email already exists.'
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.'
  return 'The request could not be completed. Please try again.'
}
