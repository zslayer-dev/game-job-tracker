// 화면에 보여주는 오류 문구는 여기서만 정한다(design.md 7.8). 원본 오류 메시지는 화면에 띄우지 않는다.
export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'LOGIN_FAILED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'APP_LIMIT'
  | 'SAMPLE_NOT_EMPTY'
  | 'INTERNAL'

// VALIDATION은 어느 필드인지(제약 이름에서 알아냄)에 따라 문구를 고른다
export type ValidationField = 'company' | 'position' | 'posting_text' | 'memo'

export type AppError = { code: ErrorCode; field?: ValidationField }

const MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: '다시 로그인해 주세요.',
  LOGIN_FAILED: '로그인에 실패했습니다. 다시 시도해 주세요.',
  NOT_FOUND: '지원 건을 찾을 수 없습니다.',
  VALIDATION: '입력값을 확인해 주세요.',
  APP_LIMIT: '지원 건은 최대 500건까지 저장할 수 있습니다.',
  SAMPLE_NOT_EMPTY: '이미 지원 건이 있어 샘플을 넣을 수 없습니다.',
  INTERNAL: '잠시 후 다시 시도해 주세요.',
}

const VALIDATION_MESSAGES: Record<ValidationField, string> = {
  company: '회사명을 입력해 주세요.',
  position: '포지션을 입력해 주세요.',
  posting_text: '공고 원문은 8,000자 이하로 줄여 주세요.',
  memo: '메모는 5,000자 이하로 줄여 주세요.',
}

export function errorMessage(error: ErrorCode | AppError): string {
  const { code, field } = typeof error === 'string' ? { code: error, field: undefined } : error
  if (code === 'VALIDATION' && field) return VALIDATION_MESSAGES[field]
  return MESSAGES[code]
}

export function logError(context: string, error: unknown): void {
  if (import.meta.env.DEV) console.error(context, error)
}
