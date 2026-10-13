import { BrowserApiClient } from './browserApiClient'

const user = { id: 'user-1', email: 'candidate@example.com', displayName: 'Candidate', emailVerified: false }

describe('BrowserApiClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses credentialed requests without exposing a session token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user, csrfToken: 'safe-csrf-value' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const authenticated = await new BrowserApiClient().login('candidate@example.com', 'test-password')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(authenticated).toEqual(user)
    expect(init.credentials).toBe('include')
    expect(body).toEqual({ email: 'candidate@example.com', password: 'test-password' })
    expect((authenticated as unknown as Record<string, unknown>).token).toBeUndefined()
  })

  it('sends the session-bound CSRF token on logout', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user, csrfToken: 'safe-csrf-value' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BrowserApiClient()

    await client.restoreSession()
    await client.logout()

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('safe-csrf-value')
    expect(init.credentials).toBe('include')
  })

  it('treats an unauthorized restoration as an anonymous session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Authentication required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(new BrowserApiClient().restoreSession()).resolves.toBeNull()
  })

  it('keeps recovery tokens in request bodies and uses browser-specific endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { ...user, emailVerified: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BrowserApiClient('https://api.example.com')

    await client.validatePasswordResetToken('one-time-reset-token')
    await client.resetPassword('one-time-reset-token', 'a new strong password')
    await client.verifyEmail('one-time-verification-token')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.com/api/v1/auth/browser/reset-password/validate',
      'https://api.example.com/api/v1/auth/browser/reset-password',
      'https://api.example.com/api/v1/auth/browser/verify-email',
    ])
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('one-time-reset-token')
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ token: 'one-time-reset-token' })
  })

  it('uses the restored CSRF token for profile, session, resend, and deletion requests', async () => {
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ user, csrfToken: 'safe-csrf-value' }))
      .mockResolvedValueOnce(json({ user: { ...user, displayName: 'Updated' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ revoked: 1 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BrowserApiClient()
    await client.restoreSession()
    await client.updateDisplayName('Updated')
    await client.resendVerification()
    await client.logoutOtherSessions()
    await client.deleteAccount('correct horse battery', 'DELETE')

    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(new Headers((call[1] as RequestInit).headers).get('X-CSRF-Token')).toBe('safe-csrf-value')
      expect((call[1] as RequestInit).credentials).toBe('include')
    }
  })

  it('uses credentialed profile and interview APIs with CSRF on every mutation', async () => {
    const profile = { id: 'profile-id', userId: 'user-1', name: 'Synthetic', resumeText: 'resume', defaultInstructions: 'instructions', createdAt: 'now', updatedAt: 'now' }
    const interview = { id: 'interview-id', profileId: profile.id, name: 'Interview', company: null, role: null, resumeText: 'resume', jobDescriptionText: 'job', instructions: 'instructions', status: 'active', createdAt: 'now', updatedAt: 'now', completedAt: null }
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ user, csrfToken: 'safe-csrf-value' }))
      .mockResolvedValueOnce(json({ profiles: [profile] }))
      .mockResolvedValueOnce(json({ profile }))
      .mockResolvedValueOnce(json({ profile }, 201))
      .mockResolvedValueOnce(json({ profile }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ interview }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BrowserApiClient()
    await client.restoreSession()
    await client.listProfiles()
    await client.getProfile(profile.id)
    await client.createProfile({ name: profile.name, resumeText: profile.resumeText, defaultInstructions: profile.defaultInstructions })
    await client.updateProfile(profile.id, { name: profile.name, resumeText: profile.resumeText, defaultInstructions: profile.defaultInstructions })
    await client.deleteProfile(profile.id)
    await client.createInterview({ profileId: profile.id, name: interview.name, resumeText: interview.resumeText, jobDescriptionText: interview.jobDescriptionText, instructions: interview.instructions })

    for (const call of fetchMock.mock.calls.slice(3)) {
      const init = call[1] as RequestInit
      expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('safe-csrf-value')
      expect(init.credentials).toBe('include')
    }
    expect(JSON.parse(String((fetchMock.mock.calls[6][1] as RequestInit).body))).toEqual({ profileId: profile.id, name: interview.name, resumeText: interview.resumeText, jobDescriptionText: interview.jobDescriptionText, instructions: interview.instructions })
  })

  it('uploads document bytes with filename metadata, credentials, and CSRF', async () => {
    const extracted = { filename: 'resume.txt', kind: 'txt', text: 'Synthetic resume', characters: 16 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user, csrfToken: 'safe-csrf-value' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ document: extracted }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BrowserApiClient()
    await client.restoreSession()
    const file = new File(['Synthetic resume'], 'resume.txt', { type: 'text/plain' })

    await expect(client.extractDocument(file)).resolves.toEqual(extracted)
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(init.body).toBe(file)
    expect(init.credentials).toBe('include')
    expect(headers.get('Content-Type')).toBe('application/octet-stream')
    expect(headers.get('X-Document-Name')).toBe('resume.txt')
    expect(headers.get('X-CSRF-Token')).toBe('safe-csrf-value')
  })

  it('uses owned interview history endpoints and CSRF for completion and deletion', async () => {
    const interview = { id: 'interview-id', profileId: null, name: 'Synthetic interview', company: null, role: null, resumeText: 'resume', jobDescriptionText: 'job', instructions: 'instructions', status: 'active', historyTurns: 1, createdAt: 'now', updatedAt: 'now', completedAt: null }
    const turn = { id: 'turn-id', sessionId: interview.id, requestId: 'request-id', sequence: 1, question: 'Question', answer: 'Answer', createdAt: 'now' }
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ user, csrfToken: 'safe-csrf-value' }))
      .mockResolvedValueOnce(json({ interviews: [interview] }))
      .mockResolvedValueOnce(json({ interview }))
      .mockResolvedValueOnce(json({ turns: [turn] }))
      .mockResolvedValueOnce(json({ interview: { ...interview, status: 'completed' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BrowserApiClient()
    await client.restoreSession()

    await expect(client.listInterviews()).resolves.toEqual([interview])
    await expect(client.getInterview(interview.id)).resolves.toEqual({ interview, turns: [turn] })
    await client.completeInterview(interview.id)
    await client.deleteInterview(interview.id)

    expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
      '/api/v1/interviews',
      '/api/v1/interviews/interview-id',
      '/api/v1/interviews/interview-id/turns',
      '/api/v1/interviews/interview-id/complete',
      '/api/v1/interviews/interview-id',
    ])
    for (const index of [4, 5]) {
      const headers = new Headers((fetchMock.mock.calls[index][1] as RequestInit).headers)
      expect(headers.get('X-CSRF-Token')).toBe('safe-csrf-value')
      expect((fetchMock.mock.calls[index][1] as RequestInit).credentials).toBe('include')
    }
  })

  it('approves companion pairing with cookie authentication and CSRF', async () => {
    const pairing = { requestId: 'pairing-request-1', status: 'approved', interviewId: 'interview-id', expiresAt: '2026-02-03T00:05:00.000Z' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user, csrfToken: 'safe-csrf-value' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ pairing }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new BrowserApiClient('https://api.example.com')
    await client.restoreSession()

    await expect(client.approveCompanionPairing('ABCD-2345', 'interview-id')).resolves.toEqual(pairing)
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/api/v1/companion/pairings/approve')
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('safe-csrf-value')
    expect(JSON.parse(String(init.body))).toEqual({ pairingCode: 'ABCD-2345', interviewId: 'interview-id' })
  })
})
