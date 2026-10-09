export type DisplayAnswerStatus = 'streaming' | 'complete' | 'failed'

export interface DisplayAnswer {
  id: string
  question: string
  answer: string
  createdAt: number
  status: DisplayAnswerStatus
  error?: string
}

export interface AnswerDisplayState {
  current: DisplayAnswer | null
  completed: DisplayAnswer[]
  pinnedId: string | null
  previewId: string | null
  viewCleared: boolean
}

export type AnswerDisplayAction =
  | { type: 'start'; id: string; question: string; delta: string; createdAt: number }
  | { type: 'append'; id: string; delta: string }
  | { type: 'complete'; id: string }
  | { type: 'fail'; id: string; question: string; error: string; createdAt: number }
  | { type: 'pin'; id: string | null }
  | { type: 'preview'; id: string | null }
  | { type: 'clear-view' }

export const MAX_RENDERER_ANSWERS = 20

export function isNearLiveAnswerEdge(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 32,
): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold
}

export const initialAnswerDisplayState: AnswerDisplayState = {
  current: null,
  completed: [],
  pinnedId: null,
  previewId: null,
  viewCleared: false,
}

export function answerDisplayReducer(
  state: AnswerDisplayState,
  action: AnswerDisplayAction,
): AnswerDisplayState {
  switch (action.type) {
    case 'start':
      return {
        ...state,
        current: {
          id: action.id,
          question: action.question,
          answer: action.delta,
          createdAt: action.createdAt,
          status: 'streaming',
        },
        previewId: null,
        viewCleared: false,
      }
    case 'append':
      if (!state.current || state.current.id !== action.id || state.current.status !== 'streaming') {
        return state
      }
      return {
        ...state,
        current: { ...state.current, answer: state.current.answer + action.delta },
      }
    case 'complete': {
      if (!state.current || state.current.id !== action.id) return state
      const completed = { ...state.current, status: 'complete' as const }
      return {
        ...state,
        current: completed,
        completed: [...state.completed.filter((entry) => entry.id !== completed.id), completed]
          .slice(-MAX_RENDERER_ANSWERS),
      }
    }
    case 'fail': {
      const failed: DisplayAnswer = state.current?.id === action.id
        ? { ...state.current, status: 'failed', error: action.error }
        : {
            id: action.id,
            question: action.question,
            answer: '',
            createdAt: action.createdAt,
            status: 'failed',
            error: action.error,
          }
      return { ...state, current: failed, previewId: null, viewCleared: false }
    }
    case 'pin':
      return { ...state, pinnedId: action.id, viewCleared: false }
    case 'preview':
      return { ...state, previewId: action.id, viewCleared: false }
    case 'clear-view':
      return { ...state, current: null, pinnedId: null, previewId: null, viewCleared: true }
    default:
      return state
  }
}
