import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'

type ResetState = 'validating' | 'ready' | 'invalid'

export function ResetPasswordPage() {
  const { validatePasswordResetToken, resetPassword } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? '')
  const [state, setState] = useState<ResetState>(token ? 'validating' : 'invalid')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    window.history.replaceState(window.history.state, '', location.pathname)
    if (!token || started.current) return
    started.current = true
    void validatePasswordResetToken(token).then(() => setState('ready')).catch(() => setState('invalid'))
  }, [location.pathname, token, validatePasswordResetToken])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password') ?? '')
    const confirmation = String(data.get('passwordConfirmation') ?? '')
    if (password !== confirmation) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await resetPassword(token, password)
      navigate('/login', { replace: true, state: { notice: 'Password updated. Sign in with your new password.' } })
    } catch (caught) {
      if (caught instanceof BrowserApiError && caught.code === 'INVALID_OR_EXPIRED_TOKEN') setState('invalid')
      else setError(caught instanceof BrowserApiError ? caught.message : 'Your password could not be updated. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="account-flow-page" aria-labelledby="reset-title">
      <div className="account-flow-card result-card">
        {state === 'validating' && <><span className="loading-ring" aria-hidden="true" /><h1 id="reset-title">Checking your reset link</h1><p>This should only take a moment.</p></>}
        {state === 'invalid' && <>
          <span className="result-icon error" aria-hidden="true">!</span>
          <h1 id="reset-title">Link expired or invalid</h1>
          <p>This password reset link is missing, expired, already used, or invalid.</p>
          <Link className="button" to="/forgot-password">Request a new link</Link>
        </>}
        {state === 'ready' && <>
          <span className="eyebrow">Account recovery</span>
          <h1 id="reset-title">Choose a new password</h1>
          <p>Use at least 8 characters and choose something unique to this account.</p>
          <form className="account-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="new-password">New password</label>
            <input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={busy} />
            <label htmlFor="confirm-password">Confirm new password</label>
            <input id="confirm-password" name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={busy} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
          </form>
        </>}
      </div>
    </section>
  )
}
