import { randomUUID } from 'node:crypto'
import type { InterviewContext } from './interviewContextService'
import type { RecentInteraction } from './sessionMemoryService'

export interface User {
  id: string
  email: string
  displayName?: string
  emailVerified?: boolean
}

export interface InterviewSession {
  id: string
  userId: string
  name: string
  company?: string
  role?: string
  createdAt: number
  updatedAt: number
  status: 'active' | 'completed'
  context: InterviewContext
  history: RecentInteraction[]
}

export interface CandidateProfile {
  id: string
  userId: string
  name: string
  resumeText: string
  defaultInstructions: string
  createdAt: number
  updatedAt: number
}

export interface UserSettings {
  defaultAutoAssist: boolean
}

export interface InterviewSessionSummary {
  id: string
  name: string
  company?: string
  role?: string
  createdAt: number
  updatedAt: number
  status: 'active' | 'completed'
  resumeLoaded: boolean
  jobDescriptionLoaded: boolean
  instructionsLoaded: boolean
  historyTurns: number
}

export interface CandidateProfileSummary {
  id: string
  name: string
  resumeLoaded: boolean
  instructionsLoaded: boolean
  createdAt: number
  updatedAt: number
}

export interface ProductBootstrap {
  user: User | null
  interviews: InterviewSessionSummary[]
  profiles: CandidateProfileSummary[]
  settings: UserSettings
  activeInterviewId?: string
}

interface ProductData {
  users: User[]
  currentUserId?: string
  activeInterviewId?: string
  interviews: InterviewSession[]
  profiles: CandidateProfile[]
  settingsByUser: Record<string, UserSettings>
}

export interface ProductStorage {
  load(): Promise<unknown>
  save(value: unknown): Promise<void>
  clear(): Promise<void>
}

export interface AuthService {
  login(email: string, password: string, displayName?: string): Promise<User>
  logout(): Promise<void>
  getCurrentUser(): User | null
  isAuthenticated(): boolean
}

export interface InterviewRepository {
  createInterview(input: { name: string; company?: string; role?: string }, context: InterviewContext): Promise<InterviewSession>
  updateInterview(session: InterviewSession): Promise<void>
  getInterviewById(id: string): InterviewSession | null
  listInterviewsByUser(userId: string): InterviewSessionSummary[]
}

export interface ProfileRepository {
  createProfile(name: string, context: InterviewContext): Promise<CandidateProfile>
  updateProfile(id: string, name: string, context?: InterviewContext): Promise<CandidateProfile>
  deleteProfile(id: string): Promise<void>
  getProfileById(id: string): CandidateProfile | null
  listProfilesByUser(userId: string): CandidateProfileSummary[]
}

const EMPTY_SETTINGS: UserSettings = { defaultAutoAssist: false }

export class LocalProductService implements AuthService, InterviewRepository, ProfileRepository {
  private data: ProductData = emptyData()

  constructor(
    private readonly storage: ProductStorage,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
  ) {}

  async initialize(): Promise<void> {
    this.data = normalizeData(await this.storage.load())
  }

  getBootstrap(): ProductBootstrap {
    const user = this.getCurrentUser()
    return {
      user,
      interviews: user ? this.listInterviewsByUser(user.id) : [],
      profiles: user ? this.listProfilesByUser(user.id) : [],
      settings: user ? { ...(this.data.settingsByUser[user.id] ?? EMPTY_SETTINGS) } : { ...EMPTY_SETTINGS },
      activeInterviewId: user ? this.data.activeInterviewId : undefined,
    }
  }

  async login(email: string, password: string, displayName?: string): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.')
    if (password.length < 6) throw new Error('Password must contain at least 6 characters.')
    let user = this.data.users.find((candidate) => candidate.email === normalizedEmail)
    if (!user) {
      user = {
        id: this.createId(),
        email: normalizedEmail,
        displayName: displayName?.trim() || normalizedEmail.split('@')[0],
      }
      this.data.users.push(user)
    } else if (displayName?.trim()) {
      user.displayName = displayName.trim()
    }
    this.data.currentUserId = user.id
    this.data.settingsByUser[user.id] ??= { ...EMPTY_SETTINGS }
    await this.persist()
    return { ...user }
  }

  async logout(): Promise<void> {
    this.data.currentUserId = undefined
    this.data.activeInterviewId = undefined
    await this.persist()
  }

  getCurrentUser(): User | null {
    const user = this.data.users.find((candidate) => candidate.id === this.data.currentUserId)
    return user ? { ...user } : null
  }

  isAuthenticated(): boolean {
    return this.getCurrentUser() !== null
  }

  async createInterview(
    input: { name: string; company?: string; role?: string },
    context: InterviewContext,
  ): Promise<InterviewSession> {
    const user = this.requireUser()
    if (!input.name.trim()) throw new Error('Interview name is required.')
    if (!context.resumeText.trim()) throw new Error('Resume is required.')
    if (!context.instructions.trim()) throw new Error('Interview instructions are required.')
    const timestamp = this.now()
    const session: InterviewSession = {
      id: this.createId(),
      userId: user.id,
      name: input.name.trim(),
      company: input.company?.trim() || undefined,
      role: input.role?.trim() || undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'active',
      context: { ...context },
      history: [],
    }
    this.data.interviews.push(session)
    this.data.activeInterviewId = session.id
    await this.persist()
    return cloneSession(session)
  }

  async updateInterview(session: InterviewSession): Promise<void> {
    const user = this.requireUser()
    const index = this.data.interviews.findIndex(
      (candidate) => candidate.id === session.id && candidate.userId === user.id,
    )
    if (index < 0) throw new Error('Interview session was not found.')
    this.data.interviews[index] = cloneSession(session)
    await this.persist()
  }

  getInterviewById(id: string): InterviewSession | null {
    const user = this.getCurrentUser()
    if (!user) return null
    const session = this.data.interviews.find(
      (candidate) => candidate.id === id && candidate.userId === user.id,
    )
    return session ? cloneSession(session) : null
  }

  listInterviewsByUser(userId: string): InterviewSessionSummary[] {
    return this.data.interviews
      .filter((session) => session.userId === userId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(toSessionSummary)
  }

  async completeActiveInterview(history: RecentInteraction[]): Promise<InterviewSession | null> {
    const session = this.data.interviews.find(
      (candidate) => candidate.id === this.data.activeInterviewId,
    )
    if (!session) return null
    session.status = 'completed'
    session.updatedAt = this.now()
    session.history = history.map(cloneInteraction)
    this.data.activeInterviewId = undefined
    await this.persist()
    return cloneSession(session)
  }

  async reopenInterview(id: string): Promise<InterviewSession> {
    const user = this.requireUser()
    const session = this.data.interviews.find(
      (candidate) => candidate.id === id && candidate.userId === user.id,
    )
    if (!session) throw new Error('Interview session was not found.')
    session.status = 'active'
    session.updatedAt = this.now()
    this.data.activeInterviewId = session.id
    await this.persist()
    return cloneSession(session)
  }

  async createProfile(name: string, context: InterviewContext): Promise<CandidateProfile> {
    const user = this.requireUser()
    if (!name.trim()) throw new Error('Profile name is required.')
    if (!context.resumeText.trim() || !context.instructions.trim()) {
      throw new Error('Load a resume and instructions before saving a profile.')
    }
    const timestamp = this.now()
    const profile: CandidateProfile = {
      id: this.createId(),
      userId: user.id,
      name: name.trim(),
      resumeText: context.resumeText,
      defaultInstructions: context.instructions,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.data.profiles.push(profile)
    await this.persist()
    return cloneProfile(profile)
  }

  async updateProfile(id: string, name: string, context?: InterviewContext): Promise<CandidateProfile> {
    const user = this.requireUser()
    const profile = this.data.profiles.find(
      (candidate) => candidate.id === id && candidate.userId === user.id,
    )
    if (!profile) throw new Error('Profile was not found.')
    if (!name?.trim()) throw new Error('Profile name is required.')
    profile.name = name.trim()
    if (context) {
      if (!context.resumeText.trim() || !context.instructions.trim()) {
        throw new Error('Load a resume and instructions before updating a profile.')
      }
      profile.resumeText = context.resumeText
      profile.defaultInstructions = context.instructions
    }
    profile.updatedAt = this.now()
    await this.persist()
    return cloneProfile(profile)
  }

  async deleteProfile(id: string): Promise<void> {
    const user = this.requireUser()
    this.data.profiles = this.data.profiles.filter(
      (profile) => profile.id !== id || profile.userId !== user.id,
    )
    await this.persist()
  }

  getProfileById(id: string): CandidateProfile | null {
    const user = this.getCurrentUser()
    if (!user) return null
    const profile = this.data.profiles.find(
      (candidate) => candidate.id === id && candidate.userId === user.id,
    )
    return profile ? cloneProfile(profile) : null
  }

  listProfilesByUser(userId: string): CandidateProfileSummary[] {
    return this.data.profiles
      .filter((profile) => profile.userId === userId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        resumeLoaded: Boolean(profile.resumeText),
        instructionsLoaded: Boolean(profile.defaultInstructions),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      }))
  }

  async setSettings(settings: UserSettings): Promise<UserSettings> {
    const user = this.requireUser()
    this.data.settingsByUser[user.id] = { defaultAutoAssist: Boolean(settings.defaultAutoAssist) }
    await this.persist()
    return { ...this.data.settingsByUser[user.id] }
  }

  async updateAccount(displayName: string): Promise<User> {
    const user = this.requireUser()
    user.displayName = displayName.trim() || user.email.split('@')[0]
    await this.persist()
    return { ...user }
  }

  async clearLocalData(): Promise<void> {
    this.data = emptyData()
    await this.storage.clear()
  }

  private requireUser(): User {
    const user = this.data.users.find((candidate) => candidate.id === this.data.currentUserId)
    if (!user) throw new Error('Sign in to continue.')
    return user
  }

  private async persist(): Promise<void> {
    await this.storage.save(this.data)
  }
}

function emptyData(): ProductData {
  return { users: [], interviews: [], profiles: [], settingsByUser: {} }
}

function normalizeData(value: unknown): ProductData {
  if (!value || typeof value !== 'object') return emptyData()
  const candidate = value as Partial<ProductData>
  return {
    users: Array.isArray(candidate.users) ? candidate.users : [],
    currentUserId: typeof candidate.currentUserId === 'string' ? candidate.currentUserId : undefined,
    activeInterviewId: typeof candidate.activeInterviewId === 'string' ? candidate.activeInterviewId : undefined,
    interviews: Array.isArray(candidate.interviews) ? candidate.interviews : [],
    profiles: Array.isArray(candidate.profiles) ? candidate.profiles : [],
    settingsByUser: candidate.settingsByUser && typeof candidate.settingsByUser === 'object'
      ? candidate.settingsByUser
      : {},
  }
}

function cloneInteraction(interaction: RecentInteraction): RecentInteraction {
  return {
    ...interaction,
    conversation: interaction.conversation.map((segment) => ({ ...segment })),
  }
}

function cloneSession(session: InterviewSession): InterviewSession {
  return {
    ...session,
    context: { ...session.context },
    history: session.history.map(cloneInteraction),
  }
}

function cloneProfile(profile: CandidateProfile): CandidateProfile {
  return { ...profile }
}

function toSessionSummary(session: InterviewSession): InterviewSessionSummary {
  return {
    id: session.id,
    name: session.name,
    company: session.company,
    role: session.role,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    resumeLoaded: Boolean(session.context.resumeText),
    jobDescriptionLoaded: Boolean(session.context.jobDescriptionText),
    instructionsLoaded: Boolean(session.context.instructions),
    historyTurns: session.history.length,
  }
}
