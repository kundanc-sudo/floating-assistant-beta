import { Link } from 'react-router-dom'

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Floating Assistant home">
      <span className="brand-mark" aria-hidden="true">FA</span>
      <span>Floating Assistant</span>
    </Link>
  )
}
