import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const workspaceAreas = [
  { icon: 'P', title: 'Candidate profiles', text: 'Reusable resumes and interview guidance.', availability: 'Available', to: '/profiles' },
  { icon: 'I', title: 'Interview preparation', text: 'Role context and structured session setup.', availability: 'Available', to: '/prepare' },
  { icon: 'H', title: 'Interview history', text: 'Review prepared sessions and recorded answers.', availability: 'Available', to: '/interviews' },
]

export function DashboardPage() {
  const { user, logout, resendVerification, listInterviews } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [resendBusy, setResendBusy] = useState(false)
  const [recentInterviews, setRecentInterviews] = useState<Awaited<ReturnType<typeof listInterviews>>>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [recentError, setRecentError] = useState(false)
  const notice = (location.state as { notice?: unknown } | null)?.notice

  useEffect(() => {
    let active = true
    setRecentLoading(true)
    void listInterviews().then((items) => {
      if (!active) return
      setRecentInterviews([...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 3))
      setRecentError(false)
    }).catch(() => { if (active) setRecentError(true) }).finally(() => { if (active) setRecentLoading(false) })
    return () => { active = false }
  }, [listInterviews])

  const signOut = async () => {
    setBusy(true)
    setError('')
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      setError('The server could not confirm sign out. Your session remains active; please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!user) return null

  const resend = async () => {
    setResendBusy(true)
    setError('')
    setMessage('')
    try {
      await resendVerification()
      setMessage('A new verification email has been sent. Check your inbox.')
    } catch {
      setError('The verification email could not be sent. Please try again later.')
    } finally {
      setResendBusy(false)
    }
  }

  const initial = (user.displayName.trim()[0] || user.email[0] || 'U').toUpperCase()

  return (
    <section className="dashboard-page" aria-labelledby="dashboard-title">
      {typeof notice === 'string' && <p className="dashboard-notice" role="status"><span aria-hidden="true">✓</span>{notice}</p>}
      {message && <p className="dashboard-notice" role="status"><span aria-hidden="true">✓</span>{message}</p>}

      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">Workspace overview</span>
          <h1 id="dashboard-title">Welcome, {user.displayName}</h1>
          <p>Your account is ready. Additional workspace tools will appear here as they become available.</p>
        </div>
        <span className="beta-badge">Private beta</span>
      </div>

      {!user.emailVerified && (
        <div className="verification-banner" role="status">
          <span aria-hidden="true">!</span>
          <div>
            <strong>Verify your email to unlock AI features</strong>
            <p>Open the verification link sent to {user.email}. Your account remains accessible while verification is pending.</p>
          </div>
          <button className="verification-action" type="button" onClick={() => void resend()} disabled={resendBusy}>{resendBusy ? 'Sending…' : 'Resend email'}</button>
        </div>
      )}

      {error && <p className="form-error dashboard-error" role="alert">{error}</p>}

      <section className="dashboard-section" aria-labelledby="workspace-section-title">
        <div className="dashboard-section-heading">
          <div><span>Workspace</span><h2 id="workspace-section-title">Prepare for your next conversation</h2></div>
          <p>These areas are being introduced incrementally.</p>
        </div>
        <div className="dashboard-grid">
          {workspaceAreas.map((area) => (
            <article key={area.title}>
              <div className="dashboard-card-top"><span className="workspace-icon" aria-hidden="true">{area.icon}</span><small>{area.availability}</small></div>
              <h3>{area.title}</h3>
              <p>{area.text}</p>
              {area.to ? <Link className="workspace-card-link" to={area.to}>Open <span aria-hidden="true">→</span></Link> : <div className="unavailable-state"><i aria-hidden="true" /> Not available yet</div>}
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-section recent-interviews-section" aria-labelledby="recent-interviews-title">
        <div className="dashboard-section-heading compact"><div><span>Recent activity</span><h2 id="recent-interviews-title">Recent interviews</h2></div><Link className="workspace-card-link" to="/interviews">View all interviews <span aria-hidden="true">→</span></Link></div>
        {recentLoading ? <p className="muted-state">Loading recent interviews…</p> : recentError ? <p className="form-error" role="alert">Recent interviews could not be loaded.</p> : recentInterviews.length === 0 ? <div className="recent-empty"><p>No interviews have been prepared yet.</p><Link className="secondary-button" to="/prepare">Prepare interview</Link></div> : <div className="recent-interview-list">{recentInterviews.map((interview) => <Link key={interview.id} to={`/interviews/${interview.id}`}><span><strong>{interview.name}</strong><small>{[interview.company, interview.role].filter(Boolean).join(' · ') || 'No company or role added'}</small></span><span className={`interview-status ${interview.status === 'completed' ? 'completed' : 'active'}`}><i />{interview.status === 'completed' ? 'Completed' : 'Active'}</span><time dateTime={interview.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(interview.createdAt))}</time></Link>)}</div>}
      </section>

      <section className="dashboard-section account-section" aria-labelledby="account-section-title">
        <div className="dashboard-section-heading compact">
          <div><span>Account</span><h2 id="account-section-title">Your access</h2></div>
        </div>
        <div className="account-panel">
          <div className="account-identity">
            <span className="account-avatar" aria-hidden="true">{initial}</span>
            <div><strong>{user.displayName}</strong><span>{user.email}</span></div>
          </div>
          <div className="account-detail"><span>Email status</span><strong className={user.emailVerified ? 'verified' : 'unverified'}><i />{user.emailVerified ? 'Verified' : 'Verification required'}</strong></div>
          <div className="account-detail"><span>Account session</span><strong className="verified"><i />Active</strong></div>
          <div className="account-actions"><Link className="secondary-button" to="/settings">Settings</Link><button className="secondary-button" type="button" onClick={() => void signOut()} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</button></div>
        </div>
      </section>
    </section>
  )
}
