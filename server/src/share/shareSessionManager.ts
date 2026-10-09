import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type WebSocket from 'ws'

export type PublishedEvent =
  | { type: 'response_start'; requestId: string }
  | { type: 'response_delta'; requestId: string; delta: string }
  | { type: 'response_complete'; requestId: string }

interface ShareSession {
  sessionId: string
  viewerTokenHash: Buffer
  hostSecretHash: Buffer
  createdAt: number
  expiresAt: number
  currentRequestId: string | null
  currentResponse: string
  streaming: boolean
  viewers: Set<WebSocket>
}

export interface CreatedShareSession {
  sessionId: string
  viewerToken: string
  hostSecret: string
  expiresAt: number
}

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export class ShareSessionManager {
  private readonly sessions = new Map<string, ShareSession>()

  constructor(private readonly ttlMs: number) {}

  create(): CreatedShareSession {
    this.removeExpired()
    const sessionId = randomBytes(18).toString('base64url')
    const viewerToken = createViewerToken()
    const hostSecret = randomBytes(32).toString('base64url')
    const createdAt = Date.now()
    this.sessions.set(sessionId, {
      sessionId,
      viewerTokenHash: hash(viewerToken),
      hostSecretHash: hash(hostSecret),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      currentRequestId: null,
      currentResponse: '',
      streaming: false,
      viewers: new Set(),
    })
    return { sessionId, viewerToken, hostSecret, expiresAt: createdAt + this.ttlMs }
  }

  join(viewerToken: string, socket: WebSocket) {
    this.removeExpired()
    const tokenHash = hash(normalizeToken(viewerToken))
    const session = [...this.sessions.values()].find((candidate) =>
      safeEqual(candidate.viewerTokenHash, tokenHash),
    )
    if (!session) return null
    session.viewers.add(socket)
    socket.once('close', () => session.viewers.delete(socket))
    return {
      type: 'snapshot' as const,
      requestId: session.currentRequestId,
      response: session.currentResponse,
      streaming: session.streaming,
      expiresAt: session.expiresAt,
    }
  }

  publish(sessionId: string, hostSecret: string, event: PublishedEvent) {
    const session = this.authorizeHost(sessionId, hostSecret)
    if (!session) return false
    if (event.type === 'response_start') {
      session.currentRequestId = event.requestId
      session.currentResponse = ''
      session.streaming = true
    } else if (event.requestId !== session.currentRequestId) {
      return true
    } else if (event.type === 'response_delta') {
      session.currentResponse += event.delta
    } else {
      session.streaming = false
    }
    this.broadcast(session, event)
    return true
  }

  stop(sessionId: string, hostSecret: string) {
    const session = this.authorizeHost(sessionId, hostSecret)
    if (!session) return false
    this.endSession(session, 'Sharing session ended.')
    return true
  }

  removeExpired() {
    const now = Date.now()
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now) this.endSession(session, 'Sharing session expired.')
    }
  }

  private authorizeHost(sessionId: string, hostSecret: string) {
    this.removeExpired()
    const session = this.sessions.get(sessionId)
    if (!session || !safeEqual(session.hostSecretHash, hash(hostSecret))) return null
    return session
  }

  private broadcast(session: ShareSession, event: object) {
    const message = JSON.stringify(event)
    for (const viewer of session.viewers) {
      if (viewer.readyState === viewer.OPEN) viewer.send(message)
    }
  }

  private endSession(session: ShareSession, reason: string) {
    this.sessions.delete(session.sessionId)
    this.broadcast(session, { type: 'session_ended', message: reason })
    for (const viewer of session.viewers) viewer.close(4001, reason)
    session.viewers.clear()
  }
}

function createViewerToken() {
  const bytes = randomBytes(12)
  const characters = [...bytes].map((value) => TOKEN_ALPHABET[value % TOKEN_ALPHABET.length])
  return [characters.slice(0, 4), characters.slice(4, 8), characters.slice(8, 12)]
    .map((group) => group.join(''))
    .join('-')
}

function normalizeToken(token: string) {
  return token.trim().toUpperCase()
}

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest()
}

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right)
}
