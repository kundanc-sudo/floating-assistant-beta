import type { AudioSource } from './realtimeAssistantService'

export interface RequestValidationResult {
  shouldAnswer: boolean
  confidence: number
  reason: string
  classification: 'REQUEST' | 'NON_REQUEST' | 'UNCERTAIN'
}

interface ResponsesApiResult {
  output_text?: string
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>
  }>
}

interface ClassifierOutput {
  classification: 'REQUEST' | 'NON_REQUEST' | 'UNCERTAIN'
  confidence: number
  reason: string
}

const CLASSIFIER_MODEL = 'gpt-4o-mini'
export const REQUEST_CONFIDENCE_THRESHOLD = 0.82
export const SYSTEM_REQUEST_CONFIDENCE_THRESHOLD = 0.9

const REQUEST_SIGNALS = [
  /^(what|why|when|where|who|which|how|can|could|would|should|is|are|do|does|did)\b/,
  /^(explain|describe|define|compare|tell me|show me|give me|help me|summarize|calculate|write|create)\b/,
  /\b(difference between|what does|how do|how can)\b/,
]

const NON_REQUEST_SIGNALS = [
  /^(yeah|okay|right|sure|thanks|thank you|i see|thats good|that is good)$/,
  /\b(i was|we were|then we|went home|yesterday|last night)\b/,
]

export class RequestValidator {
  constructor(private readonly apiKey: string) {}

  async validate(
    text: string,
    source: AudioSource,
    onClassificationStart: () => void,
  ): Promise<RequestValidationResult> {
    const normalized = this.normalize(text)
    const threshold =
      source === 'system'
        ? SYSTEM_REQUEST_CONFIDENCE_THRESHOLD
        : REQUEST_CONFIDENCE_THRESHOLD

    if (NON_REQUEST_SIGNALS.some((signal) => signal.test(normalized))) {
      return this.result(false, 0.96, 'local non-request pattern', 'NON_REQUEST')
    }

    if (REQUEST_SIGNALS.some((signal) => signal.test(normalized))) {
      const confidence = source === 'system' ? 0.93 : 0.97
      return this.result(
        confidence >= threshold,
        confidence,
        'local request pattern',
        'REQUEST',
      )
    }

    onClassificationStart()
    const classification = await this.classify(normalized, source)
    return {
      ...classification,
      shouldAnswer:
        classification.classification === 'REQUEST' &&
        classification.confidence >= threshold,
    }
  }

  private async classify(
    transcript: string,
    source: AudioSource,
  ): Promise<ClassifierOutput> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        store: false,
        max_output_tokens: 80,
        instructions:
          'Classify intent only. Do not answer the transcript. Decide whether it contains a clear request, question, instruction, or information-seeking utterance that a general desktop assistant should answer. Background conversation, acknowledgements, narration, advertisements, lyrics, and incomplete fragments are NON_REQUEST. Use UNCERTAIN when intent is genuinely unclear. System-audio transcripts require especially clear evidence of a request.',
        input: `Audio source: ${source}. Transcript: ${transcript}`,
        text: {
          format: {
            type: 'json_schema',
            name: 'request_intent',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                classification: {
                  type: 'string',
                  enum: ['REQUEST', 'NON_REQUEST', 'UNCERTAIN'],
                },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                reason: { type: 'string' },
              },
              required: ['classification', 'confidence', 'reason'],
              additionalProperties: false,
            },
          },
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Intent classification failed with HTTP ${response.status}.`)
    }

    const payload = (await response.json()) as ResponsesApiResult
    const outputText =
      payload.output_text ??
      payload.output
        ?.flatMap((item) => item.content ?? [])
        .find((content) => content.type === 'output_text')?.text

    if (!outputText) throw new Error('Intent classifier returned no structured output.')

    const parsed = JSON.parse(outputText) as Partial<ClassifierOutput>
    if (
      !['REQUEST', 'NON_REQUEST', 'UNCERTAIN'].includes(
        parsed.classification ?? '',
      ) ||
      typeof parsed.confidence !== 'number' ||
      typeof parsed.reason !== 'string'
    ) {
      throw new Error('Intent classifier returned an invalid result.')
    }

    return parsed as ClassifierOutput
  }

  private normalize(text: string) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private result(
    shouldAnswer: boolean,
    confidence: number,
    reason: string,
    classification: ClassifierOutput['classification'],
  ): RequestValidationResult {
    return { shouldAnswer, confidence, reason, classification }
  }
}
