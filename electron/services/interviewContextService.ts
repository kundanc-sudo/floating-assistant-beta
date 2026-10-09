export type InterviewContextField = 'instructions' | 'resume' | 'jobDescription'

export interface InterviewContext {
  instructions: string
  resumeText: string
  jobDescriptionText: string
}

export interface InterviewContextStatus {
  resumeLoaded: boolean
  resumeChars: number
  jobDescriptionLoaded: boolean
  jobDescriptionChars: number
  instructionsLoaded: boolean
  instructionsChars: number
  ready: boolean
}

export interface InterviewUserMessageInput {
  sessionSummary: string
  relevantConversation: string
  previousInteractions: string
  currentQuestion: string
}

export const MAX_INTERVIEW_CONTEXT_FIELD_CHARACTERS = 60_000

export class InterviewContextService {
  private context: InterviewContext = {
    instructions: '',
    resumeText: '',
    jobDescriptionText: '',
  }

  constructor(private readonly log: (message: string) => void = () => undefined) {}

  setField(field: InterviewContextField, value: string): InterviewContextStatus {
    const text = value.trim()
    if (!text) throw new Error('Context text cannot be empty.')
    if (text.length > MAX_INTERVIEW_CONTEXT_FIELD_CHARACTERS) {
      throw new Error(`Context text exceeds the ${MAX_INTERVIEW_CONTEXT_FIELD_CHARACTERS.toLocaleString()} character limit.`)
    }
    if (field === 'instructions') this.context.instructions = text
    if (field === 'resume') this.context.resumeText = text
    if (field === 'jobDescription') this.context.jobDescriptionText = text
    const status = this.getStatus()
    this.log(formatInterviewContextMetadata(status))
    return status
  }

  getSnapshot(): InterviewContext {
    return { ...this.context }
  }

  load(context: InterviewContext): InterviewContextStatus {
    const next = { instructions: '', resumeText: '', jobDescriptionText: '' }
    const assign = (field: InterviewContextField, value: string) => {
      const text = value.trim()
      if (text.length > MAX_INTERVIEW_CONTEXT_FIELD_CHARACTERS) {
        throw new Error(`Context text exceeds the ${MAX_INTERVIEW_CONTEXT_FIELD_CHARACTERS.toLocaleString()} character limit.`)
      }
      if (field === 'instructions') next.instructions = text
      if (field === 'resume') next.resumeText = text
      if (field === 'jobDescription') next.jobDescriptionText = text
    }
    assign('instructions', context.instructions)
    assign('resume', context.resumeText)
    assign('jobDescription', context.jobDescriptionText)
    this.context = next
    const status = this.getStatus()
    this.log(formatInterviewContextMetadata(status))
    return status
  }

  getStatus(): InterviewContextStatus {
    const resumeChars = this.context.resumeText.length
    const jobDescriptionChars = this.context.jobDescriptionText.length
    const instructionsChars = this.context.instructions.length
    return {
      resumeLoaded: resumeChars > 0,
      resumeChars,
      jobDescriptionLoaded: jobDescriptionChars > 0,
      jobDescriptionChars,
      instructionsLoaded: instructionsChars > 0,
      instructionsChars,
      ready: resumeChars > 0 || jobDescriptionChars > 0 || instructionsChars > 0,
    }
  }

  reset(): InterviewContextStatus {
    this.context = { instructions: '', resumeText: '', jobDescriptionText: '' }
    const status = this.getStatus()
    this.log(formatInterviewContextMetadata(status))
    return status
  }
}

export function buildInterviewSystemInstructions(
  baseInstructions: string,
  context: InterviewContext,
): string {
  if (!context.instructions && !context.resumeText && !context.jobDescriptionText) {
    return baseInstructions
  }
  return `${baseInstructions}

INTERVIEW MODE:
Answer as the candidate, not as an AI assistant. Never identify yourself as ChatGPT, an AI assistant, or a helper. Follow the configured interview instructions. Ground claims about the candidate's background, projects, responsibilities, and technologies in the resume. The job description may guide relevance and emphasis, but it must never be used to invent experience missing from the resume. Maintain consistency with the supplied previous interview Q&A. The newest interviewer question is the request to answer.

Priority:
1. CONFIGURED INTERVIEW INSTRUCTIONS
2. CANDIDATE RESUME grounding
3. JOB DESCRIPTION relevance
4. Relevant previous interview Q&A
5. Current interviewer question

CONFIGURED INTERVIEW INSTRUCTIONS:
${context.instructions || '(none)'}

CANDIDATE RESUME:
${context.resumeText || '(none)'}

JOB DESCRIPTION:
${context.jobDescriptionText || '(none)'}`
}

export function buildInterviewUserMessage(input: InterviewUserMessageInput): string {
  return `RELEVANT INTERVIEW MEMORY:
Session summary: ${input.sessionSummary || '(none)'}

Recent conversation:
${input.relevantConversation || '(none)'}

Previous completed interview Q&A:
${input.previousInteractions || '(none)'}

CURRENT INTERVIEWER QUESTION OR USER REQUEST:
${input.currentQuestion}`
}

function formatInterviewContextMetadata(status: InterviewContextStatus): string {
  return `[INTERVIEW_CONTEXT] resumeLoaded=${status.resumeLoaded} resumeChars=${status.resumeChars} ` +
    `jdLoaded=${status.jobDescriptionLoaded} jdChars=${status.jobDescriptionChars} ` +
    `instructionsLoaded=${status.instructionsLoaded} instructionsChars=${status.instructionsChars}`
}
