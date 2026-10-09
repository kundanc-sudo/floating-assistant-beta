import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { AudioCaptureService } from './services/audioCaptureService'
import { SystemAudioCaptureService } from './services/systemAudioCaptureService'
import { AnswerDisplay } from './components/AnswerDisplay'
import { answerDisplayReducer, initialAnswerDisplayState } from './services/answerDisplayState'
import { ProductShell } from './product/ProductShell'

interface ActiveInterview {
  id: string
  name: string
  company?: string
  role?: string
}

const microphoneCapture = new AudioCaptureService()
const systemAudioCapture = new SystemAudioCaptureService()
type SessionState = 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR'
type TurnState =
  | 'LISTENING'
  | 'CAPTURING'
  | 'TRANSCRIBING'
  | 'VALIDATING'
  | 'AI RESPONDING'
type PreviewItem =
  | { kind: 'image'; title: string; imageDataUrl: string }
  | { kind: 'file'; attachment: PendingAttachment }

const sourceLabels: Record<AudioMode, string> = {
  microphone: 'MIC',
  system: 'SYSTEM',
  both: 'MIC + SYSTEM',
}
const resizeCorners: ResizeCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

function AssistantApp({ activeInterview, onEndInterview }: {
  activeInterview: ActiveInterview
  onEndInterview: () => Promise<void>
}) {
  const [opacity, setOpacity] = useState(0.7)
  const [privacyMode, setPrivacyMode] = useState(true)
  const [sessionState, setSessionState] = useState<SessionState>('IDLE')
  const [turnState, setTurnState] = useState<TurnState>('LISTENING')
  const [audioMode, setAudioMode] = useState<AudioMode>('microphone')
  const [autoAssistEnabled, setAutoAssistEnabled] = useState(false)
  const [autoAssistStatus, setAutoAssistStatus] = useState<AutoAssistStatus>('OFF')
  const [pendingAutoTrigger, setPendingAutoTrigger] = useState<AutoAssistTrigger | null>(null)
  const [rawTranscript, setRawTranscript] = useState<Partial<Record<AudioSource, string>>>({})
  const [currentConversation, setCurrentConversation] = useState<ConversationSegment[]>([])
  const [lastAnsweredConversation, setLastAnsweredConversation] = useState<ConversationSegment[]>([])
  const [answerDisplay, dispatchAnswerDisplay] = useReducer(
    answerDisplayReducer,
    initialAnswerDisplayState,
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [screenCaptureState, setScreenCaptureState] = useState<ScreenCaptureState>('IDLE')
  const [error, setError] = useState('')
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [pendingScreenshots, setPendingScreenshots] = useState<PendingScreenshot[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [previewItem, setPreviewItem] = useState<PreviewItem | null>(null)
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceMessage[]>([])
  const [conversationHistory, setConversationHistory] = useState<RecentInteraction[]>([])
  const [interviewContextStatus, setInterviewContextStatus] = useState<InterviewContextStatus>({
    resumeLoaded: false,
    resumeChars: 0,
    jobDescriptionLoaded: false,
    jobDescriptionChars: 0,
    instructionsLoaded: false,
    instructionsChars: 0,
    ready: false,
  })
  const [contextTextField, setContextTextField] = useState<InterviewContextField>('instructions')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [answerFocus, setAnswerFocus] = useState(false)
  const [retryAvailable, setRetryAvailable] = useState(false)
  const [copiedAnswer, setCopiedAnswer] = useState(false)
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false)
  const [sharingStatus, setSharingStatus] = useState<SharingStatus>({ state: 'OFF' })
  const [windowMode, setWindowMode] = useState<WindowMode>('expanded')
  const [bubbleHasUnread, setBubbleHasUnread] = useState(false)
  const activeRequestId = useRef<string | null>(null)
  const generationInFlight = useRef(false)
  const pendingAnswerContext = useRef<ConversationSegment[]>([])
  const pendingAnswerQuestion = useRef('')
  const lastGenerationInput = useRef<GenerateAnswerInput | null>(null)
  const firstVisibleTiming = useRef<AutoAssistTrigger | null>(null)
  const sessionGeneration = useRef(0)
  const windowModeRef = useRef<WindowMode>('expanded')
  const bubblePointer = useRef<{
    id: number
    startX: number
    startY: number
    dragged: boolean
  } | null>(null)
  const resizePointer = useRef<number | null>(null)
  const isRunning = sessionState === 'STARTING' || sessionState === 'RUNNING' || sessionState === 'STOPPING'

  useEffect(() => {
    void window.overlayAPI.getOpacity().then(setOpacity)
    void window.overlayAPI.getPrivacyMode().then((result) => {
      setPrivacyMode(result.enabled)
      if (!result.success) setError(result.error ?? 'Privacy Mode could not be initialized.')
    })
    void window.liveAssistant.getWorkspaceHistory().then(setWorkspaceHistory)
    void window.liveAssistant.getConversationHistory().then(setConversationHistory)
    void window.liveAssistant.getInterviewContextStatus().then(setInterviewContextStatus)
    void window.liveAssistant.getAutoAssist().then(setAutoAssistEnabled)
    void window.sharingAPI.getStatus().then(setSharingStatus)
    void window.overlayAPI.getPendingScreenshots().then(setPendingScreenshots)
    void window.overlayAPI.getPendingAttachments().then(setPendingAttachments)
    void window.overlayAPI.getWindowMode().then((mode) => {
      windowModeRef.current = mode
      setWindowMode(mode)
    })

    const unsubscribeTranscript = window.liveAssistant.onTranscript((update) => {
      setRawTranscript((current) => ({ ...current, [update.source]: update.interim }))
    })
    const unsubscribeConversation = window.liveAssistant.onConversationSegment((segment) => {
      setCurrentConversation((current) => [...current, segment].slice(-200))
    })
    const unsubscribeAnswer = window.liveAssistant.onAnswerDelta((update) => {
      if (update.reset) {
        setWaitingForFirstToken(false)
        setError('')
        setRetryAvailable(false)
        activeRequestId.current = update.requestId
        setLastAnsweredConversation(pendingAnswerContext.current)
        dispatchAnswerDisplay({
          type: 'start',
          id: update.requestId,
          question: pendingAnswerQuestion.current,
          delta: update.delta,
          createdAt: Date.now(),
        })
        requestAnimationFrame(() => {
          if (import.meta.env.DEV && firstVisibleTiming.current?.segmentId) {
            console.info(
              `[TURN_TRACE] turnId=${firstVisibleTiming.current.segmentId} event=RENDERER_VISIBLE timestamp=${Date.now()}`,
            )
          }
          if (import.meta.env.DEV && firstVisibleTiming.current?.speechStoppedAt) {
            console.info(`[PERF] end-of-speech-to-first-visible-token=${Date.now() - firstVisibleTiming.current.speechStoppedAt}ms`)
          }
        })
        if (import.meta.env.DEV) console.info(`[DISPLAY] switched to id=${update.requestId}`)
      } else {
        if (activeRequestId.current !== update.requestId) return
        dispatchAnswerDisplay({ type: 'append', id: update.requestId, delta: update.delta })
      }
    })
    const unsubscribeAnswerComplete = window.liveAssistant.onAnswerComplete((requestId) => {
      if (activeRequestId.current !== requestId) return
      generationInFlight.current = false
      setWaitingForFirstToken(false)
      setIsGenerating(false)
      dispatchAnswerDisplay({ type: 'complete', id: requestId })
      if (windowModeRef.current === 'bubble') setBubbleHasUnread(true)
    })
    const unsubscribeAnswerFailed = window.liveAssistant.onAnswerFailed((failure) => {
      if (activeRequestId.current && activeRequestId.current !== failure.requestId) return
      generationInFlight.current = false
      setWaitingForFirstToken(false)
      setIsGenerating(false)
      const retryInput = lastGenerationInput.current
      setRetryAvailable(Boolean(
        retryInput && retryInput.screenshots.length === 0 && retryInput.attachments.length === 0,
      ))
      dispatchAnswerDisplay({
        type: 'fail',
        id: failure.requestId,
        question: pendingAnswerQuestion.current,
        error: failure.message,
        createdAt: Date.now(),
      })
      setError(failure.message)
    })
    const unsubscribeStatus = window.liveAssistant.onStatus((nextStatus) => {
      setTurnState(toTurnState(nextStatus))
      if (nextStatus === 'ERROR') {
        sessionGeneration.current += 1
        generationInFlight.current = false
        setWaitingForFirstToken(false)
        setSessionState('ERROR')
        void microphoneCapture.stop()
        void systemAudioCapture.stop()
        void window.liveAssistant.stop()
      }
    })
    const unsubscribeError = window.liveAssistant.onError(setError)
    const unsubscribeAutoTrigger = window.liveAssistant.onAutoTrigger(setPendingAutoTrigger)
    const unsubscribeAutoStatus = window.liveAssistant.onAutoStatus(setAutoAssistStatus)
    const unsubscribeScreenCaptureState = window.overlayAPI.onScreenCaptureState(
      setScreenCaptureState,
    )
    const unsubscribeScreenCaptureError = window.overlayAPI.onScreenCaptureError(setError)
    const unsubscribePendingScreenshots = window.overlayAPI.onPendingScreenshots(
      setPendingScreenshots,
    )
    const unsubscribePendingAttachments = window.overlayAPI.onPendingAttachments(
      setPendingAttachments,
    )
    const unsubscribeWorkspaceMessage = window.liveAssistant.onWorkspaceMessage((message) => {
      setWorkspaceHistory((current) => {
        if (current.some((item) => item.id === message.id)) return current
        return [...current, message].slice(-12)
      })
    })
    const unsubscribeConversationInteraction = window.liveAssistant.onConversationInteraction((interaction) => {
      setConversationHistory((current) => {
        if (current.some((item) => item.requestId === interaction.requestId)) return current
        return [...current, interaction].slice(-3)
      })
    })
    const unsubscribeInterviewContextStatus = window.liveAssistant.onInterviewContextStatus(
      setInterviewContextStatus,
    )
    const unsubscribeSharingStatus = window.sharingAPI.onStatus(setSharingStatus)
    const unsubscribeWindowMode = window.overlayAPI.onWindowMode((mode) => {
      windowModeRef.current = mode
      setWindowMode(mode)
      if (mode === 'expanded') setBubbleHasUnread(false)
    })

    return () => {
      unsubscribeTranscript()
      unsubscribeConversation()
      unsubscribeAnswer()
      unsubscribeAnswerComplete()
      unsubscribeAnswerFailed()
      unsubscribeStatus()
      unsubscribeError()
      unsubscribeAutoTrigger()
      unsubscribeAutoStatus()
      unsubscribeScreenCaptureState()
      unsubscribeScreenCaptureError()
      unsubscribePendingScreenshots()
      unsubscribePendingAttachments()
      unsubscribeWorkspaceMessage()
      unsubscribeConversationInteraction()
      unsubscribeInterviewContextStatus()
      unsubscribeSharingStatus()
      unsubscribeWindowMode()
      void microphoneCapture.stop()
      void systemAudioCapture.stop()
      void window.liveAssistant.stop()
    }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('bubble-mode', windowMode === 'bubble')
    return () => document.body.classList.remove('bubble-mode')
  }, [windowMode])

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (previewItem) {
        setPreviewItem(null)
      } else if (answerFocus) {
        setAnswerFocus(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [previewItem, answerFocus])

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
    generationInFlight.current = false
    setIsGenerating(false)
    setWaitingForFirstToken(false)
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
    dispatchAnswerDisplay({ type: 'clear-view' })
  }

  const resetContext = async () => {
    try {
      await window.liveAssistant.resetContext()
      setConversationHistory([])
      setError('')
    } catch {
      setError('Session context could not be reset.')
    }
  }

  const toggleAutoAssist = async () => {
    try {
      const enabled = await window.liveAssistant.setAutoAssist(!autoAssistEnabled)
      setAutoAssistEnabled(enabled)
      if (!enabled) setPendingAutoTrigger(null)
      setError('')
    } catch {
      setError('Auto Assist could not be changed.')
    }
  }

  const toggleSharing = async () => {
    setError('')
    try {
      const status = sharingStatus.state === 'ON' || sharingStatus.state === 'UNAVAILABLE' && sharingStatus.sessionId
        ? await window.sharingAPI.stop()
        : await window.sharingAPI.start()
      setSharingStatus(status)
      if (status.state === 'UNAVAILABLE') {
        setError(status.error ?? 'Sharing is unavailable.')
      }
    } catch {
      setError('Sharing is unavailable. The assistant will continue working normally.')
    }
  }

  const copySharingValue = async (value: string | undefined) => {
    if (!value) return
    try {
      await window.sharingAPI.copyText(value)
    } catch {
      setError('The sharing value could not be copied.')
    }
  }

  const generateAnswer = async (
    origin: GenerationOrigin = 'manual',
    autoTriggerId?: string,
    autoTiming?: AutoAssistTrigger,
  ) => {
    const instruction = workspaceInput.trim()
    const hasConversation = currentConversation.some((segment) => segment.text.trim())
    const screenshotSnapshot = pendingScreenshots.map((screenshot) => ({ ...screenshot }))
    const attachmentSnapshot = pendingAttachments.map((attachment) => ({ ...attachment }))
    const hasCapture = screenshotSnapshot.length > 0
    if (
      generationInFlight.current ||
      (screenCaptureState !== 'IDLE' && !hasCapture) ||
      (!instruction && !hasConversation && !hasCapture && attachmentSnapshot.length === 0)
    ) {
      if (origin === 'auto' && autoTriggerId) {
        await window.liveAssistant.rejectAutoTrigger(autoTriggerId)
      }
      return
    }

    generationInFlight.current = true
    if (import.meta.env.DEV) console.info('[PERF] generateAnswer entered')
    firstVisibleTiming.current = autoTiming ?? null
    const answerContext = [...currentConversation]
    pendingAnswerContext.current = answerContext
    pendingAnswerQuestion.current = instruction ||
      answerContext.map((segment) => segment.text).join(' ') ||
      (screenshotSnapshot.length ? 'Captured question' : 'Attached interview question')
    setCurrentConversation([])
    setIsGenerating(true)
    setWaitingForFirstToken(true)
    setError('')

    try {
      const input: GenerateAnswerInput = {
        conversation: answerContext,
        instruction,
        screenshots: screenshotSnapshot,
        attachments: attachmentSnapshot,
        origin,
        autoTriggerId,
        autoTiming,
        rendererGenerateAt: Date.now(),
      }
      lastGenerationInput.current = input
      const result = await window.liveAssistant.generateAnswer(input)
      if (!result.success || !result.requestId) {
        setCurrentConversation((current) => [...answerContext, ...current].slice(-200))
        pendingAnswerContext.current = []
        setIsGenerating(false)
        setWaitingForFirstToken(false)
        generationInFlight.current = false
        setError(result.error ?? 'The answer could not be generated.')
        return
      }
      setWorkspaceInput('')
      setPendingScreenshots([])
      setPendingAttachments([])
      setPreviewItem(null)
      activeRequestId.current = result.requestId
    } catch {
      setCurrentConversation((current) => [...answerContext, ...current].slice(-200))
      pendingAnswerContext.current = []
      setIsGenerating(false)
      setWaitingForFirstToken(false)
      generationInFlight.current = false
      setError('The answer could not be generated.')
    }
  }

  useEffect(() => {
    if (!pendingAutoTrigger) return
    const trigger = pendingAutoTrigger
    setPendingAutoTrigger(null)
    if (!autoAssistEnabled) {
      void window.liveAssistant.rejectAutoTrigger(trigger.id)
      return
    }
    void generateAnswer('auto', trigger.id, trigger)
  }, [pendingAutoTrigger, autoAssistEnabled])

  const retryLastAnswer = async () => {
    const input = lastGenerationInput.current
    if (!input || generationInFlight.current) return
    generationInFlight.current = true
    setIsGenerating(true)
    setWaitingForFirstToken(true)
    setRetryAvailable(false)
    setError('')
    pendingAnswerContext.current = [...input.conversation]
    pendingAnswerQuestion.current = input.instruction ||
      input.conversation.map((segment) => segment.text).join(' ') ||
      (input.screenshots.length ? 'Captured question' : 'Attached interview question')
    try {
      const result = await window.liveAssistant.generateAnswer({
        ...input,
        origin: 'retry',
        autoTriggerId: undefined,
        autoTiming: undefined,
        rendererGenerateAt: Date.now(),
      })
      if (!result.success || !result.requestId) {
        generationInFlight.current = false
        setIsGenerating(false)
        setWaitingForFirstToken(false)
        setRetryAvailable(true)
        setError(result.error ?? 'The answer could not be retried.')
        return
      }
      activeRequestId.current = result.requestId
    } catch {
      generationInFlight.current = false
      setIsGenerating(false)
      setWaitingForFirstToken(false)
      setRetryAvailable(true)
      setError('The answer could not be retried.')
    }
  }

  const selectAttachment = async () => {
    if (isGenerating) return
    setError('')
    try {
      const result = await window.overlayAPI.selectAttachment()
      if (result.canceled) return
      if (!result.success) {
        setError(result.error ?? 'The file could not be attached.')
        return
      }
      if (result.error) setError(result.error)
    } catch {
      setError('The file could not be attached.')
    }
  }

  const saveInterviewContextText = async () => {
    const value = workspaceInput.trim()
    if (!value || isGenerating) return
    setError('')
    try {
      const result = await window.liveAssistant.setInterviewContextText(contextTextField, value)
      if (!result.success || !result.status) {
        setError(result.error ?? 'Interview context could not be saved.')
        return
      }
      setInterviewContextStatus(result.status)
      setWorkspaceInput('')
    } catch {
      setError('Interview context could not be saved.')
    }
  }

  const useAttachmentAsInterviewContext = async (
    id: string,
    field: 'resume' | 'jobDescription',
  ) => {
    if (isGenerating) return
    setError('')
    try {
      const result = await window.liveAssistant.useAttachmentAsInterviewContext(id, field)
      if (!result.success || !result.status) {
        setError(result.error ?? 'The file could not be saved as interview context.')
        return
      }
      setInterviewContextStatus(result.status)
    } catch {
      setError('The file could not be saved as interview context.')
    }
  }

  const removePendingAttachment = async (id: string) => {
    if (isGenerating) return
    setError('')
    try {
      const removed = await window.overlayAPI.removeAttachment(id)
      if (!removed) {
        setError('The pending attachment could not be removed.')
        return
      }
      setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id))
    } catch {
      setError('The pending attachment could not be removed.')
    }
  }

  const captureQuestion = async () => {
    if (screenCaptureState !== 'IDLE' && screenCaptureState !== 'READY') return
    setError('')
    try {
      await window.overlayAPI.startRegionCapture()
    } catch {
      setError('Region selection could not be started.')
    }
  }

  const removePendingCapture = async (id: string) => {
    if (isGenerating) return
    setError('')
    try {
      const removed = await window.overlayAPI.removePendingCapture(id)
      if (!removed) throw new Error('Screenshot not found.')
      setPendingScreenshots((current) => current.filter((screenshot) => screenshot.id !== id))
    } catch {
      setError('The pending screenshot could not be removed.')
    }
  }

  const clearPendingItems = async () => {
    if (isGenerating) return
    setError('')
    try {
      await Promise.all([
        window.overlayAPI.clearPendingCaptures(),
        window.overlayAPI.clearAttachments(),
      ])
      setPendingScreenshots([])
      setPendingAttachments([])
      setPreviewItem(null)
    } catch {
      setError('The pending attachments could not be cleared.')
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
    pendingScreenshots.length > 0 || Boolean(workspaceInput.trim()) ||
    pendingAttachments.length > 0 || hasConversation
  const pendingItemCount = pendingScreenshots.length + pendingAttachments.length
  const toggleAnswerHistory = useCallback(() => {
    setHistoryOpen((open) => !open)
  }, [])
  const copyAnswer = async (answer: string) => {
    if (!answer) return
    try {
      const copied = await window.overlayAPI.copyAnswer(answer)
      if (!copied) throw new Error('Copy failed')
      setCopiedAnswer(true)
      window.setTimeout(() => setCopiedAnswer(false), 1200)
    } catch {
      setError('The answer could not be copied.')
    }
  }

  const collapseToBubble = async () => {
    try {
      const mode = await window.overlayAPI.collapseToBubble()
      windowModeRef.current = mode
      setWindowMode(mode)
    } catch {
      setError('The assistant could not be collapsed.')
    }
  }

  const expandFromBubble = async () => {
    try {
      const mode = await window.overlayAPI.expandFromBubble()
      windowModeRef.current = mode
      setWindowMode(mode)
      setBubbleHasUnread(false)
    } catch {
      setError('The assistant could not be expanded.')
    }
  }

  const handleBubblePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    bubblePointer.current = {
      id: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      dragged: false,
    }
    window.overlayAPI.beginBubbleDrag(event.screenX, event.screenY)
  }

  const handleBubblePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = bubblePointer.current
    if (!pointer || pointer.id !== event.pointerId) return
    if (!pointer.dragged && Math.hypot(
      event.screenX - pointer.startX,
      event.screenY - pointer.startY,
    ) >= 5) pointer.dragged = true
    if (pointer.dragged) window.overlayAPI.moveBubble(event.screenX, event.screenY)
  }

  const finishBubblePointer = (event: ReactPointerEvent<HTMLDivElement>, expand: boolean) => {
    const pointer = bubblePointer.current
    if (!pointer || pointer.id !== event.pointerId) return
    const wasDragged = pointer.dragged
    bubblePointer.current = null
    window.overlayAPI.endBubbleDrag()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (expand && !wasDragged) void expandFromBubble()
  }

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    corner: ResizeCorner,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizePointer.current = event.pointerId
    window.overlayAPI.beginResize(corner, event.screenX, event.screenY)
  }

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointer.current !== event.pointerId) return
    window.overlayAPI.resize(event.screenX, event.screenY)
  }

  const finishResizePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointer.current !== event.pointerId) return
    resizePointer.current = null
    window.overlayAPI.endResize()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  if (windowMode === 'bubble') {
    const bubbleState = isGenerating
      ? 'responding'
      : isRunning
        ? 'listening'
        : 'idle'
    return (
      <main className="bubble-shell">
        <div
          className={`assistant-bubble is-${bubbleState}`}
          role="button"
          tabIndex={0}
          aria-label="Open Floating Assistant"
          title="Open Floating Assistant"
          onPointerDown={handleBubblePointerDown}
          onPointerMove={handleBubblePointerMove}
          onPointerUp={(event) => finishBubblePointer(event, true)}
          onPointerCancel={(event) => finishBubblePointer(event, false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') void expandFromBubble()
          }}
        >
          <span className="bubble-label">AI</span>
          {bubbleHasUnread && <span className="bubble-unread" aria-label="New response available" />}
        </div>
      </main>
    )
  }

  return (
    <main className={`overlay-shell ${answerFocus ? 'answer-focus' : ''}`}>
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
          <button className="collapse-button" type="button" onClick={() => void collapseToBubble()} aria-label="Collapse to bubble" title="Collapse to bubble">●</button>
          <button className="close-button" type="button" onClick={() => window.overlayAPI.quitApp()} aria-label="Quit application" title="Quit application">×</button>
        </div>
      </header>

      <div className="assistant-title-row">
        <div className="assistant-title-copy">
          <h1>Floating Assistant</h1>
          <span className="active-interview-label">
            {[activeInterview.name, activeInterview.company, activeInterview.role].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="assistant-status-stack">
          <span className={`live-status status-${displayedStatus.toLowerCase().replaceAll(' ', '-')}`}>
            {sessionState === 'STARTING' ? 'STARTING' : sessionState === 'STOPPING' ? 'STOPPING' : displayedStatus} • {sourceLabels[audioMode]}
          </span>
          <span className="memory-status">Session Memory • On</span>
          <span className={`context-status ${interviewContextStatus.ready ? 'is-ready' : ''}`}>
            Resume {interviewContextStatus.resumeLoaded ? '✓' : '—'} · JD {interviewContextStatus.jobDescriptionLoaded ? '✓' : '—'} · Prompt {interviewContextStatus.instructionsLoaded ? '✓' : '—'}
          </span>
          {autoAssistEnabled && (
            <span className="auto-status">Auto • {autoAssistStatus.replaceAll('_', ' ')}</span>
          )}
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

      <div className="live-control-row">
        <button className={`listen-button ${isRunning ? 'is-active' : ''}`} type="button" onClick={isRunning ? stopAssistant : startAssistant} disabled={sessionState === 'STOPPING'}>
          {isRunning ? 'Stop Live Assistant' : 'Start Live Assistant'}
        </button>
        <button className={`auto-assist-toggle ${autoAssistEnabled ? 'is-enabled' : ''}`} type="button" onClick={toggleAutoAssist} aria-pressed={autoAssistEnabled} title={`Auto Assist: ${autoAssistStatus.replaceAll('_', ' ')}`}>
          Auto {autoAssistEnabled ? 'On' : 'Off'}
        </button>
      </div>

      <AnswerDisplay
        state={answerDisplay}
        history={conversationHistory}
        historyOpen={historyOpen}
        waitingForFirstToken={waitingForFirstToken}
        retryAvailable={retryAvailable}
        answerFocus={answerFocus}
        copied={copiedAnswer}
        dispatch={dispatchAnswerDisplay}
        onToggleHistory={toggleAnswerHistory}
        onRetry={() => void retryLastAnswer()}
        onCopy={(answer) => void copyAnswer(answer)}
        onToggleFocus={() => setAnswerFocus((focused) => !focused)}
        onClearView={clearAnswer}
      />

      {!answerFocus && <>

      {moreOpen && <section className={`sharing-panel sharing-${sharingStatus.state.toLowerCase()}`}>
        <div className="sharing-heading">
          <span>Sharing: <strong>{sharingStatus.state === 'ON' ? 'ON' : sharingStatus.state === 'STARTING' ? 'STARTING' : sharingStatus.state === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'OFF'}</strong></span>
          <button type="button" onClick={toggleSharing} disabled={sharingStatus.state === 'STARTING'}>
            {sharingStatus.state === 'ON' || sharingStatus.sessionId ? 'Stop Sharing' : 'Start Sharing'}
          </button>
        </div>
        {sharingStatus.state === 'ON' && (
          <div className="sharing-details">
            <span className="sharing-value" title={sharingStatus.viewerToken}>Token: {sharingStatus.viewerToken}</span>
            <div className="sharing-actions">
              <button type="button" onClick={() => void copySharingValue(sharingStatus.viewerToken)}>Copy Token</button>
              <button type="button" onClick={() => void copySharingValue(sharingStatus.viewerUrl)}>Copy Link</button>
            </div>
            <span className="sharing-expiry">Expires {sharingStatus.expiresAt ? new Date(sharingStatus.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          </div>
        )}
      </section>}

      <section className={`transcript-panel ${transcriptOpen ? 'is-open' : 'is-collapsed'}`} aria-live="polite">
        <button className="transcript-toggle" type="button" onClick={() => setTranscriptOpen((open) => !open)} aria-expanded={transcriptOpen}>
          Transcript {transcriptOpen ? '▴' : '▾'}
        </button>
        {currentConversation.length === 0 && !Object.values(rawTranscript).some(Boolean) && (
          <p className="transcript-text transcript-placeholder">Waiting for speech…</p>
        )}
        {(transcriptOpen ? currentConversation : currentConversation.slice(-1)).map((segment) => (
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

      <div className="workspace-composer">
        {pendingItemCount > 0 && (
          <div className="pending-strip" aria-label="Pending screenshots and attachments">
            {pendingScreenshots.map((screenshot, index) => (
              <div
                className="pending-card pending-image-card"
                key={screenshot.id}
                title={`Preview Screenshot ${index + 1}`}
                role="button"
                tabIndex={0}
                onClick={() => setPreviewItem({
                  kind: 'image',
                  title: `Screenshot ${index + 1}`,
                  imageDataUrl: screenshot.imageDataUrl,
                })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setPreviewItem({ kind: 'image', title: `Screenshot ${index + 1}`, imageDataUrl: screenshot.imageDataUrl })
                  }
                }}
              >
                <img src={screenshot.imageDataUrl} alt={`Screenshot ${index + 1}`} />
                <span>IMG {index + 1}</span>
                <button
                  className="pending-remove"
                  type="button"
                  aria-label={`Remove Screenshot ${index + 1}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void removePendingCapture(screenshot.id)
                  }}
                >×</button>
              </div>
            ))}
            {pendingAttachments.map((attachment) => (
              <div
                className={`pending-card ${attachment.kind === 'image' ? 'pending-image-card' : 'pending-file-card'}`}
                key={attachment.id}
                title={attachment.name}
                role="button"
                tabIndex={0}
                onClick={() => attachment.kind === 'image' && attachment.imageDataUrl
                  ? setPreviewItem({ kind: 'image', title: attachment.name, imageDataUrl: attachment.imageDataUrl })
                  : setPreviewItem({ kind: 'file', attachment })}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setPreviewItem(attachment.kind === 'image' && attachment.imageDataUrl
                    ? { kind: 'image', title: attachment.name, imageDataUrl: attachment.imageDataUrl }
                    : { kind: 'file', attachment })
                }}
              >
                {attachment.kind === 'image' && attachment.imageDataUrl
                  ? <img src={attachment.imageDataUrl} alt={attachment.name} />
                  : <span className="file-badge">{attachment.extension.slice(1).toUpperCase()}</span>}
                <span className="pending-filename">{attachment.name}</span>
                {attachment.kind !== 'image' && (
                  <span className="pending-context-actions">
                    <button
                      type="button"
                      title="Use as persistent resume"
                      onClick={(event) => {
                        event.stopPropagation()
                        void useAttachmentAsInterviewContext(attachment.id, 'resume')
                      }}
                    >Resume</button>
                    <button
                      type="button"
                      title="Use as persistent job description"
                      onClick={(event) => {
                        event.stopPropagation()
                        void useAttachmentAsInterviewContext(attachment.id, 'jobDescription')
                      }}
                    >JD</button>
                  </span>
                )}
                <button
                  className="pending-remove"
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void removePendingAttachment(attachment.id)
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={workspaceInput}
          onChange={(event) => setWorkspaceInput(event.target.value)}
          onKeyDown={handleWorkspaceKeyDown}
          placeholder="Add an instruction or ask about the capture…"
          rows={2}
        />
        <div className="context-save-row">
          <select
            value={contextTextField}
            onChange={(event) => setContextTextField(event.target.value as InterviewContextField)}
            aria-label="Interview context type"
            disabled={isGenerating}
          >
            <option value="instructions">Session Instructions</option>
            <option value="resume">Resume Text</option>
            <option value="jobDescription">Job Description</option>
          </select>
          <button
            type="button"
            onClick={() => void saveInterviewContextText()}
            disabled={!workspaceInput.trim() || isGenerating}
          >
            Save Context
          </button>
        </div>
        {pendingItemCount > 1 && (
          <button className="clear-pending" type="button" onClick={clearPendingItems} disabled={isGenerating}>
            Clear attachments
          </button>
        )}
      </div>

      <div className="assistant-action-row">
        <button
          className="attach-button"
          type="button"
          onClick={selectAttachment}
          disabled={isGenerating}
        >
          + File
        </button>
        <button
          className="generate-button"
          type="button"
          onClick={() => void generateAnswer('manual')}
          disabled={!canGenerate || isGenerating || (screenCaptureState !== 'IDLE' && screenCaptureState !== 'READY')}
        >
          Generate
        </button>
        <button
          className="capture-button"
          type="button"
          onClick={captureQuestion}
          disabled={screenCaptureState !== 'IDLE' && screenCaptureState !== 'READY'}
        >
          {screenCaptureState === 'IDLE' || screenCaptureState === 'READY' ? 'Capture Question' : displayedStatus}
        </button>
      </div>

      <div className="more-controls">
        <button type="button" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen}>More {moreOpen ? '▴' : '▾'}</button>
        {moreOpen && <button type="button" onClick={resetContext}>Reset Context</button>}
        {moreOpen && (
          <button
            className="end-interview-button"
            type="button"
            onClick={() => {
              if (window.confirm('End this interview and return to the dashboard?')) {
                void onEndInterview()
              }
            }}
          >
            End Interview
          </button>
        )}
      </div>

      {previewItem && (
        <div className="preview-backdrop" role="presentation" onClick={() => setPreviewItem(null)}>
          <section className="preview-dialog" role="dialog" aria-modal="true" aria-label={previewItem.kind === 'image' ? previewItem.title : previewItem.attachment.name} onClick={(event) => event.stopPropagation()}>
            <button className="preview-close" type="button" onClick={() => setPreviewItem(null)} aria-label="Close preview">×</button>
            {previewItem.kind === 'image' ? (
              <>
                <span className="preview-title">{previewItem.title}</span>
                <img src={previewItem.imageDataUrl} alt={previewItem.title} />
              </>
            ) : (
              <div className="file-preview-info">
                <span className="file-badge">{previewItem.attachment.extension.slice(1).toUpperCase()}</span>
                <strong>{previewItem.attachment.name}</strong>
                <span>{previewItem.attachment.kind.toUpperCase()}</span>
                <span>{previewItem.attachment.mimeType}</span>
                <span>{formatFileSize(previewItem.attachment.size)}</span>
              </div>
            )}
          </section>
        </div>
      )}

      </>}

      {error && <p className="speech-error">{error}</p>}
      {!previewItem && resizeCorners.map((corner) => (
        <div
          key={corner}
          className={`resize-handle resize-handle-${corner}`}
          aria-hidden="true"
          onPointerDown={(event) => handleResizePointerDown(event, corner)}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResizePointer}
          onPointerCancel={finishResizePointer}
        />
      ))}
    </main>
  )
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<ProductBootstrap | null>(null)
  const [activeInterview, setActiveInterview] = useState<ActiveInterview | null>(null)
  const [startupError, setStartupError] = useState('')

  useEffect(() => {
    let mounted = true
    void window.productAPI.getBootstrap()
      .then((value) => {
        if (mounted) setBootstrap(value)
      })
      .catch((caught) => {
        if (mounted) {
          setStartupError(caught instanceof Error ? caught.message : 'The application could not be initialized.')
        }
      })
    return () => { mounted = false }
  }, [])

  if (startupError) {
    return <main className="product-loading"><strong>Floating Assistant could not start.</strong><span>{startupError}</span></main>
  }
  if (!bootstrap) return <main className="product-loading">Loading Floating Assistant…</main>

  if (activeInterview) {
    return (
      <AssistantApp
        activeInterview={activeInterview}
        onEndInterview={async () => {
          await microphoneCapture.stop()
          await systemAudioCapture.stop()
          const next = await window.productAPI.endInterview()
          setActiveInterview(null)
          setBootstrap(next)
        }}
      />
    )
  }

  return (
    <ProductShell
      bootstrap={bootstrap}
      onBootstrap={setBootstrap}
      onStartAssistant={(interview, next) => {
        setBootstrap(next)
        setActiveInterview(interview)
      }}
    />
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
