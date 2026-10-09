import WebSocket from 'ws'

export type LiveAssistantStatus =
  | 'IDLE'
  | 'CONNECTING'
  | 'LISTENING'
  | 'USER SPEAKING'
  | 'PROCESSING'
  | 'FILTERING'
  | 'AI RESPONDING'
  | 'ERROR'

export type AudioSource = 'microphone' | 'system'

export interface TranscriptUpdate {
  interim: string
  final: string
  source: AudioSource
}

export interface AnswerDelta {
  requestId: string
  requestText: string
  source: AudioSource
  requestType?: 'conversation' | 'image' | 'text'
  delta: string
  reset: boolean
}

export interface AcceptedRequest {
  id: string
  text: string
  normalizedText: string
  source: AudioSource
  timestamp: number
  requestType?: 'conversation' | 'image' | 'text'
  traceTurnId?: string
}

interface RealtimeEvent {
  type?: string
  delta?: string
  transcript?: string
  error?: { message?: string; code?: string }
  response_id?: string
  response?: { id?: string; status?: string }
}

interface ServiceEvents {
  onStatus: (status: LiveAssistantStatus) => void
  onTranscript: (update: TranscriptUpdate) => void
  onAnswerDelta: (update: AnswerDelta) => void
  onAnswerComplete: (request: AcceptedRequest, answer: string) => void
  onStaleAnswer: (requestId: string) => void
  onError: (message: string) => void
  onTranscriptFragment: (source: AudioSource, transcript: string) => void
  onSpeechStopped: (source: AudioSource, timestamp: number) => void
}

interface RealtimeAssistantOptions {
  url?: string
  development?: boolean
}

const REALTIME_URL =
  'wss://api.openai.com/v1/realtime?model=gpt-realtime'
const RECONNECT_DELAYS = [1000, 2000, 4000]
const FATAL_REALTIME_ERROR_CODES = new Set([
  'invalid_api_key',
  'insufficient_quota',
  'billing_not_active',
  'model_not_found',
  'permission_denied',
  'project_not_found',
])

export class RealtimeAssistantService {
  private socket: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private connectionGeneration = 0
  private running = false
  private speaking = false
  private responding = false
  private credentialProvider: (() => Promise<string>) | null = null
  private interimTranscript = ''
  private pendingResponseText = ''
  private hasEmittedResponseText = false
  private completeResponseText = ''
  private pendingRequest: AcceptedRequest | null = null
  private activeRequest: AcceptedRequest | null = null
  private activeResponseId: string | null = null

  constructor(
    private readonly source: AudioSource,
    private readonly events: ServiceEvents,
    private readonly options: RealtimeAssistantOptions = {},
  ) {}

  async start(credential: string | (() => Promise<string>)): Promise<void> {
    if (this.running) return
    if (!credential) throw new Error('Realtime authentication is unavailable.')

    this.credentialProvider = typeof credential === 'string' ? async () => credential : credential
    this.running = true
    this.reconnectAttempt = 0
    const generation = ++this.connectionGeneration
    this.events.onStatus('CONNECTING')
    this.log('[Realtime] connecting')

    try {
      await this.connect(generation)
    } catch (error) {
      if (!this.running || generation !== this.connectionGeneration) return
      this.running = false
      this.events.onStatus('ERROR')
      throw error
    }
  }

  stop(): void {
    const wasActive = this.running || this.socket !== null || this.reconnectTimer !== null
    this.running = false
    this.connectionGeneration += 1
    this.speaking = false
    this.responding = false
    this.interimTranscript = ''
    this.pendingRequest = null
    this.activeRequest = null
    this.activeResponseId = null

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const socket = this.socket
    this.socket = null
    if (socket) this.closeSocket(socket)

    if (wasActive) this.log('[Realtime] intentional stop')
    this.events.onStatus('IDLE')
  }

  sendAudio(audio: Uint8Array): void {
    if (this.socket?.readyState !== WebSocket.OPEN || audio.byteLength === 0) {
      return
    }

    this.send({
      type: 'input_audio_buffer.append',
      audio: Buffer.from(audio).toString('base64'),
    })
  }

  createResponse(request: AcceptedRequest, inputText?: string): void {
    if (this.socket?.readyState === WebSocket.OPEN && !this.responding) {
      this.pendingRequest = request
      if (inputText) {
        this.send({
          type: 'response.create',
          response: {
            conversation: 'none',
            input: [{
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: inputText }],
            }],
          },
        })
        return
      }
      this.send({ type: 'response.create' })
    }
  }

  createVisionResponse(
    request: AcceptedRequest,
    inputText: string,
    imageDataUrl: string,
  ): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.responding) return
    this.pendingRequest = request
    this.send({
      type: 'response.create',
      response: {
        conversation: 'none',
        input: [{
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: inputText },
            { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
          ],
        }],
      },
    })
  }

  cancelResponse(): void {
    if (this.responding) {
      this.send({ type: 'response.cancel' })
      this.responding = false
    }
    this.pendingResponseText = ''
    this.hasEmittedResponseText = false
    this.completeResponseText = ''
    this.pendingRequest = null
    this.activeRequest = null
    this.activeResponseId = null
  }

  private async connect(generation: number): Promise<void> {
    const apiKey = await this.credentialProvider?.()
    if (!apiKey) throw new Error('Realtime authentication is unavailable.')
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.url ?? REALTIME_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
      this.socket = socket
      let settled = false

      socket.once('open', () => {
        if (!this.running || generation !== this.connectionGeneration) {
          settled = true
          this.closeSocket(socket)
          resolve()
          return
        }
        settled = true
        this.reconnectAttempt = 0
        this.configureSession()
        resolve()
      })

      socket.on('message', (data) => {
        if (this.running && generation === this.connectionGeneration) {
          this.handleMessage(data.toString())
        }
      })

      socket.once('unexpected-response', (_request, response) => {
        if (!this.running || generation !== this.connectionGeneration) {
          if (!settled) resolve()
          return
        }
        const message =
          response.statusCode === 401
            ? 'Realtime authentication failed. Request a new backend session credential.'
            : `Realtime connection failed with HTTP ${response.statusCode}.`
        if (!settled) reject(new Error(message))
        this.fail(message)
      })

      socket.once('error', (error) => {
        if (!settled) {
          if (!this.running || generation !== this.connectionGeneration) resolve()
          else reject(new Error(`Realtime connection failed: ${error.message}`))
        }
      })

      socket.once('close', (code, reasonBuffer) => {
        if (this.socket === socket) this.socket = null
        const isCurrent = generation === this.connectionGeneration
        const reason = reasonBuffer.toString()
        if (this.options.development) {
          this.log(`[Realtime] socket closed code=${code} reason=${reason || '(none)'}`)
        }
        if (!settled) {
          if (!this.running || !isCurrent) resolve()
          else reject(new Error('Realtime connection closed before it was ready.'))
        }
        if (
          this.running &&
          isCurrent &&
          (reason.includes('invalid_api_key') || reason.includes('authentication'))
        ) {
          this.fail('Realtime authentication failed. Request a new backend session credential.')
          return
        }
        if (this.running && isCurrent) this.scheduleReconnect()
        else if (!this.running) this.log('[Realtime] reconnect suppressed because stopped')
      })
    })
  }

  private configureSession(): void {
    this.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['text'],
        instructions:
          'You are a concise, helpful desktop assistant. Always answer in English, even when the user speaks or asks a question in another language. Answer the user’s spoken question clearly. Use plain text with readable code blocks when useful.',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: {
              model: 'gpt-4o-mini-transcribe',
              language: 'en',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: false,
              // A response is superseded only after a new turn passes validation.
              interrupt_response: false,
            },
          },
        },
      },
    })
  }

  private handleMessage(rawMessage: string): void {
    let event: RealtimeEvent
    try {
      event = JSON.parse(rawMessage) as RealtimeEvent
    } catch {
      return
    }

    switch (event.type) {
      case 'session.updated':
        this.events.onStatus('LISTENING')
        break
      case 'input_audio_buffer.speech_started':
        this.speaking = true
        this.interimTranscript = ''
        this.events.onStatus('USER SPEAKING')
        break
      case 'input_audio_buffer.speech_stopped':
        this.speaking = false
        this.events.onSpeechStopped(this.source, Date.now())
        this.events.onStatus('PROCESSING')
        break
      case 'conversation.item.input_audio_transcription.delta':
        this.interimTranscript += event.delta ?? ''
        this.events.onTranscript({
          interim: this.interimTranscript,
          final: '',
          source: this.source,
        })
        break
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = (event.transcript ?? this.interimTranscript).trim()
        this.interimTranscript = ''
        this.events.onTranscript({
          interim: '',
          final: '',
          source: this.source,
        })
        this.events.onTranscriptFragment(this.source, transcript)
        this.events.onStatus('LISTENING')
        break
      }
      case 'response.created':
        this.activeRequest = this.pendingRequest
        this.pendingRequest = null
        this.activeResponseId = event.response?.id ?? null
        this.responding = true
        this.pendingResponseText = ''
        this.hasEmittedResponseText = false
        this.completeResponseText = ''
        this.events.onStatus('AI RESPONDING')
        break
      case 'response.output_text.delta':
      case 'response.text.delta':
        if (event.delta) {
          const request = this.activeRequest
          if (
            !request ||
            (event.response_id &&
              this.activeResponseId &&
              event.response_id !== this.activeResponseId)
          ) {
            this.events.onStaleAnswer(request?.id ?? 'unknown')
            break
          }
          this.completeResponseText += event.delta
          if (!this.hasEmittedResponseText) {
            this.pendingResponseText += event.delta
            if (this.pendingResponseText.trim()) {
              this.events.onAnswerDelta({
                requestId: request.id,
                requestText: request.text,
                source: request.source,
                requestType: request.requestType,
                delta: this.pendingResponseText,
                reset: true,
              })
              this.pendingResponseText = ''
              this.hasEmittedResponseText = true
            }
          } else {
            this.events.onAnswerDelta({
              requestId: request.id,
              requestText: request.text,
              source: request.source,
              requestType: request.requestType,
              delta: event.delta,
              reset: false,
            })
          }
        }
        break
      case 'response.done':
        if (
          this.activeRequest &&
          (!event.response?.id || event.response.id === this.activeResponseId)
        ) {
          this.events.onAnswerComplete(this.activeRequest, this.completeResponseText)
        }
        this.responding = false
        this.activeRequest = null
        this.activeResponseId = null
        this.completeResponseText = ''
        if (!this.speaking) this.events.onStatus('LISTENING')
        break
      case 'error':
        if (event.error?.code && FATAL_REALTIME_ERROR_CODES.has(event.error.code)) {
          const message = event.error.code === 'invalid_api_key'
            ? 'Realtime authentication failed. Request a new backend session credential.'
            : `OpenAI Realtime cannot start (${event.error.code}). Check API billing, model access, and project permissions.`
          this.fail(message)
        } else {
          this.events.onError(
            event.error?.message ?? 'The Realtime API reported an unknown error.',
          )
        }
        break
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.running) return

    if (this.reconnectAttempt >= RECONNECT_DELAYS.length) {
      this.fail('Realtime connection could not be restored after three attempts.')
      return
    }

    const delay = RECONNECT_DELAYS[this.reconnectAttempt]
    this.reconnectAttempt += 1
    this.events.onStatus('CONNECTING')
    this.events.onError(
      `Realtime connection lost. Reconnecting in ${delay / 1000} second${delay === 1000 ? '' : 's'}…`,
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.running) return
      const generation = this.connectionGeneration
      void this.connect(generation).catch(() => {
        if (this.running && generation === this.connectionGeneration) this.scheduleReconnect()
      })
    }, delay)
  }

  private fail(message: string): void {
    this.events.onError(message)
    this.events.onStatus('ERROR')
    this.stopConnectionOnly()
  }

  private stopConnectionOnly(): void {
    this.running = false
    this.connectionGeneration += 1
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    if (socket) this.closeSocket(socket)
  }

  private closeSocket(socket: WebSocket): void {
    const state = socket.readyState
    this.log(`[Realtime] socket state=${state}`)
    if (state !== WebSocket.CONNECTING && state !== WebSocket.OPEN) return
    try {
      // Keep the existing error/close listeners until shutdown completes. In
      // particular, ws emits an error when a CONNECTING socket is cancelled.
      socket.close()
    } catch (error) {
      if (this.options.development) console.error('[Realtime] socket close failed', error)
    }
  }

  private log(message: string): void {
    if (this.options.development) console.info(message)
  }

  private send(event: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event))
    }
  }
}
