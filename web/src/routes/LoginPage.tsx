import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'
import { AuthShell } from '../components/AuthShell'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const notice = (location.state as { notice?: unknown } | null)?.notice

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    try {
      await login(String(data.get('email') ?? ''), String(data.get('password') ?? ''))
      const from = (location.state as { from?: unknown } | null)?.from
      navigate(typeof from === 'string' && from.startsWith('/') ? from : '/dashboard', {
        replace: true,
        state: { notice: 'Signed in successfully.' },
      })
    } catch (caught) {
      setError(caught instanceof BrowserApiError ? caught.message : 'Sign in could not be completed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <><AuthShell
      eyebrow="Welcome back"
      title="Sign in to your account"
      description="Continue to your Floating Assistant workspace."
      alternateText="New to Floating Assistant?"
      alternateLinkText="Request access"
      alternateTo="/register"
      onSubmit={(event) => void submit(event)}
      submitLabel="Sign in"
      busy={busy}
      error={error}
    >
      <label htmlFor="login-email">Email address</label>
      <input id="login-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required disabled={busy} />
      <div className="label-row">
        <label htmlFor="login-password">Password</label>
        <Link className="field-link" to="/forgot-password">Forgot password?</Link>
      </div>
      <input id="login-password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required disabled={busy} />
    </AuthShell>{typeof notice === 'string' && <p className="auth-route-notice" role="status">{notice}</p>}</>
  )
}
