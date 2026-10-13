import { NavLink, Outlet } from 'react-router-dom'
import { Brand } from './Brand'
import { useAuth } from '../auth/AuthContext'

const navClass = ({ isActive }: { isActive: boolean }) => isActive ? 'nav-link is-active' : 'nav-link'

export function SiteLayout() {
  const { status } = useAuth()
  const authenticated = status === 'authenticated'
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="site-header-inner">
          <Brand />
          <nav className="desktop-navigation" aria-label="Primary navigation">
            <a className="nav-link" href="/#how-it-works">How it works</a>
            {authenticated ? (
              <><NavLink className={navClass} to="/profiles">Profiles</NavLink><NavLink className={navClass} to="/prepare">Prepare</NavLink><NavLink className={navClass} to="/interviews">Interviews</NavLink><NavLink className={navClass} to="/settings">Settings</NavLink><NavLink className="button button-small" to="/dashboard">Dashboard</NavLink></>
            ) : (
              <>
                <NavLink className={navClass} to="/login">Sign in</NavLink>
                <NavLink className="button button-small" to="/register">Request access</NavLink>
              </>
            )}
          </nav>
          <details className="mobile-navigation">
            <summary aria-label="Open navigation">Menu</summary>
            <nav aria-label="Mobile navigation">
              <a href="/#how-it-works">How it works</a>
              {authenticated ? <><NavLink to="/dashboard">Dashboard</NavLink><NavLink to="/profiles">Profiles</NavLink><NavLink to="/prepare">Prepare</NavLink><NavLink to="/interviews">Interviews</NavLink><NavLink to="/settings">Settings</NavLink></> : (
                <>
                  <NavLink to="/login">Sign in</NavLink>
                  <NavLink to="/register">Request access</NavLink>
                </>
              )}
            </nav>
          </details>
        </div>
      </header>

      <main id="main-content">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div>
          <Brand />
          <p>Prepare with context. Interview with focus.</p>
        </div>
        <p className="footer-note">Private beta · Website workspace in active development</p>
      </footer>
    </div>
  )
}
