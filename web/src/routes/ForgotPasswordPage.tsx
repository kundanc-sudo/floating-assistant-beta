import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'

export function ForgotPasswordPage() {
  const { forgotPassword } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    try {
      await forgotPassword(String(data.get('email') ?? ''))
      setSent(true)
    } catch (caught) {
      setError(caught instanceof BrowserApiError ? caught.message : 'The request could not be completed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="account-flow-page" aria-labelledby="forgot-title">
      <div className="account-flow-card">
        <span className="eyebrow">Account recovery</span>
        <h1 id="forgot-title">Reset your password</h1>
        {sent ? (
          <div className="result-state" role="status">
            <span className="result-icon success" aria-hidden="true">✓</span>
            <h2>Check your inbox</h2>
            <p>If an account exists for that email, password reset instructions have been sent.</p>
            <Link className="button" to="/login">Return to sign in</Link>
          </div>
        ) : (
          <>
            <p>Enter your account email and we’ll send you a one-time reset link.</p>
            <form className="account-form" onSubmit={(event) => void submit(event)}>
              <label htmlFor="recovery-email">Email address</label>
              <input id="recovery-email" name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} />
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            </form>
            <Link className="account-flow-link" to="/login">Back to sign in</Link>
          </>
        )}
      </div>
    </section>
  )
}
