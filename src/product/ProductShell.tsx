import { useEffect, useState } from 'react'
import '../styles/product-shell.css'

type ProductRoute = 'dashboard' | 'setup' | 'profiles' | 'settings'

interface ProductShellProps {
  bootstrap: ProductBootstrap
  onBootstrap: (bootstrap: ProductBootstrap) => void
  onStartAssistant: (interview: { id: string; name: string; company?: string; role?: string }, bootstrap: ProductBootstrap) => void
}

const emptyContextStatus: InterviewContextStatus = {
  resumeLoaded: false,
  resumeChars: 0,
  jobDescriptionLoaded: false,
  jobDescriptionChars: 0,
  instructionsLoaded: false,
  instructionsChars: 0,
  ready: false,
}

export function ProductShell({ bootstrap, onBootstrap, onStartAssistant }: ProductShellProps) {
  const [route, setRoute] = useState<ProductRoute>('dashboard')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [contextStatus, setContextStatus] = useState(emptyContextStatus)
  const [resumeName, setResumeName] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [interviewName, setInterviewName] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')

  if (!bootstrap.user) {
    if (bootstrap.sessionState === 'offline') {
      return <SessionRecoveryScreen onBootstrap={onBootstrap} />
    }
    return <LoginScreen onAuthenticated={onBootstrap} onPaired={onStartAssistant} />
  }

  const beginSetup = async (profileId?: string) => {
    setBusy(true)
    setError('')
    try {
      let status = await window.productAPI.beginNewInterview()
      let profileName = ''
      if (profileId) {
        const result = await window.productAPI.applyProfile(profileId)
        if (!result.success || !result.status) throw new Error(result.error ?? 'Profile could not be loaded.')
        status = result.status
        profileName = result.profile?.name ?? ''
      }
      setContextStatus(status)
      setResumeName(status.resumeLoaded ? 'Saved profile resume' : '')
      setJobDescription('')
      setInstructions('')
      setInterviewName(profileName)
      setCompany('')
      setRole('')
      setRoute('setup')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Interview setup could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  const loadContextFile = async (field: 'resume' | 'jobDescription') => {
    setBusy(true)
    setError('')
    try {
      const result = await window.productAPI.loadContextFile(field)
      if (result.canceled) return
      if (!result.success || !result.status) throw new Error(result.error ?? 'The file could not be loaded.')
      setContextStatus(result.status)
      if (field === 'resume') setResumeName(result.file?.name ?? 'Resume loaded')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The file could not be loaded.')
    } finally {
      setBusy(false)
    }
  }

  const startInterview = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await window.productAPI.startInterview({
        name: interviewName,
        company,
        role,
        jobDescription,
        instructions,
      })
      if (!result.success || !result.interview || !result.bootstrap) {
        throw new Error(result.error ?? 'Interview could not be started.')
      }
      onStartAssistant(result.interview, result.bootstrap)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Interview could not be started.')
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = async () => {
    const name = interviewName.trim() || role.trim() || 'Candidate Profile'
    setBusy(true)
    setError('')
    try {
      if (instructions.trim()) {
        const saved = await window.liveAssistant.setInterviewContextText('instructions', instructions)
        if (!saved.success) throw new Error(saved.error ?? 'Instructions could not be saved.')
      }
      const result = await window.productAPI.saveProfile(name)
      if (!result.success || !result.bootstrap) throw new Error(result.error ?? 'Profile could not be saved.')
      onBootstrap(result.bootstrap)
      setRoute('profiles')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Profile could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const openInterview = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      const result = await window.productAPI.openInterview(id)
      if (!result.success || !result.interview || !result.bootstrap) {
        throw new Error(result.error ?? 'Interview could not be opened.')
      }
      onStartAssistant(result.interview, result.bootstrap)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Interview could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    setBusy(true)
    try {
      onBootstrap(await window.productAPI.logout())
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="product-shell">
      <header className="product-titlebar">
        <span className="product-mark">FA</span>
        <span>Floating Assistant</span>
        <button type="button" onClick={() => window.overlayAPI.quitApp()} aria-label="Close application">×</button>
      </header>
      <div className="product-layout">
        <aside className="product-sidebar">
          <div className="product-brand"><span className="product-mark">FA</span><strong>Floating Assistant</strong></div>
          <nav>
            {(['dashboard', 'profiles', 'settings'] as const).map((item) => (
              <button key={item} className={route === item ? 'is-active' : ''} type="button" onClick={() => setRoute(item)}>
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
            <button type="button" className={route === 'setup' ? 'is-active' : ''} onClick={() => void beginSetup()} disabled={busy}>
              New Interview
            </button>
          </nav>
          <div className="product-user">
            <strong>{bootstrap.user.displayName ?? bootstrap.user.email}</strong>
            <span>{bootstrap.user.email}</span>
            <button type="button" onClick={() => void logout()} disabled={busy}>Logout</button>
          </div>
        </aside>
        <section className="product-content">
          {route === 'dashboard' && (
            <Dashboard
              bootstrap={bootstrap}
              busy={busy}
              onNew={() => void beginSetup()}
              onOpen={(id) => void openInterview(id)}
              onDelete={async (id) => {
                if (!window.confirm('Delete this interview and its completed Q&A history?')) return
                const result = await window.productAPI.deleteInterview(id)
                if (result.bootstrap) onBootstrap(result.bootstrap)
              }}
            />
          )}
          {route === 'setup' && (
            <section className="product-page setup-page">
              <div className="page-heading"><div><span>Interview setup</span><h1>Prepare your session</h1></div></div>
              <div className="setup-grid">
                <label>Interview name<input value={interviewName} onChange={(event) => setInterviewName(event.target.value)} placeholder="Amazon Backend Engineer" /></label>
                <label>Company <small>Optional</small><input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Amazon" /></label>
                <label>Role <small>Optional</small><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Backend Engineer" /></label>
                <div className="setup-field full-width">
                  <span>Resume</span>
                  <button type="button" className="upload-button" onClick={() => void loadContextFile('resume')} disabled={busy}>Upload Resume</button>
                  <p>{contextStatus.resumeLoaded ? `${resumeName || 'Resume'} ✓ Ready` : 'No resume loaded'}</p>
                </div>
                <label className="full-width">Job description <small>Optional</small>
                  <textarea value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="Paste Job Description here…" rows={5} />
                  <button type="button" className="text-upload" onClick={() => void loadContextFile('jobDescription')} disabled={busy}>Or upload JD file</button>
                </label>
                <label className="full-width">Interview instructions
                  <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Paste interview-support prompt here…" rows={6} />
                </label>
              </div>
              <div className="context-checklist">
                <strong>Interview Context</strong>
                <span>Resume <b>{contextStatus.resumeLoaded ? '✓ Ready' : '— Required'}</b></span>
                <span>Job Description <b>{jobDescription.trim() || contextStatus.jobDescriptionLoaded ? '✓ Ready' : '— Optional'}</b></span>
                <span>Instructions <b>{instructions.trim() || contextStatus.instructionsLoaded ? '✓ Ready' : '— Required'}</b></span>
              </div>
              <div className="setup-actions">
                <button type="button" className="secondary-action" onClick={() => void saveProfile()} disabled={busy || !contextStatus.resumeLoaded || (!instructions.trim() && !contextStatus.instructionsLoaded)}>Save as Profile</button>
                <button type="button" className="primary-action" onClick={() => void startInterview()} disabled={busy || !interviewName.trim() || !contextStatus.resumeLoaded || (!instructions.trim() && !contextStatus.instructionsLoaded)}>Start Interview</button>
              </div>
            </section>
          )}
          {route === 'profiles' && (
            <ProfilesPage
              profiles={bootstrap.profiles}
              busy={busy}
              onCreate={() => void beginSetup()}
              onApply={(id) => void beginSetup(id)}
              onEdit={async (id, currentName) => {
                const name = window.prompt('Profile name', currentName)?.trim()
                if (!name || name === currentName) return
                const result = await window.productAPI.saveProfile(name, id)
                if (result.bootstrap) onBootstrap(result.bootstrap)
                else setError(result.error ?? 'Profile could not be updated.')
              }}
              onDelete={async (id) => {
                if (!window.confirm('Delete this profile?')) return
                const result = await window.productAPI.deleteProfile(id)
                if (result.bootstrap) onBootstrap(result.bootstrap)
              }}
            />
          )}
          {route === 'settings' && (
            <SettingsPage bootstrap={bootstrap} onBootstrap={onBootstrap} />
          )}
          {error && <p className="product-error">{error}</p>}
        </section>
      </div>
    </main>
  )
}

function SessionRecoveryScreen({ onBootstrap }: { onBootstrap: (bootstrap: ProductBootstrap) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const retry = async () => {
    setBusy(true)
    setError('')
    try {
      onBootstrap(await window.productAPI.retrySession())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The server is still unavailable.')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setBusy(true)
    setError('')
    try {
      onBootstrap(await window.productAPI.clearLocalData())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The local session could not be cleared.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-shell">
    <div className="login-titlebar"><span>Floating Assistant</span><button type="button" onClick={() => window.overlayAPI.quitApp()}>×</button></div>
    <section className="login-card recovery-card" aria-labelledby="session-recovery-title">
      <div className="product-mark large">FA</div>
      <h1 id="session-recovery-title">Connection unavailable</h1>
      <p>Your encrypted desktop session is still saved. Reconnect to validate it before private interview information is shown.</p>
      {error && <p className="product-error" role="alert">{error}</p>}
      <button className="primary-action" type="button" onClick={() => void retry()} disabled={busy}>{busy ? 'Checking…' : 'Retry Connection'}</button>
      <button className="link-action" type="button" onClick={() => void signOut()} disabled={busy}>Sign out on this device</button>
      <small>Audio and AI features remain stopped until you explicitly open the interview and start listening.</small>
    </section>
  </main>
}

function LoginScreen({ onAuthenticated, onPaired }: {
  onAuthenticated: (bootstrap: ProductBootstrap) => void
  onPaired: (interview: { id: string; name: string; company?: string; role?: string }, bootstrap: ProductBootstrap) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [createMode, setCreateMode] = useState(false)
  const [resetMode, setResetMode] = useState(false)
  const [resetToken, setResetToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pairingMode, setPairingMode] = useState(false)

  if (pairingMode) {
    return <PairingScreen onBack={() => setPairingMode(false)} onConnected={onPaired} />
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      if (resetMode) {
        await window.productAPI.resetPassword(resetToken, password)
        setResetMode(false)
        setError('Password reset. Sign in with your new password.')
        return
      }
      const result = await window.productAPI.login(
        email,
        password,
        createMode ? displayName : undefined,
        createMode ? inviteCode : undefined,
      )
      if (!result.success || !result.bootstrap) throw new Error(result.error ?? 'Sign in failed.')
      onAuthenticated(result.bootstrap)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-shell">
      <div className="login-titlebar"><span>Floating Assistant</span><button type="button" onClick={() => window.overlayAPI.quitApp()}>×</button></div>
      <section className="login-card">
        <div className="product-mark large">FA</div>
        <h1>{resetMode ? 'Reset password' : createMode ? 'Create your account' : 'Welcome back'}</h1>
        <p>{resetMode ? 'Paste the one-time token from your reset link.' : createMode ? 'Create your private-beta account' : 'Sign in to continue to your assistant'}</p>
        {createMode && <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}
        {createMode && <label>Invite code<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} /></label>}
        {!resetMode && <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>}
        {resetMode && <label>Reset token<input value={resetToken} onChange={(event) => setResetToken(event.target.value)} /></label>}
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={createMode ? 'new-password' : 'current-password'} /></label>
        {error && <p className="product-error">{error}</p>}
        <button className="primary-action" type="button" onClick={() => void submit()} disabled={busy}>{resetMode ? 'Reset Password' : createMode ? 'Create Account' : 'Sign In'}</button>
        {!resetMode && !createMode && <button className="pairing-entry-action" type="button" onClick={() => setPairingMode(true)} disabled={busy}>Connect to Website</button>}
        {!resetMode && <button className="link-action" type="button" onClick={() => setCreateMode((value) => !value)}>{createMode ? 'Back to sign in' : 'Create account'}</button>}
        {!createMode && <button className="link-action" type="button" onClick={async () => {
          if (resetMode) { setResetMode(false); return }
          if (!email.trim()) { setError('Enter your email first.'); return }
          const result = await window.productAPI.requestPasswordReset(email)
          setError(result.message)
          setResetMode(true)
        }}>{resetMode ? 'Back to sign in' : 'Forgot password?'}</button>}
        <small>Passwords are securely hashed by the backend and never stored in the desktop app.</small>
      </section>
    </main>
  )
}

function PairingScreen({ onBack, onConnected }: {
  onBack: () => void
  onConnected: (interview: { id: string; name: string; company?: string; role?: string }, bootstrap: ProductBootstrap) => void
}) {
  const [pairing, setPairing] = useState<DesktopPairingState>({ status: 'idle' })
  const [secondsRemaining, setSecondsRemaining] = useState(0)

  useEffect(() => {
    const applyState = (state: DesktopPairingState) => setPairing(state)
    const unsubscribe = window.productAPI.onDesktopPairingState(applyState)
    void window.productAPI.getDesktopPairing().then(applyState)
    return () => {
      unsubscribe()
      void window.productAPI.cancelDesktopPairing()
    }
  }, [])

  useEffect(() => {
    if (!pairing.expiresAt || !['pending', 'approved'].includes(pairing.status)) {
      setSecondsRemaining(0)
      return
    }
    const update = () => setSecondsRemaining(Math.max(0, Math.ceil((Date.parse(pairing.expiresAt!) - Date.now()) / 1_000)))
    update()
    const timer = window.setInterval(update, 1_000)
    return () => window.clearInterval(timer)
  }, [pairing.expiresAt, pairing.status])

  const generate = async () => {
    setPairing({ status: 'pending' })
    try {
      setPairing(await window.productAPI.startDesktopPairing())
    } catch {
      setPairing({ status: 'failed', error: 'A pairing code could not be created. Check your connection and try again.' })
    }
  }

  const cancel = async () => {
    try { setPairing(await window.productAPI.cancelDesktopPairing()) } catch { setPairing({ status: 'cancelled' }) }
  }

  const waiting = pairing.status === 'pending' || pairing.status === 'approved'
  return <main className="login-shell">
    <div className="login-titlebar"><span>Floating Assistant</span><button type="button" onClick={() => window.overlayAPI.quitApp()}>×</button></div>
    <section className="login-card pairing-card" aria-labelledby="desktop-pairing-title">
      <div className="product-mark large">FA</div>
      <h1 id="desktop-pairing-title">Connect to Website</h1>
      <p>Generate a one-time code, then approve it from an active interview on the Floating Assistant website.</p>
      {pairing.pairingCode && waiting && <div className="pairing-code-block" aria-live="polite">
        <span>One-time pairing code</span>
        <strong>{pairing.pairingCode}</strong>
        <small>{pairing.status === 'approved' ? 'Approved. Securing your desktop session…' : `Expires in ${formatCountdown(secondsRemaining)}`}</small>
      </div>}
      {pairing.status === 'pending' && !pairing.pairingCode && <div className="pairing-state" role="status">Creating a secure pairing code…</div>}
      {pairing.status === 'expired' && <div className="pairing-state error" role="alert">This code expired. Generate a new code to continue.</div>}
      {pairing.status === 'failed' && <div className="pairing-state error" role="alert">{pairing.error ?? 'Desktop pairing failed. Generate a new code to try again.'}</div>}
      {pairing.status === 'cancelled' && <div className="pairing-state" role="status">Pairing cancelled.</div>}
      {pairing.status === 'connected' && pairing.connection && <div className="pairing-state connected" role="status">Connected securely to <strong>{pairing.connection.interview.name}</strong>. Audio has not started.</div>}
      {pairing.error && pairing.status === 'pending' && <div className="pairing-state warning" role="status">{pairing.error}</div>}
      <div className="pairing-actions">
        {pairing.status === 'connected' && pairing.connection && <button className="primary-action" type="button" onClick={() => onConnected(pairing.connection!.interview, pairing.connection!.bootstrap)}>Open Approved Interview</button>}
        {!waiting && pairing.status !== 'connected' && <button className="primary-action" type="button" onClick={() => void generate()}>Generate Pairing Code</button>}
        {waiting && <button className="secondary-action" type="button" onClick={() => void cancel()}>Cancel Pairing</button>}
        <button className="link-action" type="button" onClick={onBack}>Back to sign in</button>
      </div>
      <small>The pairing secret and desktop session stay protected in the Windows companion.</small>
    </section>
  </main>
}

function Dashboard({ bootstrap, busy, onNew, onOpen, onDelete }: {
  bootstrap: ProductBootstrap
  busy: boolean
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}) {
  return <section className="product-page">
    <div className="page-heading"><div><span>Dashboard</span><h1>Welcome, {bootstrap.user?.displayName ?? bootstrap.user?.email}</h1></div><button className="primary-action" type="button" onClick={onNew} disabled={busy}>+ New Interview</button></div>
    <div className="section-heading"><h2>Recent Interviews</h2><span>{bootstrap.interviews.length} sessions</span></div>
    <div className="interview-list">
      {bootstrap.interviews.length === 0 && <div className="empty-product-state">No interviews yet. Create your first prepared session.</div>}
      {bootstrap.interviews.map((interview) => <article key={interview.id} className="interview-row">
        <div><strong>{interview.name}</strong><span>{[interview.company, interview.role].filter(Boolean).join(' · ') || 'Interview session'}</span></div>
        <div className="interview-meta"><span>{formatLocalDate(interview.updatedAt)} · {interview.status}</span><button type="button" onClick={() => onOpen(interview.id)} disabled={busy || interview.status !== 'active'}>{interview.status === 'active' ? 'Open' : 'Completed'}</button><button type="button" onClick={() => onDelete(interview.id)} disabled={busy}>Delete</button></div>
      </article>)}
    </div>
  </section>
}

function ProfilesPage({ profiles, busy, onCreate, onApply, onEdit, onDelete }: {
  profiles: ProfileSummary[]
  busy: boolean
  onCreate: () => void
  onApply: (id: string) => void
  onEdit: (id: string, currentName: string) => void
  onDelete: (id: string) => void
}) {
  return <section className="product-page"><div className="page-heading"><div><span>Profiles</span><h1>Reusable candidate setups</h1></div><button className="primary-action" type="button" onClick={onCreate}>Create Profile</button></div><div className="profile-grid">{profiles.length === 0 && <div className="empty-product-state">No profiles saved yet.</div>}{profiles.map((profile) => <article className="profile-card" key={profile.id}><h3>{profile.name}</h3><p>Resume {profile.resumeLoaded ? '✓' : '—'}</p><p>Instructions {profile.instructionsLoaded ? '✓' : '—'}</p><div><button type="button" onClick={() => onApply(profile.id)} disabled={busy}>Select</button><button type="button" onClick={() => onEdit(profile.id, profile.name)} disabled={busy}>Edit</button><button type="button" onClick={() => onDelete(profile.id)} disabled={busy}>Delete</button></div></article>)}</div></section>
}

function SettingsPage({ bootstrap, onBootstrap }: { bootstrap: ProductBootstrap; onBootstrap: (value: ProductBootstrap) => void }) {
  const [name, setName] = useState(bootstrap.user?.displayName ?? '')
  const [auto, setAuto] = useState(bootstrap.settings.defaultAutoAssist)
  const [sessions, setSessions] = useState<Array<{ id: string; deviceLabel: string; lastUsedAt: string; current: boolean }>>([])
  const [message, setMessage] = useState('')
  useEffect(() => { void window.productAPI.listSessions().then(setSessions).catch(() => setMessage('Active sessions could not be loaded.')) }, [])
  return <section className="product-page">
    <div className="page-heading"><div><span>Settings</span><h1>Account and application</h1></div></div>
    <div className="settings-card"><h2>Account</h2><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input value={bootstrap.user?.email ?? ''} disabled /></label><p>Email status: {bootstrap.user?.emailVerified ? 'Verified' : 'Verification required for AI usage'}</p>{!bootstrap.user?.emailVerified && <button type="button" onClick={async () => { await window.productAPI.resendVerification(); setMessage('Verification email requested.') }}>Resend verification</button>}<button type="button" onClick={async () => { const result = await window.productAPI.updateAccount(name); if (result.bootstrap) onBootstrap(result.bootstrap) }}>Save Account</button></div>
    <div className="settings-card"><h2>Active Sessions</h2>{sessions.map((session) => <p key={session.id}><strong>{session.current ? 'This device' : session.deviceLabel}</strong> · Last active {new Date(session.lastUsedAt).toLocaleString()}</p>)}<button type="button" onClick={async () => { const result = await window.productAPI.logoutOtherSessions(); setSessions(await window.productAPI.listSessions()); setMessage(`${result.revoked} other session(s) signed out.`) }}>Sign out all other sessions</button><button type="button" onClick={async () => onBootstrap(await window.productAPI.logout())}>Sign out this session</button></div>
    <div className="settings-card"><h2>Application</h2><label className="toggle-setting"><input type="checkbox" checked={auto} onChange={async (event) => { const next = event.target.checked; setAuto(next); const result = await window.productAPI.updateSettings(next); if (result.bootstrap) onBootstrap(result.bootstrap) }} /> Default Auto Assist on</label></div>
    <div className="settings-card"><h2>Data export</h2><p>Export profile metadata, interview metadata, and completed Q&A history as JSON.</p><button type="button" onClick={async () => { const result = await window.productAPI.exportData(); if (result.success) setMessage('Export saved.') }}>Export My Data</button></div>
    <div className="settings-card danger"><h2>Privacy</h2><p>Clear only this device's encrypted session, or permanently delete the account and all associated product and usage data.</p><button type="button" onClick={async () => { if (!window.confirm('Clear the encrypted local session and cache?')) return; onBootstrap(await window.productAPI.clearLocalData()) }}>Clear Local Session</button><button type="button" onClick={async () => { const confirmation = window.prompt('Type DELETE to permanently delete your account.'); if (confirmation !== 'DELETE') return; const password = window.prompt('Enter your password to confirm.') ?? ''; if (!password) return; onBootstrap(await window.productAPI.deleteAccount(password, confirmation)) }}>Delete Account</button></div>
    {message && <p className="product-error">{message}</p>}
  </section>
}

function formatLocalDate(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}
