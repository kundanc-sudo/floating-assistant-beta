import { createHash, randomBytes } from 'node:crypto'
import { compare, hash, truncates } from 'bcryptjs'
import type { ProductStore, UserRecord } from '../db/store.js'
import type { EmailService } from '../email/emailService.js'

interface AuthOptions {
  sessionTtlHours: number
  maxSessionsPerUser: number
  passwordResetTtlMinutes: number
  emailVerificationTtlHours: number
  publicBaseUrl: string
  betaMode: boolean
  development: boolean
}

export class AuthService {
  constructor(
    private readonly store: ProductStore,
    private readonly email: EmailService,
    private readonly options: AuthOptions,
  ) {}

  async register(email: string, password: string, displayName: string, inviteCode: string | undefined, deviceLabel: string) {
    validatePassword(password)
    const normalizedEmail = normalizeEmail(email)
    if (await this.store.findUserByEmail(normalizedEmail)) throw conflict('An account with that email already exists.')
    const invite = this.options.betaMode
      ? await this.store.findBetaInvite(hashToken(inviteCode ?? ''), normalizedEmail, new Date())
      : null
    if (this.options.betaMode && !invite) throw forbidden('A valid private-beta invitation is required.', 'BETA_INVITE_REQUIRED')
    const user = await this.store.createUser({
      email: normalizedEmail,
      passwordHash: await hash(password, 12),
      displayName: displayName.trim(),
    })
    if (invite && !await this.store.consumeBetaInvite(invite.id, user.id, new Date())) {
      await this.store.deleteUser(user.id)
      throw conflict('That private-beta invitation has already been used.')
    }
    await this.sendVerification(user)
    return this.issueSession(user, deviceLabel)
  }

  async login(email: string, password: string, deviceLabel: string) {
    const user = await this.store.findUserByEmail(normalizeEmail(email))
    if (!user || !(await compare(password, user.passwordHash))) throw unauthorized('Email or password is incorrect.')
    return this.issueSession(user, deviceLabel)
  }

  async authenticate(token: string) {
    if (!token) return null
    const authenticated = await this.store.findUserBySession(hashToken(token), new Date())
    if (!authenticated) return null
    if (Date.now() - authenticated.session.lastUsedAt.getTime() > 5 * 60_000) {
      authenticated.session.lastUsedAt = new Date()
      await this.store.touchSession(authenticated.session.id, authenticated.session.lastUsedAt)
    }
    return authenticated
  }

  async logout(token: string) {
    if (token) await this.store.deleteSession(hashToken(token))
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.store.listSessions(userId)
    return sessions.map((session) => ({
      id: session.id,
      deviceLabel: session.deviceLabel,
      lastUsedAt: session.lastUsedAt,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      current: session.id === currentSessionId,
    }))
  }

  signOutOtherSessions(userId: string, currentSessionId: string) {
    return this.store.deleteOtherSessions(userId, currentSessionId)
  }

  async requestPasswordReset(email: string) {
    const user = await this.store.findUserByEmail(normalizeEmail(email))
    if (user) {
      await this.store.invalidateAuthTokens(user.id, 'password_reset')
      const token = randomBytes(32).toString('base64url')
      await this.store.createAuthToken({
        userId: user.id,
        type: 'password_reset',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + this.options.passwordResetTtlMinutes * 60_000),
      })
      await this.email.sendPasswordReset({
        email: user.email,
        displayName: user.displayName,
        resetUrl: `${this.options.publicBaseUrl}/reset-password?token=${encodeURIComponent(token)}`,
      }).catch(() => this.logEmailFailure('password_reset', user.id))
    }
    return { message: 'If an account exists for this email, password reset instructions have been sent.' }
  }

  async resetPassword(token: string, password: string) {
    validatePassword(password)
    const user = await this.store.consumeAuthToken(hashToken(token), 'password_reset', new Date())
    if (!user) throw badRequest('The password reset link is invalid or has expired.', 'INVALID_OR_EXPIRED_TOKEN')
    await this.store.updatePasswordAndRevokeSessions(user.id, await hash(password, 12))
  }

  async resendVerification(user: UserRecord) {
    if (user.emailVerifiedAt) return
    await this.sendVerification(user)
  }

  async verifyEmail(token: string) {
    const user = await this.store.consumeAuthToken(hashToken(token), 'email_verification', new Date())
    if (!user) throw badRequest('The verification link is invalid or has expired.', 'INVALID_OR_EXPIRED_TOKEN')
    return this.store.markEmailVerified(user.id, new Date())
  }

  async deleteAccount(user: UserRecord, password: string, confirmation: string) {
    if (confirmation !== 'DELETE') throw badRequest('Type DELETE to confirm account deletion.')
    if (!await compare(password, user.passwordHash)) throw unauthorized('Password is incorrect.')
    await this.store.deleteUser(user.id)
  }

  private async sendVerification(user: UserRecord) {
    await this.store.invalidateAuthTokens(user.id, 'email_verification')
    const token = randomBytes(32).toString('base64url')
    await this.store.createAuthToken({
      userId: user.id,
      type: 'email_verification',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.options.emailVerificationTtlHours * 60 * 60_000),
    })
    await this.email.sendEmailVerification({
      email: user.email,
      displayName: user.displayName,
      verificationUrl: `${this.options.publicBaseUrl}/verify-email?token=${encodeURIComponent(token)}`,
    }).catch(() => this.logEmailFailure('email_verification', user.id))
  }

  private async issueSession(user: UserRecord, deviceLabel: string) {
    const token = randomBytes(32).toString('base64url')
    await this.store.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      deviceLabel: normalizeDeviceLabel(deviceLabel),
      expiresAt: new Date(Date.now() + this.options.sessionTtlHours * 60 * 60_000),
    })
    await this.store.trimSessions(user.id, this.options.maxSessionsPerUser)
    return { token, user: publicUser(user) }
  }

  private logEmailFailure(type: string, userId: string) {
    if (this.options.development) console.error(`[EMAIL] delivery failed type=${type} userId=${userId}`)
  }
}

export function publicUser(user: UserRecord) {
  return { id: user.id, email: user.email, displayName: user.displayName, emailVerified: Boolean(user.emailVerifiedAt) }
}

export function bearerToken(header: string | undefined) {
  return header?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? ''
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeEmail(email: string) { return email.trim().toLowerCase() }
function normalizeDeviceLabel(value: string) { return value.replace(/[^\w .()-]/g, '').trim().slice(0, 80) || 'Windows' }

function validatePassword(password: string) {
  if (password.length < 8) throw badRequest('Password must contain at least 8 characters.')
  if (truncates(password)) throw badRequest('Password must be at most 72 UTF-8 bytes.')
}

function error(statusCode: number, message: string, code?: string) { return Object.assign(new Error(message), { statusCode, code }) }
const badRequest = (message: string, code?: string) => error(400, message, code)
const unauthorized = (message: string) => error(401, message, 'UNAUTHORIZED')
const forbidden = (message: string, code: string) => error(403, message, code)
const conflict = (message: string) => error(409, message, 'CONFLICT')
