import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface AuthShellProps {
  eyebrow: string
  title: string
  description: string
  alternateText: string
  alternateLinkText: string
  alternateTo: string
  children: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  busy: boolean
  error?: string
}

export function AuthShell({
  eyebrow,
  title,
  description,
  alternateText,
  alternateLinkText,
  alternateTo,
  children,
  onSubmit,
  submitLabel,
  busy,
  error,
}: AuthShellProps) {
  return (
    <section className="auth-page" aria-labelledby="auth-title">
      <div className="auth-intro">
        <span className="eyebrow">{eyebrow}</span>
        <h1 id="auth-title">{title}</h1>
        <p>{description}</p>
        <div className="auth-context" aria-hidden="true">
          <span className="auth-context-line" />
          <span>Floating Assistant workspace</span>
        </div>
      </div>
      <div className="auth-card">
        <div className="auth-card-heading">
          <span className="brand-mark" aria-hidden="true">FA</span>
          <div><strong>Account access</strong><small>Enter your details to continue</small></div>
        </div>
        <form onSubmit={onSubmit}>
          {children}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : submitLabel}
          </button>
        </form>
        <p className="auth-alternate">
          {alternateText} <Link to={alternateTo}>{alternateLinkText}</Link>
        </p>
      </div>
    </section>
  )
}
