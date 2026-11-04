// API가 "로그인이 필요함(AUTH_REQUIRED)"을 돌려줬을 때 AuthProvider에 알린다.
// lib의 데이터 함수는 React 밖이라 직접 세션을 정리할 수 없어서 이벤트로 넘긴다.
export const authEvents = new EventTarget()

export const AUTH_REQUIRED_EVENT = 'auth-required'

export function reportAuthRequired(): void {
  authEvents.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
}
