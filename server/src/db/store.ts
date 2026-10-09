export interface UserRecord {
  id: string
  email: string
  passwordHash: string
  displayName: string
  emailVerifiedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AuthSessionRecord {
  id: string
  userId: string
  deviceLabel: string
  lastUsedAt: Date
  expiresAt: Date
  createdAt: Date
}

export type AuthTokenType = 'password_reset' | 'email_verification'

export interface BetaInviteRecord {
  id: string
  email: string | null
  expiresAt: Date
}

export interface ProfileRecord {
  id: string
  userId: string
  name: string
  resumeText: string
  defaultInstructions: string
  createdAt: Date
  updatedAt: Date
}

export interface InterviewRecord {
  id: string
  userId: string
  profileId: string | null
  name: string
  company: string | null
  role: string | null
  resumeText: string
  jobDescriptionText: string
  instructions: string
  status: string
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

export interface TurnRecord {
  id: string
  sessionId: string
  requestId: string
  sequence: number
  question: string
  answer: string
  createdAt: Date
}

export interface UsageRecord {
  id: string
  userId: string
  sessionId: string | null
  type: string
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  createdAt: Date
}

export interface ProductStore {
  createUser(input: { email: string; passwordHash: string; displayName: string }): Promise<UserRecord>
  findUserByEmail(email: string): Promise<UserRecord | null>
  findUserById(id: string): Promise<UserRecord | null>
  updateUser(id: string, displayName: string): Promise<UserRecord | null>
  deleteUser(id: string): Promise<boolean>
  createSession(input: { userId: string; tokenHash: string; deviceLabel: string; expiresAt: Date }): Promise<AuthSessionRecord>
  findUserBySession(tokenHash: string, now: Date): Promise<{ user: UserRecord; session: AuthSessionRecord } | null>
  touchSession(id: string, at: Date): Promise<void>
  deleteSession(tokenHash: string): Promise<void>
  listSessions(userId: string): Promise<AuthSessionRecord[]>
  deleteOtherSessions(userId: string, currentSessionId: string): Promise<number>
  trimSessions(userId: string, keep: number): Promise<void>
  createAuthToken(input: { userId: string; type: AuthTokenType; tokenHash: string; expiresAt: Date }): Promise<void>
  consumeAuthToken(tokenHash: string, type: AuthTokenType, now: Date): Promise<UserRecord | null>
  invalidateAuthTokens(userId: string, type: AuthTokenType): Promise<void>
  updatePasswordAndRevokeSessions(userId: string, passwordHash: string): Promise<void>
  markEmailVerified(userId: string, at: Date): Promise<UserRecord | null>
  findBetaInvite(codeHash: string, email: string, now: Date): Promise<BetaInviteRecord | null>
  consumeBetaInvite(id: string, userId: string, at: Date): Promise<boolean>
  listProfiles(userId: string): Promise<ProfileRecord[]>
  createProfile(userId: string, input: Omit<ProfileRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<ProfileRecord>
  getProfile(userId: string, id: string): Promise<ProfileRecord | null>
  updateProfile(userId: string, id: string, input: Partial<Pick<ProfileRecord, 'name' | 'resumeText' | 'defaultInstructions'>>): Promise<ProfileRecord | null>
  deleteProfile(userId: string, id: string): Promise<boolean>
  listInterviews(userId: string): Promise<Array<InterviewRecord & { historyTurns: number }>>
  createInterview(userId: string, input: Omit<InterviewRecord, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt' | 'completedAt'>): Promise<InterviewRecord>
  getInterview(userId: string, id: string): Promise<InterviewRecord | null>
  updateInterview(userId: string, id: string, input: Partial<Pick<InterviewRecord, 'name' | 'company' | 'role' | 'resumeText' | 'jobDescriptionText' | 'instructions' | 'status'>>): Promise<InterviewRecord | null>
  completeInterview(userId: string, id: string): Promise<InterviewRecord | null>
  deleteInterview(userId: string, id: string): Promise<boolean>
  listTurns(userId: string, sessionId: string): Promise<TurnRecord[] | null>
  createTurn(userId: string, sessionId: string, input: Pick<TurnRecord, 'requestId' | 'sequence' | 'question' | 'answer'>): Promise<TurnRecord | null>
  createUsage(input: Omit<UsageRecord, 'id' | 'createdAt'>): Promise<void>
  listUsage(userId: string): Promise<UsageRecord[]>
  getUsageSince(userId: string, since: Date): Promise<{ requests: number; inputTokens: number; outputTokens: number }>
  exportUserData(userId: string): Promise<{ profiles: Array<Pick<ProfileRecord, 'id' | 'name' | 'createdAt' | 'updatedAt'>>; interviews: Array<Pick<InterviewRecord, 'id' | 'profileId' | 'name' | 'company' | 'role' | 'status' | 'createdAt' | 'updatedAt' | 'completedAt'> & { turns: TurnRecord[] }> }>
  checkHealth(): Promise<void>
}
