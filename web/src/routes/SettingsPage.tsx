import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'
import type { AccountSession } from '../auth/types'

export function SettingsPage() {
  const { user, updateDisplayName, listSessions, logoutOtherSessions, resendVerification, deleteAccount } = useAuth()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<AccountSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [profileBusy, setProfileBusy] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [resendBusy, setResendBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)

  const closeDelete = () => {
    setDeleteOpen(false)
    window.setTimeout(() => deleteButtonRef.current?.focus(), 0)
  }

  useEffect(() => {
    let active = true
    void listSessions().then((result) => { if (active) setSessions(result) }).catch(() => { if (active) setError('Active sessions could not be loaded.') }).finally(() => { if (active) setLoadingSessions(false) })
    return () => { active = false }
  }, [listSessions])

  if (!user) return null

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const displayName = String(new FormData(event.currentTarget).get('displayName') ?? '').trim()
    if (!displayName) {
      setError('Display name is required.')
      return
    }
    setProfileBusy(true)
    setError('')
    setMessage('')
    try {
      await updateDisplayName(displayName)
      setMessage('Account details updated.')
    } catch (caught) {
      setError(accountError(caught, 'Your account details could not be updated.'))
    } finally {
      setProfileBusy(false)
    }
  }

  const revokeOthers = async () => {
    setSessionBusy(true)
    setError('')
    setMessage('')
    try {
      const revoked = await logoutOtherSessions()
      setSessions((current) => current.filter((session) => session.current))
      setMessage(revoked === 1 ? 'One other session was signed out.' : `${revoked} other sessions were signed out.`)
    } catch (caught) {
      setError(accountError(caught, 'Other sessions could not be signed out.'))
    } finally {
      setSessionBusy(false)
    }
  }

  const resend = async () => {
    setResendBusy(true)
    setError('')
    setMessage('')
    try {
      await resendVerification()
      setMessage('A new verification email has been sent. Check your inbox.')
    } catch (caught) {
      setError(accountError(caught, 'The verification email could not be sent. Please try again later.'))
    } finally {
      setResendBusy(false)
    }
  }

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-heading">
        <div><span className="eyebrow">Account</span><h1 id="settings-title">Settings</h1><p>Manage your profile, verification, and signed-in devices.</p></div>
      </div>

      {message && <p className="dashboard-notice" role="status"><span aria-hidden="true">✓</span>{message}</p>}
      {error && <p className="form-error settings-alert" role="alert">{error}</p>}

      <div className="settings-stack">
        <section className="settings-card" aria-labelledby="profile-heading">
          <div className="settings-card-heading"><div><span>Profile</span><h2 id="profile-heading">Account details</h2></div></div>
          <form className="settings-form" onSubmit={(event) => void saveProfile(event)}>
            <div><label htmlFor="settings-name">Display name</label><input id="settings-name" name="displayName" type="text" autoComplete="name" defaultValue={user.displayName} required maxLength={100} disabled={profileBusy} /></div>
            <div><label htmlFor="settings-email">Email address</label><input id="settings-email" type="email" value={user.email} readOnly aria-describedby="email-help" /><small id="email-help">Your account email cannot currently be changed.</small></div>
            <button className="button button-small" type="submit" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save changes'}</button>
          </form>
        </section>

        <section className="settings-card" aria-labelledby="verification-heading">
          <div className="settings-card-heading inline"><div><span>Security</span><h2 id="verification-heading">Email verification</h2></div><strong className={user.emailVerified ? 'status-pill verified' : 'status-pill pending'}><i />{user.emailVerified ? 'Verified' : 'Verification required'}</strong></div>
          <p>{user.emailVerified ? 'Your email address has been verified.' : 'Verify your email before using AI features.'}</p>
          {!user.emailVerified && <button className="secondary-button" type="button" onClick={() => void resend()} disabled={resendBusy}>{resendBusy ? 'Sending…' : 'Resend verification email'}</button>}
        </section>

        <section className="settings-card" aria-labelledby="sessions-heading">
          <div className="settings-card-heading inline"><div><span>Security</span><h2 id="sessions-heading">Active sessions</h2></div><button className="secondary-button" type="button" onClick={() => void revokeOthers()} disabled={sessionBusy || loadingSessions || sessions.filter((session) => !session.current).length === 0}>{sessionBusy ? 'Signing out…' : 'Sign out other sessions'}</button></div>
          {loadingSessions ? <p className="muted-state" role="status">Loading active sessions…</p> : (
            <ul className="session-list">
              {sessions.map((session) => <li key={session.id}>
                <span className="session-device" aria-hidden="true">{session.current ? '●' : '○'}</span>
                <div><strong>{session.deviceLabel || 'Browser'}</strong><span>Last active {formatDate(session.lastUsedAt)}</span></div>
                {session.current && <small>Current session</small>}
              </li>)}
            </ul>
          )}
        </section>

        <section className="settings-card danger-card" aria-labelledby="danger-heading">
          <div><span>Danger zone</span><h2 id="danger-heading">Delete account</h2><p>Permanently delete your account and its private data. This cannot be undone.</p></div>
          <button ref={deleteButtonRef} className="danger-button" type="button" onClick={() => setDeleteOpen(true)}>Delete account</button>
        </section>
      </div>

      {deleteOpen && <DeleteAccountModal onClose={closeDelete} onConfirm={async (password, confirmation) => {
        await deleteAccount(password, confirmation)
        navigate('/login', { replace: true, state: { notice: 'Your account has been deleted.' } })
      }} />}
    </section>
  )
}

function DeleteAccountModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (password: string, confirmation: string) => Promise<void> }) {
  const modalRef = useRef<HTMLDivElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const allowed = Boolean(password) && confirmation === 'DELETE'

  useEffect(() => { passwordRef.current?.focus() }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!allowed) return
    setBusy(true)
    setError('')
    try {
      await onConfirm(password, confirmation)
    } catch (caught) {
      setError(accountError(caught, 'Your account could not be deleted. No changes were made.'))
      setBusy(false)
    }
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) onClose()
    if (event.key === 'Tab') {
      const focusable = [...(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div ref={modalRef} className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" onKeyDown={keyDown}>
      <button className="modal-close" type="button" aria-label="Close confirmation" onClick={onClose} disabled={busy}>×</button>
      <span className="result-icon error" aria-hidden="true">!</span>
      <h2 id="delete-title">Delete your account?</h2>
      <p id="delete-description">This permanently removes your account and associated private data. It cannot be reversed.</p>
      <form className="account-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="delete-password">Current password</label>
        <input ref={passwordRef} id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required />
        <label htmlFor="delete-confirmation">Type DELETE to confirm</label>
        <input id="delete-confirmation" type="text" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} required />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="danger-button" type="submit" disabled={!allowed || busy}>{busy ? 'Deleting…' : 'Delete permanently'}</button></div>
      </form>
    </div>
  </div>
}

function accountError(caught: unknown, fallback: string) {
  return caught instanceof BrowserApiError ? caught.message : fallback
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'recently' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
