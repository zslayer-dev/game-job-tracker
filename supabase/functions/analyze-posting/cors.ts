// CORS (design.md 7.5). 브라우저용 보호일 뿐 인증이 아니다 — 인증은 JWT가 맡는다.
//   Origin 있음 + 허용 목록에 있음 → 그 값을 Access-Control-Allow-Origin에 넣어 처리
//   Origin 있음 + 허용 목록에 없음 → CORS 헤더 없이 403 (본문 처리·DB 호출 없음)
//   Origin 없음(curl, 서버 간 호출) → CORS 헤더 없이 처리
// 정확히 일치 비교, 와일드카드 없음.

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export type CorsDecision = { allowed: true; headers: Record<string, string> } | { allowed: false; headers: Record<string, string> }

export function corsFor(origin: string | null, allowList: string[]): CorsDecision {
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin === null) return { allowed: true, headers }
  if (!allowList.includes(origin)) return { allowed: false, headers }
  return { allowed: true, headers: { ...headers, 'Access-Control-Allow-Origin': origin } }
}

export const PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Max-Age': '600',
}
