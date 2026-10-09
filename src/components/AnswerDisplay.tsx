import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { MarkdownAnswer } from './MarkdownAnswer'
import { isNearLiveAnswerEdge } from '../services/answerDisplayState'
import type { AnswerDisplayAction, AnswerDisplayState, DisplayAnswer } from '../services/answerDisplayState'

interface AnswerDisplayProps {
  state: AnswerDisplayState
  history: RecentInteraction[]
  historyOpen: boolean
  waitingForFirstToken: boolean
  retryAvailable: boolean
  answerFocus: boolean
  copied: boolean
  dispatch: (action: AnswerDisplayAction) => void
  onToggleHistory: () => void
  onRetry: () => void
  onCopy: (answer: string) => void
  onToggleFocus: () => void
  onClearView: () => void
}

export function AnswerDisplay({
  state,
  history,
  historyOpen,
  waitingForFirstToken,
  retryAvailable,
  answerFocus,
  copied,
  dispatch,
  onToggleHistory,
  onRetry,
  onCopy,
  onToggleFocus,
  onClearView,
}: AnswerDisplayProps) {
  const historyEntries = useMemo(() => mergeHistory(state.completed, history), [state.completed, history])
  const preview = state.previewId
    ? historyEntries.find((entry) => entry.id === state.previewId) ?? null
    : null
  const pinned = state.pinnedId
    ? historyEntries.find((entry) => entry.id === state.pinnedId) ?? null
    : null
  const current = state.viewCleared ? null : state.current
  const previous = state.viewCleared
    ? null
    : [...state.completed].reverse().find(
        (entry) => entry.id !== current?.id && entry.id !== pinned?.id,
      ) ?? null
  const readable = preview ?? current ?? pinned ?? previous
  const pinAnswer = useCallback((id: string | null) => {
    dispatch({ type: 'pin', id })
  }, [dispatch])
  const previewAnswer = useCallback((id: string) => {
    dispatch({ type: 'preview', id })
    onToggleHistory()
  }, [dispatch, onToggleHistory])

  return (
    <section className="answer-panel" aria-live="polite">
      <div className="answer-heading">
        <div className="answer-title-group">
          <span className="transcript-label">AI Response</span>
          {waitingForFirstToken && <span className="generating-label">Generating next answer…</span>}
        </div>
        <div className="answer-actions">
          <button type="button" onClick={onToggleHistory} aria-expanded={historyOpen}>History</button>
          {retryAvailable && <button type="button" className="retry-answer" onClick={onRetry}>Retry</button>}
          <button type="button" onClick={() => readable && onCopy(readable.answer)} disabled={!readable?.answer}>{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" onClick={onToggleFocus}>{answerFocus ? 'Exit Focus' : 'Focus'}</button>
          {!answerFocus && <button type="button" onClick={onClearView} disabled={!current && !pinned && !preview}>Clear View</button>}
        </div>
      </div>

      <div className="answer-stack">
        {preview ? (
          <>
            <button className="back-to-current" type="button" onClick={() => dispatch({ type: 'preview', id: null })}>← Back to Current</button>
            <CompletedAnswerCard answer={preview} label="HISTORY" pinned={preview.id === state.pinnedId} onPin={pinAnswer} />
          </>
        ) : (
          <>
            {pinned && pinned.id !== current?.id && (
              <CompletedAnswerCard answer={pinned} label="PINNED" pinned onPin={pinAnswer} />
            )}
            {current && (
              <CurrentAnswerCard
                answer={current}
                label={current.id === state.pinnedId ? 'PINNED · CURRENT' : 'CURRENT'}
                pinned={current.id === state.pinnedId}
                onPin={pinAnswer}
              />
            )}
            {previous && <CompletedAnswerCard answer={previous} label="PREVIOUS" pinned={false} onPin={pinAnswer} />}
            {!current && !pinned && !previous && <p className="answer-placeholder">The streamed answer will appear here…</p>}
          </>
        )}
      </div>

      <HistoryDrawer
        open={historyOpen}
        entries={historyEntries}
        onClose={onToggleHistory}
        onPreview={previewAnswer}
      />
    </section>
  )
}

const CompletedAnswerCard = memo(function CompletedAnswerCard({ answer, label, pinned, onPin }: {
  answer: DisplayAnswer
  label: string
  pinned: boolean
  onPin: (id: string | null) => void
}) {
  return <AnswerCard answer={answer} label={label} pinned={pinned} onPin={onPin} />
})

function CurrentAnswerCard({ answer, label, pinned, onPin }: {
  answer: DisplayAnswer
  label: string
  pinned: boolean
  onPin: (id: string | null) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [follow, setFollow] = useState(true)
  const [showLatest, setShowLatest] = useState(false)
  const answerId = answer.id

  useEffect(() => {
    setFollow(true)
    setShowLatest(false)
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 })
  }, [answerId])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || answer.status !== 'streaming') return
    if (follow) container.scrollTop = container.scrollHeight
    else setShowLatest(true)
  }, [answer.answer, answer.status, follow])

  return (
    <AnswerCard
      answer={answer}
      label={label}
      pinned={pinned}
      onPin={onPin}
      scrollRef={scrollRef}
      onScroll={() => {
        const container = scrollRef.current
        if (!container) return
        const nearEdge = isNearLiveAnswerEdge(
          container.scrollHeight,
          container.scrollTop,
          container.clientHeight,
        )
        setFollow(nearEdge)
        if (nearEdge) setShowLatest(false)
      }}
      showLatest={showLatest}
      onLatest={() => {
        const container = scrollRef.current
        setFollow(true)
        setShowLatest(false)
        container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
      }}
    />
  )
}

function AnswerCard({ answer, label, pinned, onPin, scrollRef, onScroll, showLatest, onLatest }: {
  answer: DisplayAnswer
  label: string
  pinned: boolean
  onPin: (id: string | null) => void
  scrollRef?: RefObject<HTMLDivElement | null>
  onScroll?: () => void
  showLatest?: boolean
  onLatest?: () => void
}) {
  return (
    <article className={`answer-entry answer-${answer.status} ${label === 'PREVIOUS' ? 'is-previous' : ''}`}>
      <header><span>{label}</span><time>{formatTime(answer.createdAt)}</time><button type="button" onClick={() => onPin(pinned ? null : answer.id)}>{pinned ? 'Unpin' : 'Pin'}</button></header>
      {answer.question && <p className="answer-question">{answer.question}</p>}
      <div className="answer-entry-content" ref={scrollRef} onScroll={onScroll} tabIndex={0}>
        {answer.answer ? <MarkdownAnswer content={answer.answer} /> : answer.status === 'failed' ? null : <p className="answer-placeholder">Waiting for the first token…</p>}
        {answer.status === 'failed' && <p className="answer-entry-error">Couldn't generate the next answer.</p>}
      </div>
      {showLatest && <button className="latest-answer" type="button" onClick={onLatest}>↓ Latest</button>}
    </article>
  )
}

const HistoryDrawer = memo(function HistoryDrawer({ open, entries, onClose, onPreview }: {
  open: boolean
  entries: DisplayAnswer[]
  onClose: () => void
  onPreview: (id: string) => void
}) {
  if (!open) return null
  return (
    <aside className="answer-history-drawer" aria-label="Interview History">
      <header><strong>Interview History</strong><button type="button" onClick={onClose} aria-label="Close history">×</button></header>
      <div className="answer-history-list">
        {entries.length === 0 && <p>No completed answers yet.</p>}
        {entries.map((entry) => (
          <button type="button" key={entry.id} onClick={() => onPreview(entry.id)}>
            <time>{formatTime(entry.createdAt)}</time>
            <strong>{entry.question || 'Interview question'}</strong>
            <span>{entry.answer}</span>
          </button>
        ))}
      </div>
    </aside>
  )
})

function mergeHistory(completed: DisplayAnswer[], history: RecentInteraction[]): DisplayAnswer[] {
  const entries = new Map<string, DisplayAnswer>()
  for (const interaction of history) {
    entries.set(interaction.requestId, {
      id: interaction.requestId,
      question: interaction.conversation.map((segment) => segment.text).join(' '),
      answer: interaction.assistantAnswer,
      createdAt: interaction.timestamp,
      status: 'complete',
    })
  }
  for (const answer of completed) entries.set(answer.id, answer)
  return [...entries.values()].sort((left, right) => right.createdAt - left.createdAt)
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
