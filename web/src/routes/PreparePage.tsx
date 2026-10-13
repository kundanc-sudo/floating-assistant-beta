import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'
import type { CandidateProfile, PreparedInterview } from '../auth/types'
import { InstructionPresets } from '../components/InstructionPresets'
import { DocumentUpload } from '../components/DocumentUpload'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'

export function PreparePage() {
  const { listProfiles, getProfile, updateProfile, createInterview } = useAuth()
  const [profiles, setProfiles] = useState<CandidateProfile[]>([])
  const [profile, setProfile] = useState<CandidateProfile | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [instructions, setInstructions] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [created, setCreated] = useState<PreparedInterview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileBusy, setProfileBusy] = useState(false)
  const [interviewBusy, setInterviewBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const requestSequence = useRef(0)
  const profileDirty = Boolean(profile) && (resumeText !== profile?.resumeText || instructions !== profile?.defaultInstructions)
  const hasDraft = Boolean(selectedId || name || company || role || resumeText || instructions || jobDescription)
  const unsaved = profileDirty || (!created && hasDraft)
  const canDiscard = useUnsavedChanges(unsaved)

  useEffect(() => {
    let active = true
    void listProfiles().then((items) => { if (active) setProfiles(items) }).catch((caught) => { if (active) setError(readError(caught, 'Candidate profiles could not be loaded.')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [listProfiles])

  const selectProfile = async (id: string) => {
    if (id === selectedId) return
    if (profileDirty && !canDiscard()) return
    setSelectedId(id)
    setCreated(null)
    setMessage('')
    setError('')
    const sequence = ++requestSequence.current
    if (!id) {
      setProfile(null)
      setResumeText('')
      setInstructions('')
      return
    }
    setLoadingProfile(true)
    try {
      const latest = await getProfile(id)
      if (sequence !== requestSequence.current) return
      setProfile(latest)
      setResumeText(latest.resumeText)
      setInstructions(latest.defaultInstructions)
    } catch (caught) {
      if (sequence === requestSequence.current) {
        setSelectedId('')
        setProfile(null)
        setError(readError(caught, 'The selected profile could not be loaded.'))
      }
    } finally {
      if (sequence === requestSequence.current) setLoadingProfile(false)
    }
  }

  const changeDraft = (setter: (value: string) => void, value: string) => {
    setter(value)
    setCreated(null)
    setMessage('')
  }

  const saveProfile = async () => {
    if (!profile || !resumeText.trim() || !instructions.trim()) {
      setError('Select a profile and complete its resume and AI instructions first.')
      return
    }
    setProfileBusy(true)
    setError('')
    try {
      const latest = await getProfile(profile.id)
      if (latest.updatedAt !== profile.updatedAt) {
        setError('This profile changed in another session. Select it again before saving your edits.')
        return
      }
      const updated = await updateProfile(profile.id, { name: profile.name, resumeText, defaultInstructions: instructions })
      setProfile(updated)
      setProfiles((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMessage('Profile resume and instructions saved.')
    } catch (caught) {
      setError(readError(caught, 'The profile could not be saved.'))
    } finally {
      setProfileBusy(false)
    }
  }

  const create = async () => {
    if (!profile || !name.trim() || !resumeText.trim() || !instructions.trim()) {
      setError('Select a candidate profile and complete the interview name, resume, and AI instructions.')
      return
    }
    setInterviewBusy(true)
    setError('')
    setMessage('')
    try {
      const interview = await createInterview({
        profileId: profile.id,
        name: name.trim(),
        company: company.trim() || null,
        role: role.trim() || null,
        resumeText,
        jobDescriptionText: jobDescription,
        instructions,
      })
      setCreated(interview)
    } catch (caught) {
      setError(readError(caught, 'The interview could not be created.'))
    } finally {
      setInterviewBusy(false)
    }
  }

  return <section className="workspace-page" aria-labelledby="prepare-title">
    <div className="workspace-heading"><div><span className="eyebrow">Interview preparation</span><h1 id="prepare-title">Prepare an interview</h1><p>Combine a saved profile with the role context and guidance for this interview.</p></div><Link className="secondary-button" to="/profiles">Manage profiles</Link></div>
    {message && <p className="dashboard-notice" role="status"><span aria-hidden="true">✓</span>{message}</p>}
    {error && <p className="form-error workspace-alert" role="alert">{error}</p>}

    <div className="prepare-layout">
      <aside className="preparation-summary">
        <span>Preparation status</span>
        <h2>{created ? 'Interview created' : 'Draft in progress'}</h2>
        <dl><div><dt>Candidate profile</dt><dd>{profile?.name ?? 'Not selected'}</dd></div><div><dt>Resume</dt><dd>{resumeText.trim() ? 'Ready' : 'Missing'}</dd></div><div><dt>Job description</dt><dd>{jobDescription.trim() ? 'Added' : 'Optional'}</dd></div><div><dt>Instructions</dt><dd>{instructions.trim() ? 'Ready' : 'Missing'}</dd></div></dl>
        {unsaved && <p className="draft-warning"><i />This draft has unsaved changes.</p>}
        <p className="privacy-note">Draft text stays in this page until you explicitly save the profile or create the interview.</p>
      </aside>

      <div className="preparation-editor">
        <section className="preparation-section" aria-labelledby="candidate-context-title">
          <div className="preparation-section-heading"><div><span>Step 1</span><h2 id="candidate-context-title">Candidate context</h2></div>{profileDirty && <small className="unsaved-badge">Profile changes unsaved</small>}</div>
          {loading ? <p className="muted-state">Loading profiles…</p> : profiles.length === 0 ? <div className="inline-empty"><p>Create a candidate profile before preparing an interview.</p><Link className="button button-small" to="/profiles">Create profile</Link></div> : <>
            <label htmlFor="prepare-profile">Candidate profile</label>
            <select id="prepare-profile" value={selectedId} onChange={(event) => void selectProfile(event.target.value)} disabled={loadingProfile || profileBusy || interviewBusy}><option value="">Select a profile</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            {loadingProfile ? <div className="editor-loading compact"><span className="loading-ring" /><p>Loading latest profile…</p></div> : profile && <>
              <WorkspaceField label="Resume text" count={`${resumeText.length.toLocaleString()}/500,000`} help="Editing or uploading here does not overwrite the saved profile until you choose Save profile."><DocumentUpload label="Resume" currentText={resumeText} onApply={(value) => changeDraft(setResumeText, value)} disabled={profileBusy || interviewBusy} /><textarea aria-label="Preparation resume text" value={resumeText} onChange={(event) => changeDraft(setResumeText, event.target.value)} maxLength={500000} rows={11} disabled={profileBusy || interviewBusy} /></WorkspaceField>
              <WorkspaceField label="AI instructions" count={`${instructions.length.toLocaleString()}/50,000`} help="These instructions retain the existing interview behavior; presets only provide editable text."><InstructionPresets value={instructions} onChange={(value) => changeDraft(setInstructions, value)} disabled={profileBusy || interviewBusy} /><textarea aria-label="Preparation AI instructions" value={instructions} onChange={(event) => changeDraft(setInstructions, event.target.value)} maxLength={50000} rows={6} disabled={profileBusy || interviewBusy} /></WorkspaceField>
              <div className="section-actions"><span>{profileDirty ? 'Profile edits are not saved yet.' : 'Using the latest saved profile.'}</span><button className="secondary-button" type="button" onClick={() => void saveProfile()} disabled={!profileDirty || profileBusy || interviewBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button></div>
            </>}
          </>}
        </section>

        <section className="preparation-section" aria-labelledby="role-context-title">
          <div className="preparation-section-heading"><div><span>Step 2</span><h2 id="role-context-title">Interview details</h2></div><small className="draft-label">Saved only when interview is created</small></div>
          <div className="compact-field-grid"><div><label htmlFor="interview-name">Interview name</label><input id="interview-name" value={name} onChange={(event) => changeDraft(setName, event.target.value)} maxLength={160} placeholder="e.g. Acme backend interview" disabled={interviewBusy} /></div><div><label htmlFor="interview-company">Company <small>Optional</small></label><input id="interview-company" value={company} onChange={(event) => changeDraft(setCompany, event.target.value)} maxLength={160} disabled={interviewBusy} /></div><div><label htmlFor="interview-role">Role <small>Optional</small></label><input id="interview-role" value={role} onChange={(event) => changeDraft(setRole, event.target.value)} maxLength={160} disabled={interviewBusy} /></div></div>
          <WorkspaceField label="Job description" count={`${jobDescription.length.toLocaleString()}/500,000`} help="Paste text or extract a document. This draft stays in memory until you create the interview."><DocumentUpload label="Job description" currentText={jobDescription} onApply={(value) => changeDraft(setJobDescription, value)} disabled={interviewBusy} /><textarea aria-label="Job description" value={jobDescription} onChange={(event) => changeDraft(setJobDescription, event.target.value)} maxLength={500000} rows={12} placeholder="Paste the job description here…" disabled={interviewBusy} /></WorkspaceField>
        </section>

        <div className="create-interview-bar"><div><strong>Create the prepared interview</strong><span>This saves the current snapshot. It does not start audio or the Windows companion.</span></div><button className="button" type="button" onClick={() => void create()} disabled={interviewBusy || loadingProfile || !profile}>{interviewBusy ? 'Creating…' : 'Create interview'}</button></div>

        {created && <section className="created-interview" aria-live="polite"><span className="result-icon success" aria-hidden="true">✓</span><div><small>Interview created</small><h2>{created.name}</h2><p><strong>Status:</strong> {created.status} <span aria-hidden="true">·</span> <strong>ID:</strong> <code>{created.id}</code></p><p>Your preparation is saved. Companion connection and live listening are not available on the website yet.</p></div></section>}
      </div>
    </div>
  </section>
}

function WorkspaceField({ label, count, help, children }: { label: string; count: string; help: string; children: React.ReactNode }) {
  return <div className="workspace-field"><div className="field-heading"><label>{label}</label><span>{count}</span></div><p>{help}</p>{children}</div>
}
function readError(error: unknown, fallback: string) { return error instanceof BrowserApiError ? error.message : fallback }
