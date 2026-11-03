# CLAUDE.md

게임업계 구직 트래커. Supabase(Postgres·Auth·Edge Functions) + React(Vite, TypeScript) + Vercel.

## 기준 문서
- **PRD.md가 기준이다.** PRD 범위 밖 기능(Won't 포함)은 만들지 말고 먼저 물어본다. PRD와 설계가 어긋나면 코드를 쓰기 전에 알린다.
- 설계는 [docs/design.md](docs/design.md), 작업 순서는 [docs/plan.md](docs/plan.md)를 따른다.
- 단계가 끝나면 PRD 10장 검증 기록의 해당 번호를 확인한다.

## 작업 방식
- 한 번에 하나만 바꾼다. plan.md의 단계 하나를 진행하고, 끝나면 그 단계의 완료 조건을 확인한 뒤 **멈추고 결과를 보고한다.** 다음 단계는 승인을 받고 시작한다.
- `git reset --hard`, 강제 푸시(`push --force` 등), 이력 변경(rebase, amend, 커밋 삭제)은 승인받기 전엔 하지 않는다.

## 비밀값
- 비밀값은 `.env`에만 두고 `.env*`는 `.gitignore`에 넣는다(`.env.example`만 커밋).
- **service_role 키와 AI 키는 브라우저 코드(`web/`)와 저장소에 절대 넣지 않는다.** 브라우저에는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`만 간다. AI 키는 `supabase secrets`로 Edge Function에만 둔다.

## 보안 규칙 (요약 — 상세는 design.md 7장)
1. **DB 함수**: 모든 함수에 `set search_path = ''`, 표·함수는 `public.applications`처럼 스키마 명시. 실행 권한은 필요한 역할에만. 잠금 후 개수를 세는 함수·트리거는 VOLATILE(기본값) 유지. `anon` 기본 권한은 `alter default privileges`로 회수.
2. **Edge Function**: user_id는 검증된 JWT(`auth.getUser`)에서만 얻고 요청 본문의 user_id는 무시한다. JWT 검증은 반드시 한다. 플랫폼 검증(`verify_jwt`)이 현재 키 방식과 호환되지 않으면 함수 안 검증으로 대신한다(S3 착수 시 공식 문서로 확인).
3. **상한(DB 제약으로도)**: posting_text 8,000자, memo 5,000자, 사용자당 지원 건 500건, 분석 comment 2,000자, matched/missing_skills 각 30개.
4. **렌더링**: 사용자 입력·AI 출력은 텍스트로만. `dangerouslySetInnerHTML`, 정화하지 않은 마크다운·HTML 렌더링 금지. 프롬프트에서 공고 원문은 구분 태그로 감싼 데이터로 넣는다.
5. **CORS**: Edge Function은 배포 주소와 `http://localhost:5173`만 허용. Origin이 있고 목록에 없으면 403, Origin 없는 요청은 CORS 헤더 없이 처리하고 인증은 JWT가 담당.
6. **Redirect URLs**: 와일드카드 없이 정확한 주소만.
7. **보안 헤더**(`web/vercel.json`): X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, 기본 CSP.
8. **오류 노출**: 클라이언트에는 정해진 오류 코드·문구만. 원본 DB·AI 오류는 서버 로그에만, 로그에 JWT·키 금지.
9. **운영 설정**: Anthropic 월 지출 한도, GitHub Secret scanning·Push protection, 운영 Supabase 이메일 공급자 끄기, 배포 전 Security Advisor 0건.

## 테스트
- 권한·동시성·한도 테스트는 로컬 Supabase 스택에서 한다. 이메일 공급자는 로컬 `supabase/config.toml`에서만 켜고 운영은 끈다.
- 배포 주소 검증은 구글 계정 두 개로 한다.
- 운영 DB에 테스트 계정·데이터를 만들지 않는다. **예외는 배포 주소 검증용 구글 계정 2개**이며, 검증이 끝나면 그 계정들의 테스트 데이터(지원 건·프로필·분석 결과)를 정리한다.

## 로컬 실행
<!-- M0 진행 후 채운다: 필요 도구, 설치, supabase start, 환경 변수, 개발 서버, 테스트 실행 명령 -->
(M0 진행 후 작성)
