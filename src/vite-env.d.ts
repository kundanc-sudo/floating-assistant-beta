/// <reference types="vite/client" />

type LiveAssistantStatus =
  | 'IDLE'
  | 'CONNECTING'
  | 'LISTENING'
  | 'USER SPEAKING'
  | 'PROCESSING'
  | 'FILTERING'
  | 'AI RESPONDING'
  | 'ERROR'

type AudioSource = 'microphone' | 'system'
type AudioMode = AudioSource | 'both'
type GenerationOrigin = 'manual' | 'auto' | 'retry'
type AutoAssistStatus = 'OFF' | 'LISTENING' | 'QUESTION_DETECTED' | 'WAITING' | 'GENERATING'
type WindowMode = 'expanded' | 'bubble'
type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type InterviewContextField = 'instructions' | 'resume' | 'jobDescription'

interface LiveTranscriptUpdate {
  interim: string
  final: string
  source: AudioSource
}

interface LiveAnswerDelta {
  requestId: string
  requestText: string
  source: AudioSource
  requestType?: 'conversation' | 'image' | 'text'
  delta: string
  reset: boolean
}

interface ConversationSegment {
  id: string
  text: string
  source: AudioSource
  timestamp: number
}

interface RecentInteraction {
  requestId: string
  conversation: ConversationSegment[]
  assistantAnswer: string
  timestamp: number
}

interface GenerateAnswerResult {
  success: boolean
  requestId?: string
  error?: string
}

interface GenerateAnswerInput {
  conversation: ConversationSegment[]
  instruction: string
  screenshots: PendingScreenshot[]
  attachments: PendingAttachment[]
  origin?: GenerationOrigin
  autoTriggerId?: string
  autoTiming?: AutoAssistTrigger
  rendererGenerateAt?: number
}

interface AutoAssistTrigger {
  id: string
  segmentId: string
  source: AudioSource
  timestamp: number
  speechStoppedAt?: number
  finalTranscriptAt?: number
  utteranceFinalizedAt?: number
  autoAcceptedAt: number
}

interface AnswerFailure {
  requestId: string
  message: string
}

interface InterviewContextStatus {
  resumeLoaded: boolean
  resumeChars: number
  jobDescriptionLoaded: boolean
  jobDescriptionChars: number
  instructionsLoaded: boolean
  instructionsChars: number
  ready: boolean
}

interface InterviewContextUpdateResult {
  success: boolean
  status?: InterviewContextStatus
  error?: string
}

interface ProductUser {
  id: string
  email: string
  displayName?: string
  emailVerified?: boolean
}

interface InterviewSummary {
  id: string
  name: string
  company?: string
  role?: string
  createdAt: number
  updatedAt: number
  status: 'active' | 'completed'
  resumeLoaded: boolean
  jobDescriptionLoaded: boolean
  instructionsLoaded: boolean
  historyTurns: number
}

interface ProfileSummary {
  id: string
  name: string
  resumeLoaded: boolean
  instructionsLoaded: boolean
  createdAt: number
  updatedAt: number
}

interface ProductBootstrap {
  user: ProductUser | null
  interviews: InterviewSummary[]
  profiles: ProfileSummary[]
  settings: { defaultAutoAssist: boolean }
  activeInterviewId?: string
}

interface ProductResult {
  success: boolean
  bootstrap?: ProductBootstrap
  interview?: { id: string; name: string; company?: string; role?: string }
  status?: InterviewContextStatus
  profile?: { id: string; name: string }
  file?: { name: string; size: number; kind: string }
  canceled?: boolean
  error?: string
}

interface PendingScreenshot {
  id: string
  imageDataUrl: string
  capturedAt: number
}

interface PendingAttachment {
  id: string
  name: string
  extension: string
  mimeType: string
  size: number
  kind: 'text' | 'code' | 'pdf' | 'word' | 'image'
  imageDataUrl?: string
}

interface SelectAttachmentResult {
  success: boolean
  canceled?: boolean
  attachments?: PendingAttachment[]
  error?: string
}

interface WorkspaceMessage {
  id: string
  type: 'user-text' | 'screen-capture' | 'assistant'
  text: string
  timestamp: number
  requestId?: string
}

interface PrivacyModeResult {
  success: boolean
  enabled: boolean
  error?: string
}

interface SharingStatus {
  state: 'OFF' | 'STARTING' | 'ON' | 'UNAVAILABLE'
  sessionId?: string
  viewerToken?: string
  viewerUrl?: string
  expiresAt?: number
  error?: string
}

type ScreenCaptureState = 'IDLE' | 'SELECTING' | 'CAPTURING' | 'READY' | 'ANALYZING' | 'RESPONDING'

interface SelectionRectangle {
  x: number
  y: number
  width: number
  height: number
}

interface Window {
  productAPI: {
    getBootstrap: () => Promise<ProductBootstrap>
    login: (email: string, password: string, displayName?: string, inviteCode?: string) => Promise<ProductResult>
    logout: () => Promise<ProductBootstrap>
    beginNewInterview: () => Promise<InterviewContextStatus>
    loadContextFile: (field: 'resume' | 'jobDescription') => Promise<ProductResult>
    startInterview: (input: { name: string; company: string; role: string; jobDescription: string; instructions: string }) => Promise<ProductResult>
    endInterview: () => Promise<ProductBootstrap>
    openInterview: (id: string) => Promise<ProductResult>
    saveProfile: (name: string, id?: string) => Promise<ProductResult>
    applyProfile: (id: string) => Promise<ProductResult>
    deleteProfile: (id: string) => Promise<ProductResult>
    deleteInterview: (id: string) => Promise<ProductResult>
    listSessions: () => Promise<Array<{ id: string; deviceLabel: string; lastUsedAt: string; createdAt: string; expiresAt: string; current: boolean }>>
    logoutOtherSessions: () => Promise<{ revoked: number }>
    requestPasswordReset: (email: string) => Promise<{ message: string }>
    resetPassword: (token: string, password: string) => Promise<{ success: boolean }>
    verifyEmail: (token: string) => Promise<ProductResult>
    resendVerification: () => Promise<ProductResult>
    exportData: () => Promise<{ success: boolean; canceled?: boolean }>
    deleteAccount: (password: string, confirmation: string) => Promise<ProductBootstrap>
    updateSettings: (defaultAutoAssist: boolean) => Promise<ProductResult>
    updateAccount: (displayName: string) => Promise<ProductResult>
    clearLocalData: () => Promise<ProductBootstrap>
    onSurfaceMode: (listener: (mode: 'product' | 'assistant') => void) => () => void
  }
  overlayAPI: {
    increaseOpacity: () => Promise<number>
    decreaseOpacity: () => Promise<number>
    getOpacity: () => Promise<number>
    getPrivacyMode: () => Promise<PrivacyModeResult>
    setPrivacyMode: (enabled: boolean) => Promise<PrivacyModeResult>
    startRegionCapture: () => Promise<boolean>
    getPendingScreenshots: () => Promise<PendingScreenshot[]>
    removePendingCapture: (id: string) => Promise<boolean>
    clearPendingCaptures: () => Promise<boolean>
    onScreenCaptureState: (listener: (state: ScreenCaptureState) => void) => () => void
    onScreenCaptureError: (listener: (message: string) => void) => () => void
    onPendingScreenshots: (listener: (screenshots: PendingScreenshot[]) => void) => () => void
    getPendingAttachments: () => Promise<PendingAttachment[]>
    selectAttachment: () => Promise<SelectAttachmentResult>
    removeAttachment: (id: string) => Promise<boolean>
    clearAttachments: () => Promise<boolean>
    onPendingAttachments: (listener: (attachments: PendingAttachment[]) => void) => () => void
    getWindowMode: () => Promise<WindowMode>
    collapseToBubble: () => Promise<WindowMode>
    expandFromBubble: () => Promise<WindowMode>
    beginBubbleDrag: (screenX: number, screenY: number) => void
    moveBubble: (screenX: number, screenY: number) => void
    endBubbleDrag: () => void
    onWindowMode: (listener: (mode: WindowMode) => void) => () => void
    beginResize: (corner: ResizeCorner, screenX: number, screenY: number) => void
    resize: (screenX: number, screenY: number) => void
    endResize: () => void
    quitApp: () => void
    copyAnswer: (value: string) => Promise<boolean>
  }
  liveAssistant: {
    start: (mode: AudioMode) => Promise<void>
    stop: () => Promise<void>
    sendAudio: (source: AudioSource, audio: ArrayBuffer) => void
    generateAnswer: (input: GenerateAnswerInput) => Promise<GenerateAnswerResult>
    resetContext: () => Promise<void>
    getAutoAssist: () => Promise<boolean>
    setAutoAssist: (enabled: boolean) => Promise<boolean>
    rejectAutoTrigger: (triggerId: string) => Promise<void>
    onTranscript: (listener: (update: LiveTranscriptUpdate) => void) => () => void
    onConversationSegment: (listener: (segment: ConversationSegment) => void) => () => void
    onAnswerDelta: (listener: (update: LiveAnswerDelta) => void) => () => void
    onAnswerComplete: (listener: (requestId: string) => void) => () => void
    onAnswerFailed: (listener: (failure: AnswerFailure) => void) => () => void
    onStatus: (listener: (status: LiveAssistantStatus) => void) => () => void
    onError: (listener: (message: string) => void) => () => void
    onAutoTrigger: (listener: (trigger: AutoAssistTrigger) => void) => () => void
    onAutoStatus: (listener: (status: AutoAssistStatus) => void) => () => void
    getWorkspaceHistory: () => Promise<WorkspaceMessage[]>
    getConversationHistory: () => Promise<RecentInteraction[]>
    getInterviewContextStatus: () => Promise<InterviewContextStatus>
    setInterviewContextText: (field: InterviewContextField, value: string) => Promise<InterviewContextUpdateResult>
    useAttachmentAsInterviewContext: (id: string, field: 'resume' | 'jobDescription') => Promise<InterviewContextUpdateResult>
    sendWorkspaceText: (text: string) => Promise<GenerateAnswerResult>
    onWorkspaceMessage: (listener: (message: WorkspaceMessage) => void) => () => void
    onConversationInteraction: (listener: (interaction: RecentInteraction) => void) => () => void
    onInterviewContextStatus: (listener: (status: InterviewContextStatus) => void) => () => void
  }
  sharingAPI: {
    getStatus: () => Promise<SharingStatus>
    start: () => Promise<SharingStatus>
    stop: () => Promise<SharingStatus>
    copyText: (value: string) => Promise<boolean>
    onStatus: (listener: (status: SharingStatus) => void) => () => void
  }
  selectionAPI: {
    start: () => void
    select: (rectangle: SelectionRectangle) => void
    cancel: () => void
  }
}
