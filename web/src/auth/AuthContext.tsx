import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BrowserApiClient } from './browserApiClient'
import type { AccountSession, AuthenticatedUser, CandidateProfile, CompanionPairingApproval, ExtractedDocument, InterviewInput, InterviewSummary, InterviewTurn, PreparedInterview, ProfileInput } from './types'

type AuthStatus = 'restoring' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  status: AuthStatus
  user: AuthenticatedUser | null
  login(email: string, password: string): Promise<AuthenticatedUser>
  register(input: { displayName: string; email: string; password: string; inviteCode?: string }): Promise<AuthenticatedUser>
  logout(): Promise<void>
  verifyEmail(token: string): Promise<AuthenticatedUser>
  resendVerification(): Promise<void>
  forgotPassword(email: string): Promise<string>
  validatePasswordResetToken(token: string): Promise<void>
  resetPassword(token: string, password: string): Promise<void>
  updateDisplayName(displayName: string): Promise<AuthenticatedUser>
  listSessions(): Promise<AccountSession[]>
  logoutOtherSessions(): Promise<number>
  deleteAccount(password: string, confirmation: string): Promise<void>
  listProfiles(): Promise<CandidateProfile[]>
  getProfile(id: string): Promise<CandidateProfile>
  createProfile(input: ProfileInput): Promise<CandidateProfile>
  updateProfile(id: string, input: ProfileInput): Promise<CandidateProfile>
  deleteProfile(id: string): Promise<void>
  createInterview(input: InterviewInput): Promise<PreparedInterview>
  listInterviews(): Promise<InterviewSummary[]>
  getInterview(id: string): Promise<{ interview: PreparedInterview; turns: InterviewTurn[] }>
  completeInterview(id: string): Promise<PreparedInterview>
  deleteInterview(id: string): Promise<void>
  approveCompanionPairing(pairingCode: string, interviewId: string): Promise<CompanionPairingApproval>
  extractDocument(file: File): Promise<ExtractedDocument>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children, client: providedClient }: { children: ReactNode; client?: BrowserApiClient }) {
  const [client] = useState(() => providedClient ?? new BrowserApiClient())
  const [status, setStatus] = useState<AuthStatus>('restoring')
  const [user, setUser] = useState<AuthenticatedUser | null>(null)

  useEffect(() => {
    let active = true
    void client.restoreSession()
      .then((restored) => {
        if (!active) return
        setUser(restored)
        setStatus(restored ? 'authenticated' : 'anonymous')
      })
      .catch(() => {
        if (!active) return
        setUser(null)
        setStatus('anonymous')
      })
    return () => { active = false }
  }, [client])

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    async login(email, password) {
      const authenticated = await client.login(email, password)
      setUser(authenticated)
      setStatus('authenticated')
      return authenticated
    },
    async register(input) {
      const authenticated = await client.register(input)
      setUser(authenticated)
      setStatus('authenticated')
      return authenticated
    },
    async logout() {
      await client.logout()
      setUser(null)
      setStatus('anonymous')
    },
    async verifyEmail(token) {
      const verified = await client.verifyEmail(token)
      const restored = await client.restoreSession()
      if (restored) {
        setUser(restored)
        setStatus('authenticated')
      }
      return verified
    },
    async resendVerification() {
      await client.resendVerification()
    },
    async forgotPassword(email) {
      return (await client.forgotPassword(email)).message
    },
    validatePasswordResetToken(token) {
      return client.validatePasswordResetToken(token)
    },
    async resetPassword(token, password) {
      await client.resetPassword(token, password)
      setUser(null)
      setStatus('anonymous')
    },
    async updateDisplayName(displayName) {
      const updated = await client.updateDisplayName(displayName)
      setUser(updated)
      return updated
    },
    listSessions() {
      return client.listSessions()
    },
    async logoutOtherSessions() {
      return (await client.logoutOtherSessions()).revoked
    },
    async deleteAccount(password, confirmation) {
      await client.deleteAccount(password, confirmation)
      setUser(null)
      setStatus('anonymous')
    },
    listProfiles() {
      return client.listProfiles()
    },
    getProfile(id) {
      return client.getProfile(id)
    },
    createProfile(input) {
      return client.createProfile(input)
    },
    updateProfile(id, input) {
      return client.updateProfile(id, input)
    },
    deleteProfile(id) {
      return client.deleteProfile(id)
    },
    createInterview(input) {
      return client.createInterview(input)
    },
    listInterviews() {
      return client.listInterviews()
    },
    getInterview(id) {
      return client.getInterview(id)
    },
    completeInterview(id) {
      return client.completeInterview(id)
    },
    deleteInterview(id) {
      return client.deleteInterview(id)
    },
    approveCompanionPairing(pairingCode, interviewId) {
      return client.approveCompanionPairing(pairingCode, interviewId)
    },
    extractDocument(file) {
      return client.extractDocument(file)
    },
  }), [client, status, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider.')
  return context
}
