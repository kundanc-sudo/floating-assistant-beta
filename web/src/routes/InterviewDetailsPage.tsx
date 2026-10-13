import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'
import type { InterviewTurn, PreparedInterview } from '../auth/types'

export function InterviewDetailsPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { getInterview, completeInterview, deleteInterview, approveCompanionPairing } = useAuth()
  const [interview, setInterview] = useState<PreparedInterview | null>(null)
  const [turns, setTurns] = useState<InterviewTurn[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'complete' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [message, setMessage] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState('')
  const [pairingSuccess, setPairingSuccess] = useState('')
  const pairingRequestInFlight = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setNotFound(false)
    try {
      const result = await getInterview(id)
      setInterview(result.interview)
      setTurns([...result.turns].sort((a, b) => a.sequence - b.sequence))
    } catch (caught) {
      if (caught instanceof BrowserApiError && (caught.status === 404 || caught.status === 400)) setNotFound(true)
      else setError(readError(caught, 'The interview could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [getInterview, id])

  useEffect(() => { void load() }, [load])

  const complete = async () => {
    if (!interview || busy) return
    setBusy('complete'); setError(''); setMessage('')
    try {
      setInterview(await completeInterview(interview.id))
      setMessage('Interview marked as completed.')
    } catch (caught) {
      setError(readError(caught, 'The interview could not be completed.'))
    } finally { setBusy(null) }
  }

  const remove = async () => {
    if (!interview || busy) return
    setBusy('delete'); setError('')
    try {
      await deleteInterview(interview.id)
      navigate('/interviews', { replace: true, state: { notice: 'Interview deleted.' } })
    } catch (caught) {
      setError(readError(caught, 'The interview could not be deleted.'))
      setBusy(null)
    }
  }

  const connectDesktop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!interview || interview.status !== 'active' || pairingRequestInFlight.current) return

    const normalizedCode = normalizePairingCode(pairingCode)
    if (!normalizedCode) {
      setPairingError('Enter the eight-character code shown by the Windows companion.')
      setPairingSuccess('')
      return
    }

    pairingRequestInFlight.current = true
    setPairingBusy(true)
    setPairingError('')
    setPairingSuccess('')
    try {
      await approveCompanionPairing(normalizedCode, interview.id)
      setPairingCode('')
      setPairingSuccess('Desktop connection approved. Return to the Windows companion to continue.')
    } catch (caught) {
      setPairingError(readPairingError(caught))
    } finally {
      pairingRequestInFlight.current = false
      setPairingBusy(false)
    }
  }

  if (loading) return <section className="workspace-page"><div className="history-state"><span className="loading-ring" /><p>Loading interview…</p></div></section>
  if (notFound) return <section className="workspace-page"><div className="history-state error-state"><strong>Interview not found</strong><p>This interview does not exist or is not available to your account.</p><Link className="secondary-button" to="/interviews">Back to interviews</Link></div></section>
  if (!interview) return <section className="workspace-page"><div className="history-state error-state" role="alert"><strong>Interview unavailable</strong><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Try again</button></div></section>

  return <section className="workspace-page interview-detail-page" aria-labelledby="interview-title">
    <Link className="back-link" to="/interviews">← Interview history</Link>
    <div className="interview-detail-heading"><div><span className="eyebrow">Saved interview</span><h1 id="interview-title">{interview.name}</h1><p>{[interview.company, interview.role].filter(Boolean).join(' · ') || 'No company or role added'}</p></div><span className={`interview-status ${interview.status === 'completed' ? 'completed' : 'active'}`}><i />{capitalize(interview.status)}</span></div>
    {message && <p className="dashboard-notice" role="status"><span aria-hidden="true">✓</span>{message}</p>}
    {error && <p className="form-error workspace-alert" role="alert">{error}</p>}
    <div className="interview-metadata"><div><span>Created</span><strong>{formatDateTime(interview.createdAt)}</strong></div><div><span>Last updated</span><strong>{formatDateTime(interview.updatedAt)}</strong></div><div><span>Completed</span><strong>{interview.completedAt ? formatDateTime(interview.completedAt) : 'Not completed'}</strong></div><div><span>Recorded turns</span><strong>{turns.length}</strong></div></div>
    <div className="interview-detail-actions">{interview.status !== 'completed' && <button className="button" type="button" onClick={() => void complete()} disabled={busy !== null}>{busy === 'complete' ? 'Completing…' : 'Mark completed'}</button>}<button className="danger-button" type="button" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>Delete interview</button></div>
    {interview.status === 'active' && <section className="companion-pairing-card" aria-labelledby="connect-desktop-title">
      <div className="companion-pairing-copy">
        <span className="eyebrow">Windows companion</span>
        <h2 id="connect-desktop-title">Connect Desktop</h2>
        <p>Open the Windows companion and enter its one-time pairing code here. You will approve this interview for that companion without sharing your website sign-in.</p>
      </div>
      <form className="companion-pairing-form" onSubmit={(event) => void connectDesktop(event)}>
        <label htmlFor="pairing-code">Pairing code</label>
        <div className="companion-pairing-controls">
          <input
            id="pairing-code"
            name="pairingCode"
            type="text"
            value={pairingCode}
            onChange={(event) => {
              setPairingCode(event.target.value.toUpperCase())
              setPairingError('')
              setPairingSuccess('')
            }}
            placeholder="ABCD-2345"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            aria-describedby="pairing-code-help"
            aria-invalid={pairingError ? 'true' : undefined}
            disabled={pairingBusy}
          />
          <button className="button" type="submit" disabled={pairingBusy || !pairingCode.trim()}>{pairingBusy ? 'Connecting…' : 'Connect Desktop'}</button>
        </div>
        <small id="pairing-code-help">Codes expire quickly and can be used only once.</small>
        {pairingError && <p className="companion-pairing-error" role="alert">{pairingError}</p>}
        {pairingSuccess && <p className="companion-pairing-success" role="status">{pairingSuccess}</p>}
      </form>
    </section>}
    <div className="snapshot-grid"><Snapshot title="Resume snapshot" content={interview.resumeText} empty="No resume snapshot was saved." /><Snapshot title="Job description" content={interview.jobDescriptionText} empty="No job description was saved." /><Snapshot title="AI instructions" content={interview.instructions} empty="No instructions were saved." /></div>
    <section className="turn-history" aria-labelledby="turn-history-title"><div className="section-title-row"><div><span>Conversation record</span><h2 id="turn-history-title">Questions and answers</h2></div><small>{turns.length} {turns.length === 1 ? 'turn' : 'turns'}</small></div>{turns.length === 0 ? <div className="compact-empty"><strong>No recorded turns</strong><p>This prepared interview does not have any saved questions or answers.</p></div> : <ol>{turns.map((turn) => <li key={turn.id}><div className="turn-number" aria-hidden="true">{turn.sequence}</div><div><span>Question</span><p>{turn.question}</p><span>Answer</span><div className="recorded-answer">{turn.answer}</div><time dateTime={turn.createdAt}>{formatDateTime(turn.createdAt)}</time></div></li>)}</ol>}</section>
    {confirmDelete && <div className="modal-backdrop" role="presentation"><div className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="interview-delete-title"><span className="result-icon error" aria-hidden="true">!</span><h2 id="interview-delete-title">Delete {interview.name}?</h2><p>This permanently removes the interview and its recorded questions and answers. Marking an interview complete does not delete it.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setConfirmDelete(false)} disabled={busy !== null}>Cancel</button><button className="danger-button" type="button" onClick={() => void remove()} disabled={busy !== null}>{busy === 'delete' ? 'Deleting…' : 'Delete permanently'}</button></div></div></div>}
  </section>
}

function Snapshot({ title, content, empty }: { title: string; content: string; empty: string }) { return <section><h2>{title}</h2>{content.trim() ? <div className="snapshot-content">{content}</div> : <p className="snapshot-empty">{empty}</p>}</section> }
function formatDateTime(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'Unknown' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function readError(error: unknown, fallback: string) { return error instanceof BrowserApiError ? error.message : fallback }
function normalizePairingCode(value: string) {
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, '')
  return /^[A-Z0-9]{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4)}` : null
}
function readPairingError(error: unknown) {
  if (error instanceof BrowserApiError) {
    if (error.code === 'PAIRING_UNAVAILABLE' || error.status === 404) return 'That pairing code is invalid, expired, or already used. Request a new code in the Windows companion and try again.'
    if (error.code === 'INTERVIEW_NOT_ACTIVE' || error.status === 409) return 'This interview is no longer active and cannot be connected.'
    return error.message
  }
  return 'The desktop connection could not be approved. Please try again.'
}
