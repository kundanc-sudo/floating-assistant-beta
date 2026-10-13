export interface AuthenticatedUser {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
}

export interface BrowserSession {
  user: AuthenticatedUser
  csrfToken: string
}

export interface AccountSession {
  id: string
  deviceLabel: string
  lastUsedAt: string
  createdAt: string
  expiresAt: string
  current: boolean
}

export interface CandidateProfile {
  id: string
  userId: string
  name: string
  resumeText: string
  defaultInstructions: string
  createdAt: string
  updatedAt: string
}

export interface PreparedInterview {
  id: string
  profileId: string | null
  name: string
  company: string | null
  role: string | null
  resumeText: string
  jobDescriptionText: string
  instructions: string
  status: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface InterviewSummary extends PreparedInterview {
  historyTurns: number
}

export interface InterviewTurn {
  id: string
  sessionId: string
  requestId: string
  sequence: number
  question: string
  answer: string
  createdAt: string
}

export interface ProfileInput {
  name: string
  resumeText: string
  defaultInstructions: string
}

export interface InterviewInput {
  profileId?: string | null
  name: string
  company?: string | null
  role?: string | null
  resumeText: string
  jobDescriptionText: string
  instructions: string
}

export interface ExtractedDocument {
  filename: string
  kind: 'pdf' | 'docx' | 'txt'
  text: string
  characters: number
  warning?: string
}

export interface CompanionPairingApproval {
  requestId: string
  status: 'approved'
  interviewId: string
  expiresAt: string
}
