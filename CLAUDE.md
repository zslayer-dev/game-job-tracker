# CLAUDE.md

게임업계 구직 트래커. Supabase(Postgres·Auth·Edge Functions) + React(Vite, TypeScript) + Vercel.

## 기준 문서
- **PRD.md가 기준이다.** PRD 범위 밖 기능(Won't 포함)은 만들지 말고 먼저 물어본다. PRD와 설계가 어긋나면 코드를 쓰기 전에 알린다.
- 설계는 [docs/design.md](docs/design.md), 작업 순서는 [docs/plan.md](docs/plan.md)를 따른다.
- 단계가 끝나면 PRD 10장 검증 기록의 해당 번호를 확인한다.

## 작업 방식
- 한 번에 하나만 바꾼다. plan.md의 단계 하나를 진행하고, 끝나면 그 단계의 완료 조건을 확인한 뒤 **멈추고 결과를 보고한다.** 다음 단계는 승인을 받고 시작한다.
- **사용자에게 실행을 안내하는 명령은 PowerShell(Windows) 기준으로 쓴다.** `cp`·`rm`·`export` 대신 `Copy-Item`·`Remove-Item`·`$env:NAME = "값"`, 경로 구분자는 `\`, 명령 연결은 `;`(PowerShell 5.1은 `&&` 불가).
- `git reset --hard`, 강제 푸시(`push --force` 등), 이력 변경(rebase, amend, 커밋 삭제)은 승인받기 전엔 하지 않는다.

## 비밀값
- 비밀값은 `.env`에만 두고 `.env*`는 `.gitignore`에 넣는다(`.env.example`만 커밋).
- **service_role 키와 AI 키는 브라우저 코드(`web/`)와 저장소에 절대 넣지 않는다.** 브라우저에는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`만 간다. AI 키는 `supabase secrets`로 Edge Function에만 둔다.

## 보안 규칙 (요약 — 상세는 design.md 7장)
1. **DB 함수**: 모든 함수에 `set search_path = ''`, 표·함수는 `public.applications`처럼 스키마 명시. 실행 권한은 필요한 역할에만. 잠금 후 개수를 세는 함수·트리거는 VOLATILE(기본값) 유지. `anon` 기본 권한은 `alter default privileges`로 회수.
2. **Edge Function**: user_id는 검증된 JWT(`auth.getUser`)에서만 얻고 요청 본문의 user_id는 무시한다. JWT 검증은 반드시 한다. 플랫폼 검증(`verify_jwt`)이 현재 키 방식과 호환되지 않으면 함수 안 검증으로 대신한다(S3 착수 시 공식 문서로 확인).
3. **상한(DB 제약으로도)**: posting_text 8,000자, memo 5,000자, 사용자당 지원 건 500건, 분석 comment 2,000자, matched/missing_skills 각 30개.
4. **렌더링**: 사용자 입력·AI 출력은 텍스트로만. `dangerouslySetInnerHTML`, 정화하지 않은 마크다운·HTML 렌더링 금지. 프롬프트에서 공고 원문은 구분 태그로 감싼 데이터로 넣는다.
5. **CORS**: Edge Function 허용 목록은 운영 = `https://game-job-tracker.vercel.app`만, 로컬(`supabase/functions/.env`) = `http://localhost:5173`. 운영에 localhost를 넣지 않는다. Origin이 있고 목록에 없으면 403, Origin 없는 요청은 CORS 헤더 없이 처리하고 인증은 JWT가 담당.
6. **Redirect URLs**: 와일드카드 없이 정확한 주소만.
7. **보안 헤더**(`web/vercel.json`): X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, 기본 CSP.
8. **오류 노출**: 클라이언트에는 정해진 오류 코드·문구만. 원본 DB·AI 오류는 서버 로그에만, 로그에 JWT·키 금지.
9. **운영 설정**: Anthropic 월 지출 한도, GitHub Secret scanning·Push protection, 운영 Supabase 이메일 공급자 끄기, 배포 전 Security Advisor 0건.

## 테스트
- 권한·동시성·한도 테스트는 로컬 Supabase 스택에서 한다. 이메일 공급자는 로컬 `supabase/config.toml`에서만 켜고 운영은 끈다.
- 배포 주소 검증은 구글 계정 두 개로 한다.
- 운영 DB에 테스트 계정·데이터를 만들지 않는다. **예외는 배포 주소 검증용 구글 계정 2개**이며, 검증이 끝나면 그 계정들의 테스트 데이터(지원 건·프로필·분석 결과)를 정리한다.

## 로컬 실행
필요 도구: Node.js 24 이상, Docker Desktop(실행 중이어야 함). Supabase CLI는 루트 `package.json`에 버전을 고정해 두었으므로 전역 설치 없이 `npx supabase`로 쓴다.

```powershell
# 1. 의존성 설치 (루트: Supabase CLI, web: 앱)
npm install
npm install --prefix web

# 2. 로컬 Supabase 스택 시작 (처음엔 Docker 이미지를 받느라 오래 걸림)
npx supabase start          # 또는 npm run db:start

# 3. 환경 변수: 예시 파일을 복사하고 키를 채운다
Copy-Item web\.env.example web\.env.local
npx supabase status -o env  # API_URL, PUBLISHABLE_KEY 값을 web\.env.local에 넣는다
Copy-Item supabase\.env.example supabase\.env   # 구글 로그인: Google 클라이언트 ID·secret을 직접 채운다
npx supabase stop; npx supabase start            # supabase\.env를 바꾼 뒤에는 재시작해야 반영된다
Copy-Item supabase\functions\.env.example supabase\functions\.env   # Edge Function 작업(S3)부터

# 4. 개발 서버 → http://localhost:5173 (포트 고정, 사용 중이면 실패)
npm run dev --prefix web
```

- 로컬 주소: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, 메일 확인(Mailpit) `http://127.0.0.1:54324`
- 중지: `npx supabase stop` (데이터 유지). DB를 마이그레이션부터 다시 만들기: `npx supabase db reset`
- 빌드·린트 확인: `npm run build --prefix web`, `npm run lint --prefix web`
- 포트 5173은 Supabase Redirect URLs·Edge Function CORS에 정확히 등록된 주소라 바꾸지 않는다(`web/vite.config.ts`의 `strictPort`).
- 로컬 Auth 설정(`supabase/config.toml`): `site_url`·`additional_redirect_urls` = `http://localhost:5173`, 이메일 공급자 켬(로컬 테스트 전용), 구글 공급자 켬(`supabase\.env`의 값 사용).
- 로컬에서는 브라우저를 반드시 `http://localhost:5173`으로 연다. `127.0.0.1:5173`은 Redirect 허용 목록에 없어 로그인 후 돌아오지 못한다.
