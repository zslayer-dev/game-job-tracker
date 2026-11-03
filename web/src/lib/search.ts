// 회사명 검색어를 PostgreSQL 정규식(~*, PostgREST imatch)에서 글자 그대로 찾도록 이스케이프한다.
// ilike는 PostgREST가 '*'를 와일드카드로 바꾸고 이를 이스케이프할 방법이 없어 쓰지 않는다(design.md 2장).
// 이 파일은 다른 모듈을 가져오지 않는다 — 테스트(tests/m4-search.test.mjs)가 Node에서 직접 불러 쓴다.

export const SEARCH_MAX = 100

// 정규식 메타문자 \ . ^ $ * + ? ( ) [ ] { } | 앞에 \ 를 붙인다. %·_ 는 정규식에서 특별하지 않다.
export function escapeRegex(text: string): string {
  return text.replace(/[\\.^$*+?()[\]{}|]/g, '\\$&')
}

// 화면 입력 → DB에 보낼 패턴. 빈 검색어면 null(필터 없음).
export function companySearchPattern(query: string): string | null {
  const trimmed = query.trim().slice(0, SEARCH_MAX)
  return trimmed === '' ? null : escapeRegex(trimmed)
}
