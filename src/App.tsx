import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AudioCaptureService } from './services/audioCaptureService'
import { SystemAudioCaptureService } from './services/systemAudioCaptureService'
import { MarkdownAnswer } from './components/MarkdownAnswer'

const microphoneCapture = new AudioCaptureService()
const systemAudioCapture = new SystemAudioCaptureService()
type SessionState = 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR'
type TurnState =
  | 'LISTENING'
  | 'CAPTURING'
  | 'TRANSCRIBING'
  | 'VALIDATING'
  | 'AI RESPONDING'

const sourceLabels: Record<AudioMode, string> = {
  microphone: 'MIC',
  system: 'SYSTEM',
  both: 'MIC + SYSTEM',
}

export default function App() {
  const [opacity, setOpacity] = useState(0.7)
  const [privacyMode, setPrivacyMode] = useState(true)
  const [sessionState, setSessionState] = useState<SessionState>('IDLE')
  const [turnState, setTurnState] = useState<TurnState>('LISTENING')
  const [audioMode, setAudioMode] = useState<AudioMode>('microphone')
  const [rawTranscript, setRawTranscript] = useState<Partial<Record<AudioSource, string>>>({})
  const [currentConversation, setCurrentConversation] = useState<ConversationSegment[]>([])
  const [lastAnsweredConversation, setLastAnsweredConversation] = useState<ConversationSegment[]>([])
  const [pendingAnswer, setPendingAnswer] = useState('')
  const [displayedAnswer, setDisplayedAnswer] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [screenCaptureState, setScreenCaptureState] = useState<ScreenCaptureState>('IDLE')
  const [error, setError] = useState('')
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceMessage[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const activeRequestId = useRef<string | null>(null)
  const pendingAnswerContext = useRef<ConversationSegment[]>([])
  const sessionGeneration = useRef(0)
  const answerScrollRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowAnswer = useRef(true)
  const isRunning = sessionState === 'STARTING' || sessionState === 'RUNNING' || sessionState === 'STOPPING'

  useEffect(() => {
    void window.overlayAPI.getOpacity().then(setOpacity)
    void window.overlayAPI.getPrivacyMode().then((result) => {
      setPrivacyMode(result.enabled)
      if (!result.success) setError(result.error ?? 'Privacy Mode could not be initialized.')
    })
    void window.liveAssistant.getWorkspaceHistory().then(setWorkspaceHistory)

    const unsubscribeTranscript = window.liveAssistant.onTranscript((update) => {
      setRawTranscript((current) => ({ ...current, [update.source]: update.interim }))
    })
    const unsubscribeConversation = window.liveAssistant.onConversationSegment((segment) => {
      setCurrentConversation((current) => [...current, segment].slice(-200))
    })
    const unsubscribeAnswer = window.liveAssistant.onAnswerDelta((update) => {
      if (update.reset) {
        shouldFollowAnswer.current = true
        activeRequestId.current = update.requestId
        setLastAnsweredConversation(pendingAnswerContext.current)
        setPendingAnswer(update.delta)
        setDisplayedAnswer(update.delta)
        if (import.meta.env.DEV) console.info(`[DISPLAY] switched to id=${update.requestId}`)
      } else {
        if (activeRequestId.current !== update.requestId) return
        setPendingAnswer((current) => current + update.delta)
        setDisplayedAnswer((current) => current + update.delta)
      }
    })
    const unsubscribeAnswerComplete = window.liveAssistant.onAnswerComplete((requestId) => {
      if (activeRequestId.current !== requestId) return
      setIsGenerating(false)
    })
    const unsubscribeStatus = window.liveAssistant.onStatus((nextStatus) => {
      setTurnState(toTurnState(nextStatus))
      if (nextStatus === 'ERROR') {
        sessionGeneration.current += 1
        setSessionState('ERROR')
        void microphoneCapture.stop()
        void systemAudioCapture.stop()
        void window.liveAssistant.stop()
      }
    })
    const unsubscribeError = window.liveAssistant.onError(setError)
    const unsubscribeScreenCaptureState = window.overlayAPI.onScreenCaptureState(
      setScreenCaptureState,
    )
    const unsubscribeScreenCaptureError = window.overlayAPI.onScreenCaptureError(setError)
    const unsubscribeWorkspaceMessage = window.liveAssistant.onWorkspaceMessage((message) => {
      setWorkspaceHistory((current) => {
        if (current.some((item) => item.id === message.id)) return current
        return [...current, message].slice(-12)
      })
    })

    return () => {
      unsubscribeTranscript()
      unsubscribeConversation()
      unsubscribeAnswer()
      unsubscribeAnswerComplete()
      unsubscribeStatus()
      unsubscribeError()
      unsubscribeScreenCaptureState()
      unsubscribeScreenCaptureError()
      unsubscribeWorkspaceMessage()
      void microphoneCapture.stop()
      void systemAudioCapture.stop()
      void window.liveAssistant.stop()
    }
  }, [])

  useEffect(() => {
    if (!shouldFollowAnswer.current) return
    const frame = requestAnimationFrame(() => {
      const container = answerScrollRef.current
      if (container) container.scrollTop = container.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [displayedAnswer])

  const startAssistant = async () => {
    const generation = ++sessionGeneration.current
    setError('')
    setRawTranscript({})
    setCurrentConversation([])
    setTurnState('LISTENING')
    setSessionState('STARTING')

    try {
      if (audioMode === 'microphone' || audioMode === 'both') {
        await microphoneCapture.start((audio) =>
          window.liveAssistant.sendAudio('microphone', audio),
        )
        if (import.meta.env.DEV) console.info('[AUDIO] microphone started')
      }
      if (audioMode === 'system' || audioMode === 'both') {
        await systemAudioCapture.start((audio) =>
          window.liveAssistant.sendAudio('system', audio),
        )
      }
      await window.liveAssistant.start(audioMode)
      if (sessionGeneration.current !== generation) return
      setSessionState('RUNNING')
      if (import.meta.env.DEV) {
        console.info('[SESSION] started')
        console.info('[CAPTURE] active')
      }
    } catch (caughtError) {
      await microphoneCapture.stop()
      await systemAudioCapture.stop()
      if (sessionGeneration.current !== generation) return
      setSessionState('ERROR')
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'The live assistant could not be started.',
      )
    }
  }

  const stopAssistant = async () => {
    sessionGeneration.current += 1
    setSessionState('STOPPING')
    setRawTranscript({})
    setCurrentConversation([])
    pendingAnswerContext.current = []
    activeRequestId.current = null
    setIsGenerating(false)
    setError('')
    await microphoneCapture.stop()
    await systemAudioCapture.stop()
    await window.liveAssistant.stop()
    setTurnState('LISTENING')
    setSessionState('IDLE')
    if (import.meta.env.DEV) console.info('[SESSION] stopped')
  }

  const togglePrivacyMode = async () => {
    try {
      const result = await window.overlayAPI.setPrivacyMode(!privacyMode)
      setPrivacyMode(result.enabled)
      setError(result.success ? '' : (result.error ?? 'Privacy Mode could not be changed.'))
    } catch {
      setError('Privacy Mode could not be changed.')
    }
  }

  const clearAnswer = () => {
    activeRequestId.current = null
    setLastAnsweredConversation([])
    setPendingAnswer('')
    setDisplayedAnswer('')
  }

  const resetContext = async () => {
    try {
      await window.liveAssistant.resetContext()
      setError('')
    } catch {
      setError('Session context could not be reset.')
    }
  }

  const generateAnswer = async () => {
    const instruction = workspaceInput.trim()
    const hasConversation = currentConversation.some((segment) => segment.text.trim())
    const hasCapture = screenCaptureState === 'READY'
    if (
      isGenerating ||
      (screenCaptureState !== 'IDLE' && !hasCapture) ||
      (!instruction && !hasConversation && !hasCapture)
    ) return

    const answerContext = [...currentConversation]
    pendingAnswerContext.current = answerContext
    setCurrentConversation([])
    setIsGenerating(true)
    setError('')

    try {
      const result = await window.liveAssistant.generateAnswer({
        conversation: answerContext,
        instruction,
      })
      if (!result.success || !result.requestId) {
        setCurrentConversation((current) => [...answerContext, ...current].slice(-200))
        pendingAnswerContext.current = []
        setIsGenerating(false)
        setError(result.error ?? 'The answer could not be generated.')
        return
      }
      setWorkspaceInput('')
      activeRequestId.current = result.requestId
    } catch {
      setCurrentConversation((current) => [...answerContext, ...current].slice(-200))
      pendingAnswerContext.current = []
      setIsGenerating(false)
      setError('The answer could not be generated.')
    }
  }

  const captureQuestion = async () => {
    if (isGenerating || (screenCaptureState !== 'IDLE' && screenCaptureState !== 'READY')) return
    setError('')
    try {
      await window.overlayAPI.startRegionCapture()
    } catch {
      setError('Region selection could not be started.')
    }
  }

  const removePendingCapture = async () => {
    if (screenCaptureState !== 'READY' || isGenerating) return
    setError('')
    try {
      await window.overlayAPI.removePendingCapture()
    } catch {
      setError('The pending screenshot could not be removed.')
    }
  }

  const handleWorkspaceKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void generateAnswer()
  }

  const displayedTurnState: TurnState = isGenerating ? 'AI RESPONDING' : turnState
  const displayedStatus =
    screenCaptureState === 'SELECTING' ? 'SELECT REGION' :
      screenCaptureState === 'CAPTURING' ? 'CAPTURING' :
        screenCaptureState === 'ANALYZING' ? 'ANALYZING IMAGE' :
          screenCaptureState === 'RESPONDING' ? 'AI RESPONDING' : displayedTurnState
  const hasConversation = currentConversation.some((segment) => segment.text.trim())
  const canGenerate =
    screenCaptureState === 'READY' || Boolean(workspaceInput.trim()) || hasConversation
  const handleAnswerScroll = () => {
    const container = answerScrollRef.current
    if (!container) return
    shouldFollowAnswer.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 48
  }

  return (
    <main className="overlay-shell">
      <header className="overlay-header">
        <div className="status-row">
          <span className={`status-dot ${isRunning ? 'is-live' : ''}`} />
          <span>{isRunning ? 'Live' : 'Overlay ready'}</span>
        </div>
        <div className="opacity-controls">
          <button className={`privacy-toggle ${privacyMode ? 'is-enabled' : ''}`} type="button" onClick={togglePrivacyMode} aria-pressed={privacyMode} title="Toggle Windows content protection">
            Privacy {privacyMode ? 'On' : 'Off'}
          </button>
          <span className="opacity-value">{Math.round(opacity * 100)}%</span>
          <button type="button" onClick={async () => setOpacity(await window.overlayAPI.decreaseOpacity())} disabled={opacity <= 0.3} aria-label="Decrease opacity">−</button>
          <button type="button" onClick={async () => setOpacity(await window.overlayAPI.increaseOpacity())} disabled={opacity >= 1} aria-label="Increase opacity">+</button>
        </div>
      </header>

      <div className="assistant-title-row">
        <h1>Floating Assistant</h1>
        <div className="assistant-status-stack">
          <span className={`live-status status-${displayedStatus.toLowerCase().replaceAll(' ', '-')}`}>
            {sessionState === 'STARTING' ? 'STARTING' : sessionState === 'STOPPING' ? 'STOPPING' : displayedStatus} • {sourceLabels[audioMode]}
          </span>
          <span className="memory-status">Session Memory • On</span>
        </div>
      </div>

      <div className="audio-source-row">
        <span className="audio-source-label">Audio</span>
        <div className="audio-source-options" role="group" aria-label="Audio source">
          {(['microphone', 'system', 'both'] as const).map((mode) => (
            <button key={mode} type="button" className={audioMode === mode ? 'is-selected' : ''} onClick={() => setAudioMode(mode)} disabled={isRunning} aria-pressed={audioMode === mode}>
              {sourceLabels[mode]}
            </button>
          ))}
        </div>
      </div>

      <button className={`listen-button ${isRunning ? 'is-active' : ''}`} type="button" onClick={isRunning ? stopAssistant : startAssistant} disabled={sessionState === 'STOPPING'}>
        {isRunning ? 'Stop Live Assistant' : 'Start Live Assistant'}
      </button>

      <section className="transcript-panel" aria-live="polite">
        <span className="transcript-label">Live Transcript</span>
        {currentConversation.length === 0 && !Object.values(rawTranscript).some(Boolean) && (
          <p className="transcript-text transcript-placeholder">Waiting for speech…</p>
        )}
        {currentConversation.map((segment) => (
          <div className="transcript-group" key={segment.id}>
            <span className="transcript-kind">{segment.source === 'microphone' ? 'You' : 'System'}</span>
            <p className="transcript-text">{segment.text}</p>
          </div>
        ))}
        {(Object.entries(rawTranscript) as [AudioSource, string][]).map(
          ([source, text]) =>
            text && (
              <div className="transcript-group" key={`interim-${source}`}>
                <span className="transcript-kind">{source === 'microphone' ? 'You · Interim' : 'System · Interim'}</span>
                <p className="transcript-text interim-transcript">{text}</p>
              </div>
            ),
        )}
      </section>

      {screenCaptureState === 'READY' && (
        <div className="screen-capture-ready" role="status">
          <span>Screen capture <strong>• Ready</strong></span>
          <button type="button" onClick={removePendingCapture}>Remove</button>
        </div>
      )}

      <div className="workspace-composer">
        <textarea
          value={workspaceInput}
          onChange={(event) => setWorkspaceInput(event.target.value)}
          onKeyDown={handleWorkspaceKeyDown}
          placeholder="Add an instruction or ask about the capture…"
          rows={2}
        />
      </div>

      <div className="assistant-action-row">
        <button
          className="generate-button"
          type="button"
          onClick={generateAnswer}
          disabled={!canGenerate || isGenerating || (screenCaptureState !== 'IDLE' && screenCaptureState !== 'READY')}
        >
          {isGenerating ? 'Generating Answer…' : 'Generate Answer'}
        </button>
        <button
          className="capture-button"
          type="button"
          onClick={captureQuestion}
          disabled={isGenerating || (screenCaptureState !== 'IDLE' && screenCaptureState !== 'READY')}
        >
          {screenCaptureState === 'READY' ? 'Retake' : screenCaptureState === 'IDLE' ? 'Capture Question' : displayedStatus}
        </button>
      </div>

      <section className="workspace-history">
        <button type="button" className="history-toggle" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}>
          Chat History {historyOpen ? '▴' : '▾'}
        </button>
        {historyOpen && (
          <div className="history-list">
            {workspaceHistory.length === 0 && <p>No workspace messages yet.</p>}
            {workspaceHistory.map((message) => (
              <div className="history-item" key={message.id}>
                <span>{message.type === 'assistant' ? 'AI' : 'You'}</span>
                <p>{message.type === 'screen-capture' ? 'Captured a screenshot' : message.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="answer-panel" aria-live="polite" data-context-segments={lastAnsweredConversation.length}>
        <div className="answer-heading">
          <span className="transcript-label">AI Response</span>
          <div className="answer-actions">
            <button type="button" onClick={resetContext}>Reset Context</button>
            <button type="button" onClick={clearAnswer} disabled={!displayedAnswer}>Clear</button>
          </div>
        </div>
        <div className="answer-text" ref={answerScrollRef} onScroll={handleAnswerScroll}>
          {displayedAnswer
            ? <MarkdownAnswer content={displayedAnswer} />
            : <p className="answer-placeholder">The streamed answer will appear here…</p>}
        </div>
      </section>

      {error && <p className="speech-error">{error}</p>}
    </main>
  )
}

function toTurnState(status: LiveAssistantStatus): TurnState {
  switch (status) {
    case 'USER SPEAKING':
      return 'CAPTURING'
    case 'PROCESSING':
      return 'TRANSCRIBING'
    case 'FILTERING':
      return 'VALIDATING'
    case 'AI RESPONDING':
      return 'AI RESPONDING'
    default:
      return 'LISTENING'
  }
}
