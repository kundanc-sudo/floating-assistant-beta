export interface ProviderUsage { inputTokens?: number; outputTokens?: number }
export interface ProviderEvent { delta?: string; usage?: ProviderUsage }
export interface AiRequest {
  route: 'CONVERSATION' | 'TECHNICAL' | 'CODING'
  userText: string
  instructions: string
  imageInputs?: Array<{ label: string; imageDataUrl: string }>
}

export interface AiProvider {
  stream(input: AiRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent>
  createRealtimeSecret(): Promise<{ value: string; expiresAt?: number }>
  summarize(input: string): Promise<string>
}

export type RealtimeSecretFailureStage =
  | 'require_key'
  | 'request_setup'
  | 'upstream_fetch'
  | 'response_parse'
  | 'response_validate'

export interface RealtimeSecretDiagnostic {
  stage: RealtimeSecretFailureStage
  errorName: string
  safeMessage: string
  causeCode?: string
  upstreamStatus?: number
  elapsedMs: number
}

interface OpenAiProviderOptions {
  fetcher?: typeof fetch
  onRealtimeDiagnostic?: (diagnostic: RealtimeSecretDiagnostic) => void
}

export class OpenAiProvider implements AiProvider {
  constructor(
    private readonly key: string,
    private readonly models: { fast: string; coding: string; summary: string },
    private readonly timeoutMs = 120_000,
    private readonly options: OpenAiProviderOptions = {},
  ) {}

  async *stream(input: AiRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    this.requireKey()
    const coding = input.route === 'CODING'
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: coding ? this.models.coding : this.models.fast,
        store: false,
        stream: true,
        stream_options: { include_obfuscation: false },
        instructions: input.instructions,
        reasoning: { effort: coding ? 'high' : 'low' },
        text: { verbosity: coding ? 'medium' : 'low' },
        input: [{ role: 'user', content: [
          { type: 'input_text', text: input.userText },
          ...(input.imageInputs ?? []).flatMap((image) => [
            { type: 'input_text', text: image.label },
            { type: 'input_image', image_url: image.imageDataUrl, detail: 'high' },
          ]),
        ] }],
      }),
    })
    if (!response.ok) throw new Error(`AI provider request failed with HTTP ${response.status}.`)
    if (!response.body) throw new Error('AI provider returned an empty stream.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (!data || data === '[DONE]') continue
        const event = JSON.parse(data) as { type?: string; delta?: string; response?: { usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } }; error?: { message?: string } }
        if (event.type === 'response.output_text.delta' && event.delta) yield { delta: event.delta }
        if (event.type === 'response.completed') yield { usage: { inputTokens: event.response?.usage?.input_tokens, outputTokens: event.response?.usage?.output_tokens } }
        if (event.type === 'response.failed' || event.type === 'error') throw new Error(event.response?.error?.message ?? event.error?.message ?? 'AI provider failed.')
      }
      if (done) break
    }
  }

  async createRealtimeSecret() {
    const startedAt = Date.now()
    let stage: RealtimeSecretFailureStage = 'require_key'
    let upstreamStatus: number | undefined
    try {
      this.requireKey()
      stage = 'request_setup'
      const headers = new Headers({
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      })
      const signal = AbortSignal.timeout(this.timeoutMs)
      const body = JSON.stringify({ session: { type: 'realtime', model: 'gpt-realtime' } })

      stage = 'upstream_fetch'
      const response = await (this.options.fetcher ?? fetch)('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers,
        signal,
        body,
      })
      upstreamStatus = response.status
      if (!response.ok) throw new Error(`Realtime credential request failed with HTTP ${response.status}.`)

      stage = 'response_parse'
      const parsed: unknown = await response.json()
      stage = 'response_validate'
      if (!isRecord(parsed)) throw new Error('Realtime credential response was invalid.')
      const legacySecret = isRecord(parsed.client_secret) ? parsed.client_secret : undefined
      const value = typeof parsed.value === 'string'
        ? parsed.value
        : typeof legacySecret?.value === 'string'
          ? legacySecret.value
          : undefined
      if (!value) throw new Error('Realtime credential was empty.')
      const expiresAt = typeof parsed.expires_at === 'number'
        ? parsed.expires_at
        : typeof legacySecret?.expires_at === 'number'
          ? legacySecret.expires_at
          : undefined
      return { value, expiresAt }
    } catch (error) {
      this.reportRealtimeDiagnostic({
        stage,
        errorName: safeErrorName(error),
        safeMessage: sanitizeRealtimeDiagnostic(error instanceof Error ? error.message : 'Unknown provider failure.', this.key),
        causeCode: safeCauseCode(error),
        upstreamStatus,
        elapsedMs: Date.now() - startedAt,
      })
      throw error
    }
  }

  async summarize(input: string) {
    this.requireKey()
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({ model: this.models.summary, store: false, input }),
    })
    if (!response.ok) throw new Error(`Summary request failed with HTTP ${response.status}.`)
    const body = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }
    const result = body.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('').trim()
    if (!result) throw new Error('Summary response was empty.')
    return result
  }

  private requireKey() {
    if (!this.key) throw new Error('AI provider is not configured.')
  }

  private reportRealtimeDiagnostic(diagnostic: RealtimeSecretDiagnostic) {
    try {
      this.options.onRealtimeDiagnostic?.(diagnostic)
    } catch {
      // Diagnostics must never replace the original provider failure.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeErrorName(error: unknown) {
  const name = error instanceof Error ? error.name : 'UnknownError'
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(name) ? name : 'UnknownError'
}

function safeCauseCode(error: unknown) {
  if (!(error instanceof Error) || !isRecord(error.cause)) return undefined
  const code = error.cause.code
  return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : undefined
}

function sanitizeRealtimeDiagnostic(message: string, key: string) {
  let sanitized = message
  if (key) sanitized = sanitized.replaceAll(key, '[REDACTED_PROVIDER_KEY]')
  return sanitized
    .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED_PROVIDER_KEY]')
    .replace(/\bek[_-][A-Za-z0-9_-]+\b/g, '[REDACTED_CLIENT_SECRET]')
    .slice(0, 300)
}
