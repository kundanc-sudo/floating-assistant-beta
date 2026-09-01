import { contextBridge, ipcRenderer } from 'electron'

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

interface TranscriptUpdate {
  interim: string
  final: string
  source: AudioSource
}

interface AnswerDelta {
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

function subscribe<T>(channel: string, listener: (value: T) => void) {
  const wrappedListener = (_event: Electron.IpcRendererEvent, value: T) =>
    listener(value)
  ipcRenderer.on(channel, wrappedListener)
  return () => ipcRenderer.removeListener(channel, wrappedListener)
}

contextBridge.exposeInMainWorld('overlayAPI', {
  increaseOpacity: (): Promise<number> =>
    ipcRenderer.invoke('overlay:increase-opacity'),
  decreaseOpacity: (): Promise<number> =>
    ipcRenderer.invoke('overlay:decrease-opacity'),
  getOpacity: (): Promise<number> => ipcRenderer.invoke('overlay:get-opacity'),
  getPrivacyMode: (): Promise<PrivacyModeResult> =>
    ipcRenderer.invoke('overlay:get-privacy-mode'),
  setPrivacyMode: (enabled: boolean): Promise<PrivacyModeResult> =>
    ipcRenderer.invoke('overlay:set-privacy-mode', enabled),
  startRegionCapture: (): Promise<boolean> =>
    ipcRenderer.invoke('screen-capture:start'),
  removePendingCapture: (): Promise<boolean> =>
    ipcRenderer.invoke('screen-capture:remove-pending'),
  onScreenCaptureState: (listener: (state: ScreenCaptureState) => void) =>
    subscribe('screen-capture:state', listener),
  onScreenCaptureError: (listener: (message: string) => void) =>
    subscribe('screen-capture:error', listener),
})

contextBridge.exposeInMainWorld('selectionAPI', {
  select: (rectangle: SelectionRectangle): void =>
    ipcRenderer.send('screen-capture:selected', rectangle),
  cancel: (): void => ipcRenderer.send('screen-capture:cancel'),
})

contextBridge.exposeInMainWorld('liveAssistant', {
  start: (mode: AudioMode): Promise<void> =>
    ipcRenderer.invoke('live-assistant:start', mode),
  stop: (): Promise<void> => ipcRenderer.invoke('live-assistant:stop'),
  sendAudio: (source: AudioSource, audio: ArrayBuffer): void =>
    ipcRenderer.send(
      'live-assistant:audio',
      source,
      new Uint8Array(audio),
    ),
  generateAnswer: (input: GenerateAnswerInput): Promise<GenerateAnswerResult> =>
    ipcRenderer.invoke('live-assistant:generate-answer', input),
  resetContext: (): Promise<void> =>
    ipcRenderer.invoke('live-assistant:reset-context'),
  onTranscript: (listener: (update: TranscriptUpdate) => void) =>
    subscribe('live-assistant:transcript', listener),
  onConversationSegment: (listener: (segment: ConversationSegment) => void) =>
    subscribe('live-assistant:conversation-segment', listener),
  onAnswerDelta: (listener: (update: AnswerDelta) => void) =>
    subscribe('live-assistant:answer-delta', listener),
  onAnswerComplete: (listener: (requestId: string) => void) =>
    subscribe('live-assistant:answer-complete', listener),
  onStatus: (listener: (status: LiveAssistantStatus) => void) =>
    subscribe('live-assistant:status', listener),
  onError: (listener: (message: string) => void) =>
    subscribe('live-assistant:error', listener),
  getWorkspaceHistory: (): Promise<WorkspaceMessage[]> =>
    ipcRenderer.invoke('workspace:get-history'),
  sendWorkspaceText: (text: string): Promise<GenerateAnswerResult> =>
    ipcRenderer.invoke('workspace:send-text', text),
  onWorkspaceMessage: (listener: (message: WorkspaceMessage) => void) =>
    subscribe('workspace:message', listener),
})
