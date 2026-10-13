
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'
import { AuthShell } from '../components/AuthShell'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')

    const data = new FormData(event.currentTarget)

    try {
      await register({
        displayName: String(data.get('displayName') ?? ''),
        email: String(data.get('email') ?? ''),
        password: String(data.get('password') ?? ''),
      })

      navigate('/dashboard', {
        replace: true,
        state: {
          notice: 'Account created. Check your inbox to verify your email.',
        },
      })
    } catch (caught) {
      setError(
        caught instanceof BrowserApiError
          ? caught.message
          : 'Registration could not be completed. Please try again.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your account"
      description="Create your account and prepare for your next interview."
      alternateText="Already have an account?"
      alternateLinkText="Sign in"
      alternateTo="/login"
      onSubmit={(event) => void submit(event)}
      submitLabel="Create account"
      busy={busy}
      error={error}
    >
      <label htmlFor="register-name">Full name</label>
      <input
        id="register-name"
        name="displayName"
        type="text"
        autoComplete="name"
        placeholder="Your name"
        required
        maxLength={100}
        disabled={busy}
      />

      <label htmlFor="register-email">Email address</label>
      <input
        id="register-email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        required
        maxLength={254}
        disabled={busy}
      />

      <label htmlFor="register-password">Password</label>
      <input
        id="register-password"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="At least 8 characters"
        required
        minLength={8}
        maxLength={128}
        disabled={busy}
      />
    </AuthShell>
  )
}
