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

interface GenerateAnswerResult {
  success: boolean
  requestId?: string
  error?: string
}

interface GenerateAnswerInput {
  conversation: ConversationSegment[]
  instruction: string
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

type ScreenCaptureState = 'IDLE' | 'SELECTING' | 'CAPTURING' | 'READY' | 'ANALYZING' | 'RESPONDING'

interface SelectionRectangle {
  x: number
  y: number
  width: number
  height: number
}

interface Window {
  overlayAPI: {
    increaseOpacity: () => Promise<number>
    decreaseOpacity: () => Promise<number>
    getOpacity: () => Promise<number>
    getPrivacyMode: () => Promise<PrivacyModeResult>
    setPrivacyMode: (enabled: boolean) => Promise<PrivacyModeResult>
    startRegionCapture: () => Promise<boolean>
    removePendingCapture: () => Promise<boolean>
    onScreenCaptureState: (listener: (state: ScreenCaptureState) => void) => () => void
    onScreenCaptureError: (listener: (message: string) => void) => () => void
  }
  liveAssistant: {
    start: (mode: AudioMode) => Promise<void>
    stop: () => Promise<void>
    sendAudio: (source: AudioSource, audio: ArrayBuffer) => void
    generateAnswer: (input: GenerateAnswerInput) => Promise<GenerateAnswerResult>
    resetContext: () => Promise<void>
    onTranscript: (listener: (update: LiveTranscriptUpdate) => void) => () => void
    onConversationSegment: (listener: (segment: ConversationSegment) => void) => () => void
    onAnswerDelta: (listener: (update: LiveAnswerDelta) => void) => () => void
    onAnswerComplete: (listener: (requestId: string) => void) => () => void
    onStatus: (listener: (status: LiveAssistantStatus) => void) => () => void
    onError: (listener: (message: string) => void) => () => void
    getWorkspaceHistory: () => Promise<WorkspaceMessage[]>
    sendWorkspaceText: (text: string) => Promise<GenerateAnswerResult>
    onWorkspaceMessage: (listener: (message: WorkspaceMessage) => void) => () => void
  }
  selectionAPI: {
    select: (rectangle: SelectionRectangle) => void
    cancel: () => void
  }
}
