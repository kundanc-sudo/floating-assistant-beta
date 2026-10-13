import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <span className="error-code">404</span>
      <h1 id="not-found-title">This page stepped out.</h1>
      <p>The link may be outdated, or the page may not be part of this website preview.</p>
      <Link className="button" to="/">Return home</Link>
    </section>
  )
}
