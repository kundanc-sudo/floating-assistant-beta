import { createHash, timingSafeEqual } from 'node:crypto'

const developmentCookieName = 'floating_assistant_session'
const productionCookieName = '__Host-floating_assistant_session'

export interface BrowserCookieOptions {
  production: boolean
  maxAgeSeconds: number
}

export function browserCookieName(production: boolean) {
  return production ? productionCookieName : developmentCookieName
}

export function readBrowserSession(cookieHeader: string | undefined, production: boolean) {
  if (!cookieHeader) return ''
  const name = browserCookieName(production)
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    try { return decodeURIComponent(value) } catch { return '' }
  }
  return ''
}

export function createBrowserSessionCookie(token: string, options: BrowserCookieOptions) {
  return [
    `${browserCookieName(options.production)}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${Math.max(1, Math.floor(options.maxAgeSeconds))}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(options.production ? ['Secure'] : []),
  ].join('; ')
}

export function clearBrowserSessionCookie(production: boolean) {
  return [
    `${browserCookieName(production)}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
    ...(production ? ['Secure'] : []),
  ].join('; ')
}

export function createCsrfToken(sessionToken: string) {
  return createHash('sha256').update('floating-assistant-browser-csrf\0').update(sessionToken).digest('base64url')
}

export function csrfTokenMatches(sessionToken: string, candidate: string | undefined) {
  if (!candidate) return false
  const expected = Buffer.from(createCsrfToken(sessionToken))
  const received = Buffer.from(candidate)
  return expected.length === received.length && timingSafeEqual(expected, received)
}
