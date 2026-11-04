# 구현 계획 — 작업 목록

설계 근거는 [design.md](design.md). `#번호`는 PRD 10장 검증 기록 번호. 각 단계는 "완료 조건"을 확인한 뒤 다음으로 넘어간다.

## Must

### M0. 프로젝트 뼈대와 빈 배포
- Vite + React + TS(`web/`), Supabase CLI 초기화(`supabase/`)
- `.gitignore`에 `.env*`(`.env.example` 제외), **`.gitattributes`에 `* text=auto eol=lf`로 줄바꿈 LF 통일**
- GitHub 저장소 생성 → Secret scanning·Push protection 켜기(design 7.9)
- Supabase 프로젝트 생성, Vercel 프로젝트 연결 — **Root Directory를 `web`으로 지정**
- `web/vercel.json`: SPA 재작성 + 보안 헤더(X-Frame-Options, X-Content-Type-Options, Referrer-Policy, 기본 CSP). `connect-src`는 운영 Supabase 주소(`https://yykukwakssqwuwfjrnce.supabase.co`)로 확정
- 완료 조건: 배포 주소에서 빈 화면이 뜨고 응답 헤더에 보안 헤더 4개가 있다. `git ls-files --eol`에서 텍스트 파일이 LF
- 검증: (선행 작업 — 이후 모든 검증이 배포 주소에서 이뤄짐)

### M1. 구글 로그인·로그아웃 + OAuth 프로덕션 게시
- Google OAuth 클라이언트, Supabase Google 공급자, 운영 이메일 공급자 끄기
- Site URL = 배포 주소, **Redirect URLs는 배포 주소와 `http://localhost:5173` 정확한 주소만**(와일드카드 금지)
- 로그인 화면, 로그아웃 버튼, 로그인 여부에 따른 라우팅
- **OAuth 앱을 이 단계에서 바로 "프로덕션"으로 게시** — 막히면 일찍 알아야 시연 영상 대안을 준비할 수 있음
- 완료 조건: 시크릿 창에서 배포 주소 로그인 → 배포 주소로 복귀, 테스트 사용자 아닌 계정도 로그인, 콘솔에 CSP 위반 없음
- 검증: **#9, #10**

### M2. applications 표 + 권한 (마이그레이션)
- 표·이름 붙인 CHECK 제약(회사·포지션 공백, 선택지, 원문 8,000자, **memo 5,000자**)·`updated_at` 트리거·`unique(id, user_id)`·정렬 인덱스
- **500건 상한 트리거** `enforce_application_limit()` (사용자별 advisory lock `'apps:'||user_id`)
- 모든 함수 `set search_path = ''` + `public.` 스키마 명시, 실행 권한 최소화
- RLS 4개 정책, `anon` 권한 회수
- **`authenticated` 권한을 명시적으로 GRANT**: `grant select, insert, update, delete on public.applications to authenticated;` — 운영 프로젝트는 "새 표 자동 노출"이 꺼져 있어 기본 권한이 붙지 않는다(design 3.0). 빠뜨리면 로컬은 되고 운영만 권한 오류가 난다
- RLS도 "자동 RLS"(운영)에 기대지 않고 `enable row level security`를 명시
- 이후 S1·S2 마이그레이션도 같은 규칙: 표·함수마다 `authenticated`(또는 `service_role`) 권한을 명시 GRANT
- 로컬 스택(이메일 공급자는 `config.toml`에서만 켬) 테스트 스크립트: 두 사용자 교차 조회·수정·삭제, 로그아웃 조회·추가, 빈 회사명, memo 5,001자, 500건 후 추가(+ 동시 2건)
- 완료 조건: 교차 요청은 0건·DB 불변, 로그아웃은 권한 오류, 빈 값·초과 값은 제약 오류, 500건 초과는 `APP_LIMIT`. 로컬 `supabase db lint` 경고 없음
- 검증: **#4(DB 쪽), #5, #6, #22(memo·500건 DB 쪽)**, #20 준비

### M3. 지원 건 CRUD 화면
- 목록 표(회사·포지션·상태·지원일·마감일), 추가·상세·편집 화면(모든 필드), 삭제
- 상태 드롭다운: 8개 선택지 자유 변경, 지원 경로 드롭다운
- 화면 쪽 입력 검사: 회사·포지션 필수, 공고 원문 8,000자·메모 5,000자 카운터
- 모든 값은 텍스트 노드로만 렌더링(`dangerouslySetInnerHTML`·마크다운 렌더러 금지), 줄바꿈은 `pre-wrap`
- 오류는 정해진 코드→문구 매핑 한 곳(design 7.8)에서만 표시, 원본 오류 메시지는 화면에 띄우지 않음
- 완료 조건: 배포 주소에서 추가·수정·삭제·상태 앞뒤 변경 후 새로고침·재로그인해도 유지
- 검증: **#1, #2, #4(화면 쪽)**

### M4. 목록 필터·정렬·검색
- 상태 필터, 지원일 최신순 + 빈 값 맨 아래 + 그 안에서 생성 최신순(DB 쿼리)
- 회사명 검색(`imatch` + 정규식 메타문자 이스케이프, design 2장) — *일정이 밀리면 Should로 내림(PRD 5장 주석)*
- 필터·검색어는 URL 쿼리(`?status=&q=`)로 유지, 결과가 없으면 "조건에 맞는 지원 건이 없습니다"
- 완료 조건: 지원일 있는 건 2개 이상 + 빈 건 1개 이상 + 상태 다른 건으로 확인
- 검증: **#3**

### M5. 샘플 데이터 채우기
- DB 함수 `public.seed_sample_data()` (`search_path = ''`, 사용자별 advisory lock `'apps:'||user_id` → 비어 있는지 확인 → 6건 insert), 실행 권한 `authenticated`만
- 가상 회사·공고 원문 작성(지원일 빈 건, 상태 다양하게)
- 빈 상태 화면: 안내 문구 + 추가 버튼 + 샘플 버튼. 지원 건이 있으면 버튼 숨김
- **중복 클릭 방지**: 샘플 버튼과 저장·삭제 버튼은 요청 중 비활성화하고 진행 중 표시
- `tests/seed-concurrency`: 같은 계정으로 동시 10건 요청(로컬 스택)
- 완료 조건: 새 계정 두 개로 각자 채우기 → 서로 안 보임, 재요청 거부 / 동시 요청 시 6건만 / 버튼 연타 시 요청 1건
- 검증: **#7, #8**

### M6. 화면 공통 상태
- 빈·로딩 상태의 세부 표현, 저장 실패·권한 거부 짧은 오류 문구 정리
- 모든 버튼의 처리 중 비활성화 + ref 연속 클릭 방지(로그인·로그아웃 추가), 토큰 만료 시 로그인 화면으로 안내
- 모바일 폭(600px 이하)에서 목록 표를 카드로 표시
- *세부 표현은 일정이 밀리면 Should로 내림(PRD 5장 주석)*
- 검증: (직접 대응하는 번호 없음, PRD 6장 공통 요구)

### M7. Must 검증 및 기록
- 배포 주소에서 구글 계정 두 개로 #1~#10, #22(memo·500건 중 배포에서 가능한 항목) 수행 — 절차: [m7-checklist.md](m7-checklist.md) (브라우저 / PowerShell API 요청 분리, 500건은 로컬 테스트로 갈음)
- 운영 이메일 공급자 꺼짐 재확인, **Security Advisor 경고 0건 확인**
- PRD 10장 "결과" 칸 갱신, README 작성("구글 계정으로 로그인 필요", OAuth 게시 상태)
- 검증: **#1~#10, #20(Must 배포 전), #22(Must 범위)**

---

## Should

### S1. 경력 프로필
- `profiles` 표 + RLS + `anon` 권한 회수 + `public.is_profile_empty()` (`search_path = ''`)
- 프로필 화면(경력 요약, 주력 엔진, 기술 스택, 강점, 보완점)
- `seed_sample_data()` 교체: 프로필이 비어 있으면 가상 프로필도 채움
- 완료 조건: 저장·새로고침 유지, 다른 계정에서 안 보임, 빈 계정 샘플 채우기 시 프로필도 생성
- 검증: (#11의 선행 조건. 프로필 격리는 #5와 같은 방식으로 추가 확인)
- 진행(2026-11-04, 로컬): 마이그레이션 `20261104090000_profiles.sql`, 화면 `/profile`, `tests/s1-profiles.test.mjs`(34개), E2E에 프로필 저장·격리·샘플 프로필 추가. `is_profile_empty()`는 설계를 바꿔 인자 없음 + `authenticated` 실행(design.md 2장). 운영 반영 전

### S2. AI 관련 표와 한도 함수 (마이그레이션)
- `ai_analyses`(복합 FK, 연쇄 삭제, **comment 2,000자·기술 목록 각 30개 CHECK**), `ai_usage`(결과·사유 CHECK)
- RLS: ai_analyses 본인만 / ai_usage 본인 조회만, 쓰기 권한 회수
- `counts_for_user()`, `begin_ai_call()`, `finish_ai_call()`(service_role만), `my_ai_remaining()` — 모두 `search_path = ''` + 스키마 명시
- SQL 수준 테스트(로컬): 낮은 한도로 동시 `begin_ai_call` 호출, 2분 지난 진행 중 행, 사유별 집계, 상한 초과 insert
- 검증: **#17, #22(분석 결과 DB 쪽)**, #12·#13·#14·#15·#16의 DB 쪽
- 진행(2026-11-04, 로컬): 마이그레이션 `20261104120000_ai_quota.sql`, `tests/s2-ai-quota.test.mjs`(39개). 한도 기본값을 DB(`ai_daily_limits()`)로 옮기고 `my_ai_remaining()`은 SECURITY DEFINER + auth.uid() 기준(design.md 4.2). 운영 반영 후 Security Advisor가 my_ai_remaining(DEFINER)을 잡아 `20261104150000_my_ai_remaining_invoker.sql`로 INVOKER 전환(design.md 3.1)

### S3. Edge Function `analyze-posting`
- 착수 전: Anthropic 콘솔 월 지출 한도 설정(design 7.9)
- **착수 시 Supabase 공식 문서로 확인**: 플랫폼 JWT 검증(`verify_jwt`)이 프로젝트의 현재 키 방식과 호환되는지. 호환되면 `verify_jwt = true` 유지, 아니면 끄고 함수 안 검증으로 대신(design 7.2). 결정을 design 7.2에 기록
- JWT 검증은 어느 방식이든 반드시 수행, user_id는 `auth.getUser(JWT)` 값만 사용, 본문은 `application_id`만 읽음
- CORS 허용 목록(`ALLOWED_ORIGINS`: 운영 secrets = `https://game-job-tracker.vercel.app`만, 로컬 `supabase/functions/.env` = `http://localhost:5173`): Origin이 있고 목록에 없으면 403, Origin 없으면 CORS 헤더 없이 JWT 검증으로 판단
- JWT 검증 → 지원 건(RLS) → 원문 길이 → 프로필 비어 있음 → `begin_ai_call` → AI 호출(60초) → 형식 검증(DB와 같은 상한) → `finish_ai_call`
- 프롬프트: 공고 원문·프로필을 구분 태그로 감싸 데이터로 전달, 구조화 출력(design 7.4)
- 응답은 `{ error: 코드 }`만, 원본 오류는 서버 로그에만(JWT·키·원문은 로그 금지)
- AI 키·허용 출처는 `supabase secrets`(한도는 넣지 않음, DB 기본값), `AI_MOCK`·한도 덮어쓰기는 로컬만
- 착수 시 Claude API 모델 ID·구조화 출력 방식을 공식 문서로 확인
- 검증: **#12, #15, #18, #19, #21**(서버 쪽)
- 진행(2026-11-04, 로컬): `supabase/functions/analyze-posting/`(index.ts, cors.ts, analysis.ts), `tests/s3-analyze-posting.test.mjs`(32개, AI_MOCK 모드별로 함수 서버를 다시 띄움). verify_jwt 끔 + 함수 안 `auth.getUser`, 모델 `claude-haiku-5-5` + 구조화 출력(design.md 7.2). 운영 배포·키 설정 전

### S4. AI 분석 화면
- 상세 화면에 분석 버튼, 진행 중 표시(중복 클릭 방지), 결과(적합도·매칭·부족·코멘트), 저장 버튼, 최신 저장 결과 표시
- **저장되지 않은 공고 원문 변경이 있으면 분석 버튼 비활성화** + "공고 원문을 먼저 저장해 주세요" 안내
- AI 결과는 텍스트 노드로만 렌더링
- 오늘 남은 횟수(`my_ai_remaining()`), 오류 코드별 문구(사용자 한도 / 전체 한도 / 프로필 없음 / AI 실패 / 형식 오류)
- 완료 조건: 데모 공고로 분석 → 저장 → 새로고침 후 남음 / 원문 수정 후 버튼 비활성, 저장 후 활성
- 검증: **#11, #23**, #12(문구 구분)
- 진행(2026-11-04, 로컬): `web/src/components/AnalysisPanel.tsx`, `web/src/lib/analysis.ts`, 상세 화면에 연결(공고 원문 칸 변경을 폼에서 받아 저장 전이면 분석 버튼 비활성). E2E `tests/e2e/analysis.spec.mjs`(분석 → 저장 → 새로고침 유지, #23, 오류 문구, 텍스트 렌더링) — 함수 서버는 `tests/e2e/global-setup.mjs`가 AI_MOCK=ok로 띄움. 배포 주소에서 실제 AI 첫 호출 전

### S5. Should 검증 및 기록
- 로컬 스택: 한도 낮춘 설정 + `AI_MOCK`으로 동시 요청 테스트 — 같은 사용자(#13), 다른 사용자(#14), 사유별 실패(#15), 멈춘 진행 중 기록(#16), 깨진 응답(#19), 본문 user_id 조작(#21), 상한 초과(#22)
- 배포 주소(구글 계정 두 개): #11, #12 문구, #17, #21, #22, #23
- 저장소 `git grep` + 배포 번들 검색(#18)
- 운영 이메일 공급자 꺼짐 재확인, **Security Advisor 경고 0건 재확인**(#20)
- 운영 DB 롤백 검사(`tests/prod/cross-check.mjs`, `npm run test:prod`)에 Should 표 교차 검증 추가 — 지금은 applications만 본다(2026-11-04 운영 첫 실행 18개 통과)
  - profiles·ai_analyses·ai_usage: B가 A의 행을 조회·수정·삭제하면 0건, A 소유로 추가 거부(ai_usage는 사용자 쓰기 자체가 권한 오류), 소유자 변경 거부, anon 조회·추가 권한 오류
  - 권한 점검: 세 표의 GRANT(ai_usage는 select만, service_role 표 권한 없음)·RLS·정책, 함수 실행 권한(begin/finish는 service_role만, authenticated가 실행하는 DEFINER 함수 없음)
  - 실행은 사용자가 한다(트랜잭션 + ROLLBACK, m7-checklist.md 6-2)
- 진행(2026-11-04): 체크리스트 `docs/s5-checklist.md`(배포 주소 확인 / 로컬 테스트로 대신 구분), `tests/prod/cross-check.mjs`에 Should 표 교차 검증·권한 점검 추가(로컬 47개, 운영 예상 48개), README Should "구현 완료" + `docs/images/analysis.png`. 운영 CORS 403·배포 번들 키 검색은 체크리스트 명령으로 사전 확인. 배포 주소 검증 결과 대기
- PRD 10장 결과 갱신, README 보완
- 검증: **#11~#23 전체** (우선순위상 #19가 최하위 — 시간이 없으면 마지막에 남김)

---

## 검증 번호 → 단계 역참조

| # | 내용(요약) | 구현 단계 | 확인 단계 |
|---|---|---|---|
| 1 | 추가 후 유지 | M3 | M7 |
| 2 | 상태 변경 유지 | M3 | M7 |
| 3 | 필터·검색·정렬 | M4 | M7 |
| 4 | 회사·포지션 필수 | M2, M3 | M7 |
| 5 | 다른 계정 데이터 거부 | M2 | M2(로컬), M7(배포) |
| 6 | 로그아웃 요청 거부 | M2 | M2, M7 |
| 7 | 샘플 채우기·격리·재요청 거부 | M5 | M7 |
| 8 | 샘플 동시 요청 한 세트 | M5 | M5, M7 |
| 9 | 배포 주소로 로그인 복귀 | M1 | M1, M7 |
| 10 | 테스트 사용자 외 로그인 | M1 | M1, M7 |
| 11 | AI 분석 표시·저장 | S1, S3, S4 | S5 |
| 12 | 하루 한도·문구 구분 | S2, S3, S4 | S5 |
| 13 | 같은 사용자 동시 1건 | S2 | S2, S5 |
| 14 | 다른 사용자 동시 1건 | S2 | S2, S5 |
| 15 | 실패 사유별 집계 | S2, S3 | S5 |
| 16 | 2분 지난 진행 중 | S2 | S2, S5 |
| 17 | ai_usage 권한 | S2 | S2, S5 |
| 18 | 비밀 키 노출 없음 | S3 | S5 |
| 19 | 깨진 AI 응답 | S3 | S5 |
| 20 | Security Advisor 0건 | M2, S1, S2 (함수 search_path·RLS) | M7, S5 |
| 21 | 본문 user_id 무시 | S3 | S5 |
| 22 | 길이·개수 상한 | M2, M3 (memo·500건), S2, S3 (분석 결과) | M2, M7, S2, S5 |
| 23 | 저장 안 된 원문이면 분석 버튼 비활성 | S4 | S4, S5 |
