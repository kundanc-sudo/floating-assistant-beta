import { randomBytes, randomInt } from 'node:crypto'
import { hashToken } from '../auth/authService.js'
import type { ProductStore } from '../db/store.js'

const pairingAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const pairingTtlMs = 5 * 60_000

interface PairingOptions {
  sessionTtlHours: number
  maxSessionsPerUser: number
}

export class CompanionPairingService {
  constructor(
    private readonly store: ProductStore,
    private readonly options: PairingOptions,
  ) {}

  async create() {
    const code = createHumanCode()
    const redemptionSecret = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + pairingTtlMs)
    const pairing = await this.store.createCompanionPairing({
      codeHash: hashToken(code),
      redemptionSecretHash: hashToken(redemptionSecret),
      expiresAt,
    })
    return { requestId: pairing.id, pairingCode: code, redemptionSecret, expiresAt: pairing.expiresAt }
  }

  async approve(userId: string, interviewId: string, submittedCode: string) {
    const code = normalizeHumanCode(submittedCode)
    const interview = await this.store.getInterview(userId, interviewId)
    if (!interview) throw pairingError(404, 'Interview not found.', 'INTERVIEW_NOT_FOUND')
    if (interview.status !== 'active') throw pairingError(409, 'Only an active interview can be paired.', 'INTERVIEW_NOT_ACTIVE')
    const pairing = await this.store.approveCompanionPairing({
      userId,
      interviewId,
      codeHash: hashToken(code),
      now: new Date(),
    })
    if (!pairing) throw unavailablePairing()
    return { requestId: pairing.id, status: 'approved' as const, interviewId, expiresAt: pairing.expiresAt }
  }

  async status(requestId: string, redemptionSecret: string) {
    const status = await this.store.getCompanionPairingStatus(requestId, hashToken(redemptionSecret), new Date())
    if (!status) throw unavailablePairing()
    return { requestId, status }
  }

  async redeem(requestId: string, redemptionSecret: string, deviceLabel: string) {
    const token = randomBytes(32).toString('base64url')
    const sessionExpiresAt = new Date(Date.now() + this.options.sessionTtlHours * 60 * 60_000)
    const redeemed = await this.store.redeemCompanionPairing({
      id: requestId,
      redemptionSecretHash: hashToken(redemptionSecret),
      tokenHash: hashToken(token),
      deviceLabel: normalizeDeviceLabel(deviceLabel),
      sessionExpiresAt,
      now: new Date(),
      maxSessionsPerUser: this.options.maxSessionsPerUser,
    })
    if (!redeemed) throw unavailablePairing()
    return { token, interviewId: redeemed.interviewId, expiresAt: redeemed.session.expiresAt }
  }
}

function createHumanCode() {
  let value = ''
  for (let index = 0; index < 8; index += 1) value += pairingAlphabet[randomInt(pairingAlphabet.length)]
  return `${value.slice(0, 4)}-${value.slice(4)}`
}

function normalizeHumanCode(value: string) {
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, '')
  if (!/^[A-Z2-9]{8}$/.test(compact)) throw unavailablePairing()
  return `${compact.slice(0, 4)}-${compact.slice(4)}`
}

function normalizeDeviceLabel(value: string) {
  return value.replace(/[^\w .()-]/g, '').trim().slice(0, 80) || 'Windows companion'
}

function pairingError(statusCode: number, message: string, code: string) {
  return Object.assign(new Error(message), { statusCode, code })
}

function unavailablePairing() {
  return pairingError(404, 'The pairing request is invalid or no longer available.', 'PAIRING_UNAVAILABLE')
}
