import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { BrowserApiClient, BrowserApiError } from './auth/browserApiClient'
import type { AuthenticatedUser } from './auth/types'
import { App } from './App'

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'candidate@example.com',
  displayName: 'Candidate',
  emailVerified: false,
}

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: user.id,
  name: 'Backend profile',
  resumeText: 'Experienced backend engineer',
  defaultInstructions: 'Answer concisely with technical examples.',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

const historyInterview = {
  id: '22222222-2222-4222-8222-222222222222',
  profileId: profile.id,
  name: 'Backend interview',
  company: 'Example Company',
  role: 'Senior Engineer',
  resumeText: 'Experienced backend engineer',
  jobDescriptionText: 'Build reliable distributed services.',
  instructions: 'Answer concisely with technical examples.',
  status: 'active',
  historyTurns: 1,
  createdAt: '2026-02-02T00:00:00.000Z',
  updatedAt: '2026-02-03T00:00:00.000Z',
  completedAt: null,
}

const historyTurn = {
  id: '44444444-4444-4444-8444-444444444444',
  sessionId: historyInterview.id,
  requestId: 'request-1',
  sequence: 1,
  question: 'How do you design a reliable queue?',
  answer: 'Use durable storage, idempotent consumers, retries, and a dead-letter queue.',
  createdAt: '2026-02-03T00:00:00.000Z',
}

function renderRoute(route: string, restored: AuthenticatedUser | null = null, setup?: (client: BrowserApiClient) => void) {
  const client = new BrowserApiClient()
  vi.spyOn(client, 'restoreSession').mockResolvedValue(restored)
  vi.spyOn(client, 'logout').mockResolvedValue()
  vi.spyOn(client, 'login').mockResolvedValue(user)
  vi.spyOn(client, 'register').mockResolvedValue(user)
  vi.spyOn(client, 'verifyEmail').mockResolvedValue({ ...user, emailVerified: true })
  vi.spyOn(client, 'resendVerification').mockResolvedValue()
  vi.spyOn(client, 'forgotPassword').mockResolvedValue({ message: 'If an account exists for this email, password reset instructions have been sent.' })
  vi.spyOn(client, 'validatePasswordResetToken').mockResolvedValue()
  vi.spyOn(client, 'resetPassword').mockResolvedValue()
  vi.spyOn(client, 'updateDisplayName').mockImplementation(async (displayName) => ({ ...user, displayName }))
  vi.spyOn(client, 'listSessions').mockResolvedValue([{ id: 'session-1', deviceLabel: 'Browser', lastUsedAt: new Date().toISOString(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), current: true }])
  vi.spyOn(client, 'logoutOtherSessions').mockResolvedValue({ revoked: 0 })
  vi.spyOn(client, 'deleteAccount').mockResolvedValue()
  vi.spyOn(client, 'listProfiles').mockResolvedValue([])
  vi.spyOn(client, 'getProfile').mockResolvedValue(profile)
  vi.spyOn(client, 'createProfile').mockImplementation(async (input) => ({ ...profile, ...input }))
  vi.spyOn(client, 'updateProfile').mockImplementation(async (_id, input) => ({ ...profile, ...input }))
  vi.spyOn(client, 'deleteProfile').mockResolvedValue()
  vi.spyOn(client, 'createInterview').mockImplementation(async (input) => ({ id: '22222222-2222-4222-8222-222222222222', status: 'active', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', completedAt: null, company: null, role: null, ...input, profileId: input.profileId ?? null }))
  vi.spyOn(client, 'listInterviews').mockResolvedValue([])
  vi.spyOn(client, 'getInterview').mockResolvedValue({ interview: historyInterview, turns: [historyTurn] })
  vi.spyOn(client, 'completeInterview').mockResolvedValue({ ...historyInterview, status: 'completed', completedAt: '2026-02-04T00:00:00.000Z' })
  vi.spyOn(client, 'deleteInterview').mockResolvedValue()
  vi.spyOn(client, 'approveCompanionPairing').mockResolvedValue({ requestId: 'pairing-request-1', status: 'approved', interviewId: historyInterview.id, expiresAt: '2026-02-03T00:05:00.000Z' })
  vi.spyOn(client, 'extractDocument').mockResolvedValue({ filename: 'resume.txt', kind: 'txt', text: 'Extracted synthetic resume', characters: 26 })
  setup?.(client)
  const rendered = render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider client={client}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
  return { ...rendered, client }
}

describe('website routing and authentication', () => {
  it('renders the landing page and its primary action', async () => {
    const { client } = renderRoute('/')
    expect(screen.getByRole('heading', { name: /interview support/i })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /create your account/i }).length).toBeGreaterThan(0)
    await waitFor(() => expect(client.restoreSession).toHaveBeenCalledOnce())
  })

  it('renders an accessible login form after session restoration', async () => {
    renderRoute('/login')
    expect(await screen.findByLabelText('Email address')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.queryByText(/httponly|csrf|session token/i)).toBeNull()
  })

  it('shows a sanitized invalid-credentials error', async () => {
    const { client } = renderRoute('/login')
    vi.mocked(client.login).mockRejectedValue(new BrowserApiError('Email or password is incorrect.', 401, 'UNAUTHORIZED'))
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'candidate@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Email or password is incorrect.')
  })

  it('registers and displays the email-verification requirement', async () => {
    const { client } = renderRoute('/register')
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Candidate' } })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'candidate@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Welcome, Candidate' })).toBeTruthy()
    expect(screen.getByText(/verify your email to unlock ai features/i)).toBeTruthy()
    expect(client.register).toHaveBeenCalledWith({
      displayName: 'Candidate',
      email: 'candidate@example.com',
      password: 'correct horse battery',
    })
  })

  it('redirects an anonymous dashboard request to login', async () => {
    renderRoute('/dashboard')
    expect(await screen.findByRole('heading', { name: /sign in to your account/i })).toBeTruthy()
  })

  it('restores an authenticated dashboard after refresh', async () => {
    renderRoute('/dashboard', { ...user, emailVerified: true })
    expect(await screen.findByRole('heading', { name: 'Welcome, Candidate' })).toBeTruthy()
    expect(screen.getByText('Verified')).toBeTruthy()
  })

  it('logs out and returns to login', async () => {
    const { client } = renderRoute('/dashboard', user)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(client.logout).toHaveBeenCalledOnce())
    expect(await screen.findByRole('heading', { name: /sign in to your account/i })).toBeTruthy()
  })

  it('keeps the authenticated view when logout cannot be confirmed', async () => {
    const { client } = renderRoute('/dashboard', user)
    vi.mocked(client.logout).mockRejectedValue(new BrowserApiError('Service unavailable.', 0))
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The server could not confirm sign out. Your session remains active; please try again.')
    expect(screen.getByRole('heading', { name: 'Welcome, Candidate' })).toBeTruthy()
  })

  it('uses a generic forgot-password result', async () => {
    const { client } = renderRoute('/forgot-password')
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'candidate@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeTruthy()
    expect(screen.getByText(/if an account exists/i)).toBeTruthy()
    expect(client.forgotPassword).toHaveBeenCalledWith('candidate@example.com')
  })

  it('verifies an email token and removes it from the visible browser URL', async () => {
    const { client } = renderRoute('/verify-email?token=verification-token-value')
    expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeTruthy()
    expect(client.verifyEmail).toHaveBeenCalledWith('verification-token-value')
    expect(window.location.search).toBe('')
  })

  it('shows a clear invalid verification-link result', async () => {
    renderRoute('/verify-email?token=invalid-verification-token', null, (client) => {
      vi.mocked(client.verifyEmail).mockRejectedValue(new BrowserApiError('The verification link is invalid or has expired.', 400, 'INVALID_OR_EXPIRED_TOKEN'))
    })
    expect(await screen.findByRole('heading', { name: 'Link expired or invalid' })).toBeTruthy()
  })

  it('validates and resets a password without retaining the token', async () => {
    const { client } = renderRoute('/reset-password?token=password-reset-token-value')
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a new strong password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a new strong password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(client.resetPassword).toHaveBeenCalledWith('password-reset-token-value', 'a new strong password'))
    expect(await screen.findByRole('heading', { name: /sign in to your account/i })).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('blocks mismatched reset passwords before calling the backend', async () => {
    const { client } = renderRoute('/reset-password?token=password-reset-token-value')
    await screen.findByRole('heading', { name: 'Choose a new password' })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a new strong password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'another strong password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Passwords do not match.')
    expect(client.resetPassword).not.toHaveBeenCalled()
  })

  it('shows an expired reset-link result before displaying a password form', async () => {
    renderRoute('/reset-password?token=expired-password-reset-token', null, (client) => {
      vi.mocked(client.validatePasswordResetToken).mockRejectedValue(new BrowserApiError('The password reset link is invalid or has expired.', 400, 'INVALID_OR_EXPIRED_TOKEN'))
    })
    expect(await screen.findByRole('heading', { name: 'Link expired or invalid' })).toBeTruthy()
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('updates account details and signs out other sessions', async () => {
    const { client } = renderRoute('/settings', { ...user, emailVerified: true }, (configured) => {
      vi.mocked(configured.listSessions).mockResolvedValue([
        { id: 'session-1', deviceLabel: 'Current browser', lastUsedAt: new Date().toISOString(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), current: true },
        { id: 'session-2', deviceLabel: 'Another browser', lastUsedAt: new Date().toISOString(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), current: false },
      ])
      vi.mocked(configured.logoutOtherSessions).mockResolvedValue({ revoked: 1 })
    })
    const name = await screen.findByLabelText('Display name')
    fireEvent.change(name, { target: { value: 'Updated Candidate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(client.updateDisplayName).toHaveBeenCalledWith('Updated Candidate'))
    expect(await screen.findByText('Account details updated.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out other sessions' }))
    await waitFor(() => expect(client.logoutOtherSessions).toHaveBeenCalledOnce())
    expect(await screen.findByText('One other session was signed out.')).toBeTruthy()
  })

  it('keeps the delete confirmation open when the password is rejected', async () => {
    const { client } = renderRoute('/settings', user, (configured) => {
      vi.mocked(configured.deleteAccount).mockRejectedValue(new BrowserApiError('Password is incorrect.', 401, 'UNAUTHORIZED'))
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong password' } })
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Password is incorrect.')
    expect(client.deleteAccount).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('requires password and exact DELETE before account deletion', async () => {
    const { client } = renderRoute('/settings', user)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
    const confirm = screen.getByRole('button', { name: 'Delete permanently' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'correct horse battery' } })
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(client.deleteAccount).toHaveBeenCalledWith('correct horse battery', 'DELETE'))
    expect(await screen.findByRole('heading', { name: /sign in to your account/i })).toBeTruthy()
  })

  it('creates a candidate profile only after an explicit save', async () => {
    const { client } = renderRoute('/profiles', user)
    expect(await screen.findByText('No profiles yet')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Platform roles' } })
    fireEvent.change(screen.getByLabelText('Resume text'), { target: { value: 'Synthetic resume text' } })
    fireEvent.change(screen.getByLabelText('AI instructions'), { target: { value: 'Give concise technical answers.' } })
    expect(client.createProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(client.createProfile).toHaveBeenCalledWith({ name: 'Platform roles', resumeText: 'Synthetic resume text', defaultInstructions: 'Give concise technical answers.' }))
    expect(await screen.findByText('Profile created.')).toBeTruthy()
  })

  it('previews extracted resume text and requires explicit replacement and save', async () => {
    const { client } = renderRoute('/profiles', user)
    await screen.findByText('No profiles yet')
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Upload profile' } })
    fireEvent.change(screen.getByLabelText('Resume text'), { target: { value: 'Existing unsaved resume' } })
    fireEvent.change(screen.getByLabelText('AI instructions'), { target: { value: 'Answer clearly.' } })
    const file = new File(['Synthetic resume bytes'], 'resume.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Choose file'), { target: { files: [file] } })

    expect(await screen.findByText('Text ready to review')).toBeTruthy()
    expect((screen.getByLabelText('Resume text') as HTMLTextAreaElement).value).toBe('Existing unsaved resume')
    expect(client.createProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use extracted text' }))
    expect((screen.getByLabelText('Resume text') as HTMLTextAreaElement).value).toBe('Extracted synthetic resume')
    expect(client.createProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(client.createProfile).toHaveBeenCalledWith({ name: 'Upload profile', resumeText: 'Extracted synthetic resume', defaultInstructions: 'Answer clearly.' }))
  })

  it('loads the latest profile before editing and saves without creating a duplicate', async () => {
    const { client } = renderRoute('/profiles', user, (configured) => vi.mocked(configured.listProfiles).mockResolvedValue([profile]))
    fireEvent.click((await screen.findByText('Backend profile')).closest('button')!)
    expect(await screen.findByDisplayValue('Experienced backend engineer')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Resume text'), { target: { value: 'Updated synthetic resume' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(client.updateProfile).toHaveBeenCalledWith(profile.id, { name: profile.name, resumeText: 'Updated synthetic resume', defaultInstructions: profile.defaultInstructions }))
    expect(client.createProfile).not.toHaveBeenCalled()
  })

  it('confirms profile deletion and reports API failures', async () => {
    const { client } = renderRoute('/profiles', user, (configured) => {
      vi.mocked(configured.listProfiles).mockResolvedValue([profile])
      vi.mocked(configured.deleteProfile).mockRejectedValue(new BrowserApiError('Profile could not be deleted.', 500))
    })
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${profile.name}` }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Profile could not be deleted.')
    expect(client.deleteProfile).toHaveBeenCalledWith(profile.id)
  })

  it('warns before discarding unsaved profile edits', async () => {
    const second = { ...profile, id: '33333333-3333-4333-8333-333333333333', name: 'Second profile' }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { client } = renderRoute('/profiles', user, (configured) => vi.mocked(configured.listProfiles).mockResolvedValue([profile, second]))
    fireEvent.click((await screen.findByText('Backend profile')).closest('button')!)
    await screen.findByDisplayValue('Experienced backend engineer')
    fireEvent.change(screen.getByLabelText('Resume text'), { target: { value: 'Unsaved resume edit' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(screen.getByText('Second profile').closest('button')!)
    expect(confirm).toHaveBeenCalledOnce()
    expect(client.getProfile).not.toHaveBeenCalledWith(second.id)
    confirm.mockRestore()
  })

  it('does not overwrite a profile changed in another session', async () => {
    const { client } = renderRoute('/profiles', user, (configured) => {
      vi.mocked(configured.listProfiles).mockResolvedValue([profile])
      vi.mocked(configured.getProfile)
        .mockResolvedValueOnce(profile)
        .mockResolvedValueOnce({ ...profile, updatedAt: '2026-01-04T00:00:00.000Z' })
    })
    fireEvent.click((await screen.findByText('Backend profile')).closest('button')!)
    await screen.findByDisplayValue('Experienced backend engineer')
    fireEvent.change(screen.getByLabelText('Resume text'), { target: { value: 'Potentially stale edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This profile changed in another session. Reopen it before saving your edits.')
    expect(client.updateProfile).not.toHaveBeenCalled()
  })

  it('keeps the job description as a draft until interview creation', async () => {
    const { client } = renderRoute('/prepare', user, (configured) => vi.mocked(configured.listProfiles).mockResolvedValue([profile]))
    fireEvent.change(await screen.findByLabelText('Candidate profile'), { target: { value: profile.id } })
    expect(await screen.findByDisplayValue('Experienced backend engineer')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Interview name'), { target: { value: 'Synthetic platform interview' } })
    fireEvent.change(screen.getByLabelText(/^Company/), { target: { value: 'Example Company' } })
    fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: 'Backend Engineer' } })
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Synthetic job description draft' } })
    expect(client.createInterview).not.toHaveBeenCalled()
    expect(screen.getByText('This draft has unsaved changes.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create interview' }))
    await waitFor(() => expect(client.createInterview).toHaveBeenCalledWith({ profileId: profile.id, name: 'Synthetic platform interview', company: 'Example Company', role: 'Backend Engineer', resumeText: profile.resumeText, jobDescriptionText: 'Synthetic job description draft', instructions: profile.defaultInstructions }))
    expect(await screen.findByText('22222222-2222-4222-8222-222222222222')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /start listening/i })).toBeNull()
  })

  it('asks before a preset replaces user-written instructions', async () => {
    renderRoute('/prepare', user, (configured) => vi.mocked(configured.listProfiles).mockResolvedValue([profile]))
    fireEvent.change(await screen.findByLabelText('Candidate profile'), { target: { value: profile.id } })
    const instructions = await screen.findByLabelText('Preparation AI instructions') as HTMLTextAreaElement
    fireEvent.change(instructions, { target: { value: 'My custom instruction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Technical' }))
    expect(screen.getByText(/replace your current instructions/i)).toBeTruthy()
    expect(instructions.value).toBe('My custom instruction')
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect(instructions.value).toBe('My custom instruction')
  })

  it('lists interviews newest first and supports search and status filters', async () => {
    const olderCompleted = { ...historyInterview, id: '55555555-5555-4555-8555-555555555555', name: 'Frontend interview', company: 'Older Company', role: 'UI Engineer', status: 'completed', historyTurns: 0, createdAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-02T00:00:00.000Z' }
    renderRoute('/interviews', user, (client) => vi.mocked(client.listInterviews).mockResolvedValue([olderCompleted, historyInterview]))
    const rows = await screen.findAllByRole('article')
    expect(rows[0].textContent).toContain('Backend interview')
    expect(rows[1].textContent).toContain('Frontend interview')

    fireEvent.change(screen.getByLabelText('Search interviews'), { target: { value: 'Older Company' } })
    expect(screen.queryByText('Backend interview')).toBeNull()
    expect(screen.getByText('Frontend interview')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search interviews'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    expect(screen.queryByText('Backend interview')).toBeNull()
    expect(screen.getByText('Frontend interview')).toBeTruthy()
  })

  it('shows interview loading errors with a working retry action', async () => {
    const { client } = renderRoute('/interviews', user, (configured) => vi.mocked(configured.listInterviews).mockRejectedValueOnce(new BrowserApiError('History unavailable.', 500)).mockResolvedValueOnce([historyInterview]))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('History unavailable.'))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Backend interview')).toBeTruthy()
    expect(client.listInterviews).toHaveBeenCalledTimes(2)
  })

  it('loads interview snapshots and displays recorded turns without fabrication', async () => {
    renderRoute(`/interviews/${historyInterview.id}`, user)
    expect(await screen.findByRole('heading', { name: 'Backend interview' })).toBeTruthy()
    expect(screen.getByText(historyInterview.resumeText)).toBeTruthy()
    expect(screen.getByText(historyInterview.jobDescriptionText)).toBeTruthy()
    expect(screen.getByText(historyTurn.question)).toBeTruthy()
    expect(screen.getByText(historyTurn.answer)).toBeTruthy()
  })

  it('shows desktop pairing only for active interviews', async () => {
    const active = renderRoute(`/interviews/${historyInterview.id}`, user)
    expect(await screen.findByRole('heading', { name: 'Connect Desktop' })).toBeTruthy()
    active.unmount()

    renderRoute(`/interviews/${historyInterview.id}`, user, (client) => {
      vi.mocked(client.getInterview).mockResolvedValue({ interview: { ...historyInterview, status: 'completed', completedAt: '2026-02-04T00:00:00.000Z' }, turns: [historyTurn] })
    })
    expect(await screen.findByRole('heading', { name: 'Backend interview' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Connect Desktop' })).toBeNull()
  })

  it('normalizes and approves a desktop pairing code, then clears it', async () => {
    const { client } = renderRoute(`/interviews/${historyInterview.id}`, user)
    const input = await screen.findByLabelText('Pairing code') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abcd2345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect Desktop' }))

    await waitFor(() => expect(client.approveCompanionPairing).toHaveBeenCalledWith('ABCD-2345', historyInterview.id))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Desktop connection approved.'))
    expect(input.value).toBe('')
  })

  it('shows a clear invalid or expired pairing-code error', async () => {
    renderRoute(`/interviews/${historyInterview.id}`, user, (client) => {
      vi.mocked(client.approveCompanionPairing).mockRejectedValue(new BrowserApiError('The pairing request is invalid or no longer available.', 404, 'PAIRING_UNAVAILABLE'))
    })
    fireEvent.change(await screen.findByLabelText('Pairing code'), { target: { value: 'WXYZ-6789' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect Desktop' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('invalid, expired, or already used'))
  })

  it('prevents duplicate desktop pairing submissions while approval is pending', async () => {
    let resolveApproval: (() => void) | undefined
    const pendingApproval = new Promise<void>((resolve) => { resolveApproval = resolve })
    const { client } = renderRoute(`/interviews/${historyInterview.id}`, user, (configured) => {
      vi.mocked(configured.approveCompanionPairing).mockImplementation(async () => {
        await pendingApproval
        return { requestId: 'pairing-request-1', status: 'approved', interviewId: historyInterview.id, expiresAt: '2026-02-03T00:05:00.000Z' }
      })
    })
    fireEvent.change(await screen.findByLabelText('Pairing code'), { target: { value: 'ABCD-2345' } })
    const connect = screen.getByRole('button', { name: 'Connect Desktop' })
    fireEvent.click(connect)
    fireEvent.submit(connect.closest('form')!)

    expect(client.approveCompanionPairing).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'Connecting…' }) as HTMLButtonElement).disabled).toBe(true)
    resolveApproval?.()
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Desktop connection approved.'))
  })

  it('shows interview not-found and empty-turn states', async () => {
    const missing = renderRoute('/interviews/99999999-9999-4999-8999-999999999999', user, (client) => vi.mocked(client.getInterview).mockRejectedValue(new BrowserApiError('Interview not found.', 404)))
    expect(await screen.findByText('Interview not found')).toBeTruthy()
    missing.unmount()
    renderRoute(`/interviews/${historyInterview.id}`, user, (client) => vi.mocked(client.getInterview).mockResolvedValue({ interview: historyInterview, turns: [] }))
    expect(await screen.findByText('No recorded turns')).toBeTruthy()
  })

  it('completes an active interview once and refreshes its displayed status', async () => {
    const { client } = renderRoute(`/interviews/${historyInterview.id}`, user)
    const complete = await screen.findByRole('button', { name: 'Mark completed' })
    fireEvent.click(complete)
    await waitFor(() => expect(client.completeInterview).toHaveBeenCalledOnce())
    expect(await screen.findByText('Interview marked as completed.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark completed' })).toBeNull()
  })

  it('reports completion failure and keeps the interview active', async () => {
    const { client } = renderRoute(`/interviews/${historyInterview.id}`, user, (configured) => vi.mocked(configured.completeInterview).mockRejectedValue(new BrowserApiError('Completion failed.', 500)))
    fireEvent.click(await screen.findByRole('button', { name: 'Mark completed' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Completion failed.')
    expect(client.completeInterview).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeTruthy()
  })

  it('requires deletion confirmation and preserves the page on failure', async () => {
    const { client } = renderRoute(`/interviews/${historyInterview.id}`, user, (configured) => vi.mocked(configured.deleteInterview).mockRejectedValue(new BrowserApiError('Deletion failed.', 500)))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete interview' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(client.deleteInterview).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Deletion failed.')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(client.deleteInterview).toHaveBeenCalledOnce()
  })

  it('deletes an interview only after confirmation and returns to history', async () => {
    const { client } = renderRoute(`/interviews/${historyInterview.id}`, user)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete interview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(client.deleteInterview).toHaveBeenCalledWith(historyInterview.id))
    expect(await screen.findByRole('heading', { name: 'Interview history' })).toBeTruthy()
  })

  it('shows real recent interviews on the dashboard', async () => {
    renderRoute('/dashboard', user, (client) => vi.mocked(client.listInterviews).mockResolvedValue([historyInterview]))
    expect(await screen.findByText('Backend interview')).toBeTruthy()
    expect(screen.getByRole('link', { name: /view all interviews/i })).toBeTruthy()
  })

  it('renders the not-found fallback for unknown routes', () => {
    renderRoute('/missing-page')
    expect(screen.getByRole('heading', { name: /this page stepped out/i })).toBeTruthy()
  })
})
