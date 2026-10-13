import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

type VerificationState = 'verifying' | 'verified' | 'invalid'

export function VerifyEmailPage() {
  const { verifyEmail, status } = useAuth()
  const location = useLocation()
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? '')
  const [result, setResult] = useState<VerificationState>(token ? 'verifying' : 'invalid')
  const started = useRef(false)

  useEffect(() => {
    window.history.replaceState(window.history.state, '', location.pathname)
    if (!token || started.current) return
    started.current = true
    void verifyEmail(token).then(() => setResult('verified')).catch(() => setResult('invalid'))
  }, [location.pathname, token, verifyEmail])

  return (
    <section className="account-flow-page" aria-labelledby="verification-title">
      <div className="account-flow-card result-card" aria-live="polite">
        {result === 'verifying' && <>
          <span className="loading-ring" aria-hidden="true" />
          <h1 id="verification-title">Verifying your email</h1>
          <p>This should only take a moment.</p>
        </>}
        {result === 'verified' && <>
          <span className="result-icon success" aria-hidden="true">✓</span>
          <h1 id="verification-title">Email verified</h1>
          <p>Your email address is confirmed and your account is ready.</p>
          <Link className="button" to={status === 'authenticated' ? '/dashboard' : '/login'}>{status === 'authenticated' ? 'Open dashboard' : 'Sign in'}</Link>
        </>}
        {result === 'invalid' && <>
          <span className="result-icon error" aria-hidden="true">!</span>
          <h1 id="verification-title">Link expired or invalid</h1>
          <p>This verification link is missing, expired, already used, or invalid. Sign in to request a new one.</p>
          <Link className="button" to="/login">Go to sign in</Link>
        </>}
      </div>
    </section>
  )
}
