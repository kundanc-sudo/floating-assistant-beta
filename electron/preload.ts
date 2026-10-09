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
type GenerationOrigin = 'manual' | 'auto' | 'retry'
type AutoAssistStatus = 'OFF' | 'LISTENING' | 'QUESTION_DETECTED' | 'WAITING' | 'GENERATING'
type WindowMode = 'expanded' | 'bubble'
type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type InterviewContextField = 'instructions' | 'resume' | 'jobDescription'

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
  getPendingScreenshots: (): Promise<PendingScreenshot[]> =>
    ipcRenderer.invoke('screen-capture:get-pending'),
  removePendingCapture: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('screen-capture:remove-pending', id),
  clearPendingCaptures: (): Promise<boolean> =>
    ipcRenderer.invoke('screen-capture:clear-pending'),
  onScreenCaptureState: (listener: (state: ScreenCaptureState) => void) =>
    subscribe('screen-capture:state', listener),
  onScreenCaptureError: (listener: (message: string) => void) =>
    subscribe('screen-capture:error', listener),
  onPendingScreenshots: (listener: (screenshots: PendingScreenshot[]) => void) =>
    subscribe('screen-capture:pending-items', listener),
  getPendingAttachments: (): Promise<PendingAttachment[]> =>
    ipcRenderer.invoke('attachment:get-pending'),
  selectAttachment: (): Promise<SelectAttachmentResult> =>
    ipcRenderer.invoke('attachment:select'),
  removeAttachment: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('attachment:remove', id),
  clearAttachments: (): Promise<boolean> =>
    ipcRenderer.invoke('attachment:clear'),
  onPendingAttachments: (listener: (attachments: PendingAttachment[]) => void) =>
    subscribe('attachment:pending-items', listener),
  getWindowMode: (): Promise<WindowMode> =>
    ipcRenderer.invoke('overlay:get-window-mode'),
  collapseToBubble: (): Promise<WindowMode> =>
    ipcRenderer.invoke('overlay:collapse-to-bubble'),
  expandFromBubble: (): Promise<WindowMode> =>
    ipcRenderer.invoke('overlay:expand-from-bubble'),
  beginBubbleDrag: (screenX: number, screenY: number): void =>
    ipcRenderer.send('overlay:begin-bubble-drag', screenX, screenY),
  moveBubble: (screenX: number, screenY: number): void =>
    ipcRenderer.send('overlay:move-bubble', screenX, screenY),
  endBubbleDrag: (): void => ipcRenderer.send('overlay:end-bubble-drag'),
  onWindowMode: (listener: (mode: WindowMode) => void) =>
    subscribe('overlay:window-mode', listener),
  beginResize: (corner: ResizeCorner, screenX: number, screenY: number): void =>
    ipcRenderer.send('overlay:begin-resize', corner, screenX, screenY),
  resize: (screenX: number, screenY: number): void =>
    ipcRenderer.send('overlay:resize', screenX, screenY),
  endResize: (): void => ipcRenderer.send('overlay:end-resize'),
  quitApp: (): void => ipcRenderer.send('app:quit'),
  copyAnswer: (value: string): Promise<boolean> =>
    ipcRenderer.invoke('overlay:copy-answer', value),
})

contextBridge.exposeInMainWorld('productAPI', {
  getBootstrap: (): Promise<ProductBootstrap> => ipcRenderer.invoke('product:get-bootstrap'),
  login: (email: string, password: string, displayName?: string, inviteCode?: string): Promise<ProductResult> =>
    ipcRenderer.invoke('product:login', { email, password, displayName, inviteCode }),
  logout: (): Promise<ProductBootstrap> => ipcRenderer.invoke('product:logout'),
  beginNewInterview: (): Promise<InterviewContextStatus> =>
    ipcRenderer.invoke('product:begin-new-interview'),
  loadContextFile: (field: 'resume' | 'jobDescription'): Promise<ProductResult> =>
    ipcRenderer.invoke('product:load-context-file', field),
  startInterview: (input: {
    name: string
    company: string
    role: string
    jobDescription: string
    instructions: string
  }): Promise<ProductResult> => ipcRenderer.invoke('product:start-interview', input),
  endInterview: (): Promise<ProductBootstrap> => ipcRenderer.invoke('product:end-interview'),
  openInterview: (id: string): Promise<ProductResult> =>
    ipcRenderer.invoke('product:open-interview', id),
  saveProfile: (name: string, id?: string): Promise<ProductResult> =>
    ipcRenderer.invoke('product:save-profile', { name, id }),
  applyProfile: (id: string): Promise<ProductResult> =>
    ipcRenderer.invoke('product:apply-profile', id),
  deleteProfile: (id: string): Promise<ProductResult> =>
    ipcRenderer.invoke('product:delete-profile', id),
  deleteInterview: (id: string): Promise<ProductResult> =>
    ipcRenderer.invoke('product:delete-interview', id),
  listSessions: () => ipcRenderer.invoke('product:list-sessions'),
  logoutOtherSessions: () => ipcRenderer.invoke('product:logout-other-sessions'),
  requestPasswordReset: (email: string) => ipcRenderer.invoke('product:request-password-reset', email),
  resetPassword: (token: string, password: string) => ipcRenderer.invoke('product:reset-password', { token, password }),
  verifyEmail: (token: string): Promise<ProductResult> => ipcRenderer.invoke('product:verify-email', token),
  resendVerification: (): Promise<ProductResult> => ipcRenderer.invoke('product:resend-verification'),
  exportData: () => ipcRenderer.invoke('product:export-data'),
  deleteAccount: (password: string, confirmation: string): Promise<ProductBootstrap> =>
    ipcRenderer.invoke('product:delete-account', { password, confirmation }),
  updateSettings: (defaultAutoAssist: boolean): Promise<ProductResult> =>
    ipcRenderer.invoke('product:update-settings', { defaultAutoAssist }),
  updateAccount: (displayName: string): Promise<ProductResult> =>
    ipcRenderer.invoke('product:update-account', displayName),
  clearLocalData: (): Promise<ProductBootstrap> =>
    ipcRenderer.invoke('product:clear-local-data'),
  onSurfaceMode: (listener: (mode: 'product' | 'assistant') => void) =>
    subscribe('app:surface-mode', listener),
})

contextBridge.exposeInMainWorld('selectionAPI', {
  start: (): void => ipcRenderer.send('screen-capture:selection-started'),
  select: (rectangle: SelectionRectangle): void =>
    ipcRenderer.send('screen-capture:selected', rectangle),
  cancel: (): void => ipcRenderer.send('screen-capture:cancel'),
})

contextBridge.exposeInMainWorld('sharingAPI', {
  getStatus: (): Promise<SharingStatus> => ipcRenderer.invoke('sharing:get-status'),
  start: (): Promise<SharingStatus> => ipcRenderer.invoke('sharing:start'),
  stop: (): Promise<SharingStatus> => ipcRenderer.invoke('sharing:stop'),
  copyText: (value: string): Promise<boolean> =>
    ipcRenderer.invoke('sharing:copy-text', value),
  onStatus: (listener: (status: SharingStatus) => void) =>
    subscribe('sharing:status', listener),
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
  getAutoAssist: (): Promise<boolean> =>
    ipcRenderer.invoke('live-assistant:get-auto-assist'),
  setAutoAssist: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('live-assistant:set-auto-assist', enabled),
  rejectAutoTrigger: (triggerId: string): Promise<void> =>
    ipcRenderer.invoke('live-assistant:reject-auto-trigger', triggerId),
  onTranscript: (listener: (update: TranscriptUpdate) => void) =>
    subscribe('live-assistant:transcript', listener),
  onConversationSegment: (listener: (segment: ConversationSegment) => void) =>
    subscribe('live-assistant:conversation-segment', listener),
  onAnswerDelta: (listener: (update: AnswerDelta) => void) =>
    subscribe('live-assistant:answer-delta', listener),
  onAnswerComplete: (listener: (requestId: string) => void) =>
    subscribe('live-assistant:answer-complete', listener),
  onAnswerFailed: (listener: (failure: AnswerFailure) => void) =>
    subscribe('live-assistant:answer-failed', listener),
  onStatus: (listener: (status: LiveAssistantStatus) => void) =>
    subscribe('live-assistant:status', listener),
  onError: (listener: (message: string) => void) =>
    subscribe('live-assistant:error', listener),
  onAutoTrigger: (listener: (trigger: AutoAssistTrigger) => void) =>
    subscribe('live-assistant:auto-trigger', listener),
  onAutoStatus: (listener: (status: AutoAssistStatus) => void) =>
    subscribe('live-assistant:auto-status', listener),
  getWorkspaceHistory: (): Promise<WorkspaceMessage[]> =>
    ipcRenderer.invoke('workspace:get-history'),
  getConversationHistory: (): Promise<RecentInteraction[]> =>
    ipcRenderer.invoke('session:get-interactions'),
  getInterviewContextStatus: (): Promise<InterviewContextStatus> =>
    ipcRenderer.invoke('interview-context:get-status'),
  setInterviewContextText: (
    field: InterviewContextField,
    value: string,
  ): Promise<InterviewContextUpdateResult> =>
    ipcRenderer.invoke('interview-context:set-text', field, value),
  useAttachmentAsInterviewContext: (
    id: string,
    field: 'resume' | 'jobDescription',
  ): Promise<InterviewContextUpdateResult> =>
    ipcRenderer.invoke('interview-context:use-attachment', id, field),
  sendWorkspaceText: (text: string): Promise<GenerateAnswerResult> =>
    ipcRenderer.invoke('workspace:send-text', text),
  onWorkspaceMessage: (listener: (message: WorkspaceMessage) => void) =>
    subscribe('workspace:message', listener),
  onConversationInteraction: (listener: (interaction: RecentInteraction) => void) =>
    subscribe('session:interaction', listener),
  onInterviewContextStatus: (listener: (status: InterviewContextStatus) => void) =>
    subscribe('interview-context:status', listener),
})
