import { useRef, useState, type DragEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { BrowserApiError } from '../auth/browserApiClient'
import type { ExtractedDocument } from '../auth/types'

const MAX_FILE_BYTES = 5 * 1024 * 1024

interface DocumentUploadProps {
  label: string
  currentText: string
  onApply(text: string): void
  disabled?: boolean
}

export function DocumentUpload({ label, currentText, onApply, disabled = false }: DocumentUploadProps) {
  const { extractDocument } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<{ name: string; size: number } | null>(null)
  const [preview, setPreview] = useState<ExtractedDocument | null>(null)
  const [error, setError] = useState('')
  const inputId = `${label.toLowerCase().replace(/\W+/g, '-')}-upload`

  const process = async (file: File | undefined) => {
    if (!file || disabled || busy) return
    setError('')
    setPreview(null)
    setSelected({ name: file.name, size: file.size })
    if (file.size === 0) return setError('The selected document is empty.')
    if (file.size > MAX_FILE_BYTES) return setError('Documents must be 5 MB or smaller.')
    setBusy(true)
    try {
      setPreview(await extractDocument(file))
    } catch (caught) {
      setError(caught instanceof BrowserApiError ? caught.message : 'The document could not be read. Try another file.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void process(event.dataTransfer.files.item(0) ?? undefined)
  }

  const clear = () => { setSelected(null); setPreview(null); setError('') }

  return <div className="document-upload">
    <div className={`document-dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`} onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }} onDrop={drop} aria-busy={busy}>
      <input ref={inputRef} id={inputId} className="visually-hidden" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => void process(event.target.files?.[0])} disabled={disabled || busy} />
      <div><strong>{busy ? 'Extracting text…' : `Upload ${label}`}</strong><span>PDF, DOCX, or TXT · up to 5 MB</span></div>
      <label className="upload-picker" htmlFor={inputId}>{busy ? 'Please wait' : 'Choose file'}</label>
    </div>
    {selected && <div className="upload-file-row"><span><strong>{selected.name}</strong><small>{formatSize(selected.size)}</small></span>{!busy && <button type="button" onClick={clear} aria-label={`Clear ${selected.name}`}>Clear</button>}</div>}
    {error && <p className="upload-error" role="alert">{error}</p>}
    {preview && <div className="extraction-preview" aria-live="polite">
      <div><span><strong>Text ready to review</strong><small>{preview.characters.toLocaleString()} characters extracted</small></span></div>
      <pre>{preview.text.slice(0, 900)}{preview.text.length > 900 ? '…' : ''}</pre>
      <p>{currentText.trim() ? `Using this text will replace the current ${label.toLowerCase()} draft. Nothing is saved until you use the page’s save action.` : `Using this text fills the ${label.toLowerCase()} editor. Nothing is saved yet.`}</p>
      <div className="extraction-actions"><button className="secondary-button" type="button" onClick={clear}>Keep current text</button><button className="button button-small" type="button" onClick={() => { onApply(preview.text); clear() }}>Use extracted text</button></div>
    </div>}
  </div>
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
