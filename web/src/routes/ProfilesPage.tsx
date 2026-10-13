import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'
import type { CandidateProfile, ProfileInput } from '../auth/types'
import { InstructionPresets } from '../components/InstructionPresets'
import { DocumentUpload } from '../components/DocumentUpload'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'

const emptyProfile: ProfileInput = { name: '', resumeText: '', defaultInstructions: '' }

export function ProfilesPage() {
  const { listProfiles, getProfile, createProfile, updateProfile, deleteProfile } = useAuth()
  const [profiles, setProfiles] = useState<CandidateProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedUpdatedAt, setSelectedUpdatedAt] = useState<string | null>(null)
  const [saved, setSaved] = useState<ProfileInput>(emptyProfile)
  const [draft, setDraft] = useState<ProfileInput>(emptyProfile)
  const [loading, setLoading] = useState(true)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CandidateProfile | null>(null)
  const requestSequence = useRef(0)
  const dirty = draft.name !== saved.name || draft.resumeText !== saved.resumeText || draft.defaultInstructions !== saved.defaultInstructions
  const canDiscard = useUnsavedChanges(dirty)

  useEffect(() => {
    let active = true
    void listProfiles().then((items) => { if (active) setProfiles(items) }).catch((caught) => { if (active) setError(readError(caught, 'Profiles could not be loaded.')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [listProfiles])

  const select = async (id: string) => {
    if (id === selectedId || !canDiscard()) return
    const sequence = ++requestSequence.current
    setLoadingProfile(true)
    setError('')
    setMessage('')
    try {
      const profile = await getProfile(id)
      if (sequence !== requestSequence.current) return
      const next = profileInput(profile)
      setSelectedId(profile.id)
      setSelectedUpdatedAt(profile.updatedAt)
      setSaved(next)
      setDraft(next)
    } catch (caught) {
      if (sequence === requestSequence.current) setError(readError(caught, 'This profile could not be opened.'))
    } finally {
      if (sequence === requestSequence.current) setLoadingProfile(false)
    }
  }

  const startNew = () => {
    if (!canDiscard()) return
    requestSequence.current += 1
    setSelectedId(null)
    setSelectedUpdatedAt(null)
    setSaved(emptyProfile)
    setDraft(emptyProfile)
    setError('')
    setMessage('Creating a new profile. Nothing is saved until you choose Save profile.')
  }

  const save = async () => {
    if (!draft.name.trim() || !draft.resumeText.trim() || !draft.defaultInstructions.trim()) {
      setError('Profile name, resume, and AI instructions are required.')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    const input = { name: draft.name.trim(), resumeText: draft.resumeText, defaultInstructions: draft.defaultInstructions }
    try {
      if (selectedId) {
        const latest = await getProfile(selectedId)
        if (latest.updatedAt !== selectedUpdatedAt) {
          setError('This profile changed in another session. Reopen it before saving your edits.')
          return
        }
      }
      const result = selectedId ? await updateProfile(selectedId, input) : await createProfile(input)
      const normalized = profileInput(result)
      setSelectedId(result.id)
      setSelectedUpdatedAt(result.updatedAt)
      setSaved(normalized)
      setDraft(normalized)
      setProfiles((current) => [result, ...current.filter((profile) => profile.id !== result.id)])
      setMessage(selectedId ? 'Profile changes saved.' : 'Profile created.')
    } catch (caught) {
      setError(readError(caught, 'The profile could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    setBusy(true)
    setError('')
    try {
      await deleteProfile(deleteTarget.id)
      setProfiles((current) => current.filter((profile) => profile.id !== deleteTarget.id))
      if (selectedId === deleteTarget.id) {
        setSelectedId(null)
        setSelectedUpdatedAt(null)
        setSaved(emptyProfile)
        setDraft(emptyProfile)
      }
      setDeleteTarget(null)
      setMessage('Profile deleted.')
    } catch (caught) {
      setError(readError(caught, 'The profile could not be deleted.'))
    } finally {
      setBusy(false)
    }
  }

  return <section className="workspace-page" aria-labelledby="profiles-title">
    <div className="workspace-heading"><div><span className="eyebrow">Interview preparation</span><h1 id="profiles-title">Candidate profiles</h1><p>Keep reusable resume text and answer guidance ready for future interviews.</p></div><Link className="secondary-button" to="/prepare">Open preparation workspace</Link></div>
    {message && <p className="dashboard-notice" role="status"><span aria-hidden="true">✓</span>{message}</p>}
    {error && <p className="form-error workspace-alert" role="alert">{error}</p>}
    <div className="profile-workspace">
      <aside className="profile-sidebar" aria-label="Saved profiles">
        <div className="panel-heading"><div><span>Profiles</span><strong>{profiles.length} saved</strong></div><button type="button" onClick={startNew}>+ New</button></div>
        {loading ? <p className="muted-state">Loading profiles…</p> : profiles.length === 0 ? <div className="compact-empty"><strong>No profiles yet</strong><p>Create one to reuse your resume and response style.</p></div> : <ul className="profile-list">
          {profiles.map((profile) => <li key={profile.id}><button className={selectedId === profile.id ? 'is-selected' : ''} type="button" onClick={() => void select(profile.id)}><span>{profile.name}</span><small>Updated {formatShortDate(profile.updatedAt)}</small></button><button className="profile-delete" type="button" aria-label={`Delete ${profile.name}`} onClick={() => setDeleteTarget(profile)}>×</button></li>)}
        </ul>}
      </aside>
      <div className="editor-panel" aria-busy={loadingProfile}>
        <div className="editor-heading"><div><span>{selectedId ? 'Editing profile' : 'New profile'}</span><h2>{selectedId ? draft.name || 'Untitled profile' : 'Create a candidate profile'}</h2></div>{dirty && <small className="unsaved-badge">Unsaved changes</small>}</div>
        {loadingProfile ? <div className="editor-loading"><span className="loading-ring" /><p>Loading latest profile…</p></div> : <div className="editor-fields">
          <Field label="Profile name" count={`${draft.name.length}/120`}><input aria-label="Profile name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={120} placeholder="e.g. Senior backend roles" disabled={busy} /></Field>
          <Field label="Resume text" count={`${draft.resumeText.length.toLocaleString()}/500,000`} help="Paste text or extract it from a document. Changes are saved only when you choose Save profile."><DocumentUpload label="Resume" currentText={draft.resumeText} onApply={(resumeText) => setDraft({ ...draft, resumeText })} disabled={busy} /><textarea aria-label="Resume text" value={draft.resumeText} onChange={(event) => setDraft({ ...draft, resumeText: event.target.value })} maxLength={500000} rows={13} placeholder="Paste your resume text here…" disabled={busy} /></Field>
          <Field label="AI instructions" count={`${draft.defaultInstructions.length.toLocaleString()}/50,000`} help="Describe the response style you want. You can edit a preset after applying it."><InstructionPresets value={draft.defaultInstructions} onChange={(value) => setDraft({ ...draft, defaultInstructions: value })} disabled={busy} /><textarea aria-label="AI instructions" value={draft.defaultInstructions} onChange={(event) => setDraft({ ...draft, defaultInstructions: event.target.value })} maxLength={50000} rows={7} placeholder="Example: Answer conversationally with concise technical examples…" disabled={busy} /></Field>
          <div className="editor-actions"><span>{dirty ? 'Your changes have not been saved.' : selectedId ? 'All profile changes are saved.' : 'Complete all fields to create this profile.'}</span><button className="button" type="button" onClick={() => void save()} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save profile'}</button></div>
        </div>}
      </div>
    </div>
    {deleteTarget && <div className="modal-backdrop" role="presentation"><div className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="profile-delete-title"><span className="result-icon error" aria-hidden="true">!</span><h2 id="profile-delete-title">Delete {deleteTarget.name}?</h2><p>This removes the saved profile. Existing interviews are not deleted.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</button><button className="danger-button" type="button" onClick={() => void remove()} disabled={busy}>{busy ? 'Deleting…' : 'Delete profile'}</button></div></div></div>}
  </section>
}

function Field({ label, count, help, children }: { label: string; count: string; help?: string; children: React.ReactNode }) {
  return <div className="workspace-field"><div className="field-heading"><label>{label}</label><span>{count}</span></div>{help && <p>{help}</p>}{children}</div>
}

function profileInput(profile: CandidateProfile): ProfileInput {
  return { name: profile.name, resumeText: profile.resumeText, defaultInstructions: profile.defaultInstructions }
}

function readError(error: unknown, fallback: string) { return error instanceof BrowserApiError ? error.message : fallback }
function formatShortDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'recently' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) }
