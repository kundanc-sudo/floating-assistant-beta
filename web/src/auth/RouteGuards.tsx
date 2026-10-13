import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'restoring') return <SessionLoading />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function AnonymousRoute() {
  const { status } = useAuth()
  if (status === 'restoring') return <SessionLoading />
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />
  return <Outlet />
}

function SessionLoading() {
  return (
    <section className="session-loading" aria-live="polite" aria-busy="true">
      <span className="loading-ring" aria-hidden="true" />
      <p>Restoring your secure session…</p>
    </section>
  )
}
