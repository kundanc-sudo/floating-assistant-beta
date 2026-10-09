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

export class OpenAiProvider implements AiProvider {
  constructor(
    private readonly key: string,
    private readonly models: { fast: string; coding: string; summary: string },
    private readonly timeoutMs = 120_000,
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
    this.requireKey()
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({ session: { type: 'realtime', model: 'gpt-realtime' } }),
    })
    if (!response.ok) throw new Error(`Realtime credential request failed with HTTP ${response.status}.`)
    const body = await response.json() as { value?: string; expires_at?: number; client_secret?: { value?: string; expires_at?: number } }
    const value = body.value ?? body.client_secret?.value
    if (!value) throw new Error('Realtime credential was empty.')
    return { value, expiresAt: body.expires_at ?? body.client_secret?.expires_at }
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
}
