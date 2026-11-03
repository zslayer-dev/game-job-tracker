// 화면에 보여주는 오류 문구는 여기서만 정한다(design.md 7.8). 원본 오류 메시지는 화면에 띄우지 않는다.
export type ErrorCode = 'AUTH_REQUIRED' | 'LOGIN_FAILED' | 'INTERNAL'

const MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: '다시 로그인해 주세요.',
  LOGIN_FAILED: '로그인에 실패했습니다. 다시 시도해 주세요.',
  INTERNAL: '잠시 후 다시 시도해 주세요.',
}

export function errorMessage(code: ErrorCode): string {
  return MESSAGES[code]
}

export function logError(context: string, error: unknown): void {
  if (import.meta.env.DEV) console.error(context, error)
}
