import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'
import type { InterviewSummary } from '../auth/types'

type StatusFilter = 'all' | 'active' | 'completed'

export function InterviewsPage() {
  const { listInterviews } = useAuth()
  const location = useLocation()
  const [interviews, setInterviews] = useState<InterviewSummary[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const items = await listInterviews()
      setInterviews([...items].sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt)))
    } catch (caught) {
      setError(readError(caught, 'Interview history could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [listInterviews])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return interviews.filter((interview) => {
      const statusMatches = filter === 'all' || interview.status === filter
      const searchMatches = !needle || [interview.name, interview.company, interview.role].some((value) => value?.toLocaleLowerCase().includes(needle))
      return statusMatches && searchMatches
    })
  }, [filter, interviews, query])

  return <section className="workspace-page interviews-page" aria-labelledby="interviews-title">
    {typeof (location.state as { notice?: unknown } | null)?.notice === 'string' && <p className="dashboard-notice" role="status"><span aria-hidden="true">✓</span>{String((location.state as { notice: string }).notice)}</p>}
    <div className="workspace-heading"><div><span className="eyebrow">Session library</span><h1 id="interviews-title">Interview history</h1><p>Review prepared sessions, completed conversations, and recorded answers.</p></div><Link className="button" to="/prepare">Prepare interview</Link></div>
    <div className="history-toolbar">
      <label><span>Search interviews</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, company, or role" /></label>
      <fieldset><legend>Status</legend>{(['all', 'active', 'completed'] as const).map((value) => <button key={value} className={filter === value ? 'is-selected' : ''} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : capitalize(value)}</button>)}</fieldset>
    </div>
    {loading ? <div className="history-state" aria-live="polite"><span className="loading-ring" /><p>Loading interviews…</p></div> : error ? <div className="history-state error-state" role="alert"><strong>Interview history is unavailable</strong><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Try again</button></div> : interviews.length === 0 ? <div className="history-state"><strong>No interviews yet</strong><p>Prepare your first interview to create a saved session.</p><Link className="button button-small" to="/prepare">Prepare interview</Link></div> : visible.length === 0 ? <div className="history-state"><strong>No matching interviews</strong><p>Try a different search or status filter.</p><button className="secondary-button" type="button" onClick={() => { setQuery(''); setFilter('all') }}>Clear filters</button></div> : <div className="interview-list" aria-live="polite">
      <div className="interview-list-heading" aria-hidden="true"><span>Interview</span><span>Status</span><span>Created</span><span>Turns</span><span /></div>
      {visible.map((interview) => <article key={interview.id}>
        <div className="interview-primary"><h2><Link to={`/interviews/${interview.id}`}>{interview.name}</Link></h2><p>{[interview.company, interview.role].filter(Boolean).join(' · ') || 'No company or role added'}</p></div>
        <span className={`interview-status ${interview.status === 'completed' ? 'completed' : 'active'}`}><i />{capitalize(interview.status)}</span>
        <time dateTime={interview.createdAt}>{formatDate(interview.createdAt)}</time>
        <span className="turn-count">{interview.historyTurns} {interview.historyTurns === 1 ? 'turn' : 'turns'}</span>
        <Link className="row-link" to={`/interviews/${interview.id}`} aria-label={`Review ${interview.name}`}>Review <span aria-hidden="true">→</span></Link>
      </article>)}
    </div>}
  </section>
}

function timestamp(value: string) { const parsed = new Date(value).getTime(); return Number.isNaN(parsed) ? 0 : parsed }
function formatDate(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed) }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function readError(error: unknown, fallback: string) { return error instanceof BrowserApiError ? error.message : fallback }
