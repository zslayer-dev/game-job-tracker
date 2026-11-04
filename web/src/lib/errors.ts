// 화면에 보여주는 오류 문구는 여기서만 정한다(design.md 7.8). 원본 오류 메시지는 화면에 띄우지 않는다.
export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'LOGIN_FAILED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'APP_LIMIT'
  | 'SAMPLE_NOT_EMPTY'
  | 'POSTING_EMPTY'
  | 'POSTING_TOO_LONG'
  | 'PROFILE_EMPTY'
  | 'AI_USER_LIMIT'
  | 'AI_GLOBAL_LIMIT'
  | 'AI_NOT_ALLOWED'
  | 'USER_NOT_FOUND'
  | 'AI_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_FORMAT'
  | 'INTERNAL'

// VALIDATION은 어느 필드인지(제약 이름에서 알아냄)에 따라 문구를 고른다
export type ValidationField =
  | 'company'
  | 'position'
  | 'posting_text'
  | 'memo'
  | 'summary'
  | 'strengths'
  | 'gaps'
  | 'engines'
  | 'skills'

export type AppError = { code: ErrorCode; field?: ValidationField }

const MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: '다시 로그인해 주세요.',
  FORBIDDEN: '이 작업을 할 권한이 없습니다.',
  LOGIN_FAILED: '로그인에 실패했습니다. 다시 시도해 주세요.',
  NOT_FOUND: '지원 건을 찾을 수 없습니다.',
  VALIDATION: '입력값을 확인해 주세요.',
  APP_LIMIT: '지원 건은 최대 500건까지 저장할 수 있습니다.',
  SAMPLE_NOT_EMPTY: '이미 지원 건이 있어 샘플을 넣을 수 없습니다.',
  // AI 분석 (PRD 8장 문구, design.md 7.8)
  POSTING_EMPTY: '공고 원문을 입력하고 저장한 뒤 분석해 주세요.',
  POSTING_TOO_LONG: '공고 원문은 8,000자 이하로 줄여 주세요.',
  PROFILE_EMPTY: '먼저 경력 프로필을 입력해 주세요.',
  AI_USER_LIMIT: '오늘 분석 횟수를 모두 사용했습니다. 내일 다시 시도해 주세요.',
  AI_GLOBAL_LIMIT: '오늘 서비스 전체 분석 한도가 소진되었습니다.',
  AI_NOT_ALLOWED: 'AI 분석 사용 권한이 없습니다. 관리자에게 문의해 주세요.',
  // 관리자 화면
  USER_NOT_FOUND: '사용자를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.',
  AI_ERROR: '분석에 실패했습니다. 횟수는 차감되지 않았습니다.',
  AI_TIMEOUT: '분석 시간이 초과되었습니다. 횟수는 차감되지 않았습니다.',
  AI_FORMAT: '분석 결과 형식이 올바르지 않아 표시하지 않았습니다.',
  INTERNAL: '잠시 후 다시 시도해 주세요.',
}

const VALIDATION_MESSAGES: Record<ValidationField, string> = {
  company: '회사명을 입력해 주세요.',
  position: '포지션을 입력해 주세요.',
  posting_text: '공고 원문은 8,000자 이하로 줄여 주세요.',
  memo: '메모는 5,000자 이하로 줄여 주세요.',
  summary: '경력 요약은 2,000자 이하로 줄여 주세요.',
  strengths: '강점은 2,000자 이하로 줄여 주세요.',
  gaps: '보완점은 2,000자 이하로 줄여 주세요.',
  engines: '주력 엔진은 30개까지, 각 50자 이하로 입력해 주세요.',
  skills: '기술 스택은 30개까지, 각 50자 이하로 입력해 주세요.',
}

export function errorMessage(error: ErrorCode | AppError): string {
  const { code, field } = typeof error === 'string' ? { code: error, field: undefined } : error
  if (code === 'VALIDATION' && field) return VALIDATION_MESSAGES[field]
  return MESSAGES[code]
}

export function logError(context: string, error: unknown): void {
  if (import.meta.env.DEV) console.error(context, error)
}
