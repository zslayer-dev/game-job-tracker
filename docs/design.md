# 설계 문서 — 게임업계 구직 트래커

PRD.md를 구현하기 위한 기술 결정과 데이터·권한·원자적 처리 설계. 작업 순서는 [plan.md](plan.md)에 있다.

> 무료 한도·요금 조건은 작성 시점(2026-11) 기준 기억에 의존한 내용이다. 착수 전에 각 서비스 요금 페이지에서 다시 확인한다.

---

## 1. 기술 스택 결정

### 1.1 판단 기준 (PRD에서 나온 조건)

| 조건 | PRD 근거 |
|---|---|
| C1. 무료로 시작해 배포까지 | 개인 비용 운영 |
| C2. 구글 로그인 | 5장 Must 1, Won't 6 (이메일 로그인 없음) |
| C3. 본인 데이터만 — **화면이 아니라 서버·DB에서 거부** | 8장 권한, 검증 #5 #6 #17 |
| C4. 원자적 처리 — 샘플 채우기, AI 한도 판정+기록 | 8장, 검증 #8 #13 #14 |
| C5. AI 비밀 키는 서버에만 | 8장, 검증 #18 |
| C6. 정렬: 지원일 최신순 + 빈 값 맨 아래 | 8장 목록 정렬, 검증 #3 |

### 1.2 후보 비교

| | **A. Supabase + React(Vite) + Vercel** | B. Firebase (Auth + Firestore + Functions) | C. Next.js + Neon(Postgres) + Auth.js, Vercel |
|---|---|---|---|
| C1 무료 배포 | ✅ Supabase Free + Vercel Hobby. 카드 등록 불필요 | ⚠️ Auth·Firestore·Hosting은 무료(Spark)지만 **Cloud Functions는 Blaze(종량제, 결제 카드 등록) 필요** | ✅ Neon Free + Vercel Hobby |
| C2 구글 로그인 | ✅ Supabase Auth Google 공급자, 설정만 | ✅ Firebase Auth | ✅ Auth.js Google 공급자. 세션·사용자 테이블은 직접 구성 |
| C3 DB 수준 권한 | ✅ **Postgres RLS**가 로그인 토큰(`auth.uid()`)과 바로 연결됨 | ✅ Security Rules (문서 단위) | ⚠️ DB가 사용자를 모름. 권한은 앱 서버 코드의 `where user_id = ?`에 의존 → 한 곳만 빠져도 노출 |
| C4 원자적 처리 | ✅ Postgres 함수(RPC) 하나 = 트랜잭션 하나. advisory lock으로 직렬화 | ⚠️ 트랜잭션은 있으나 "내 지원 건이 0개인지" 같은 **쿼리 결과를 클라이언트 트랜잭션에서 잠글 수 없음** → 카운터 문서를 따로 관리해야 함 | ✅ Postgres 트랜잭션. 단 코드로 직접 관리 |
| C5 비밀 키 | ✅ Edge Function + `supabase secrets` | ✅ Functions 환경 변수 (단 Blaze 필요) | ✅ 서버 라우트 환경 변수 |
| C6 빈 값 맨 아래 정렬 | ✅ `order by applied_at desc nulls last` | ❌ Firestore `orderBy`는 **그 필드가 없는 문서를 결과에서 아예 뺌** → 별도 정렬 키 필드나 쿼리 두 번 필요 | ✅ SQL 동일 |
| 작업량 | 적음 (인증·API·권한이 기본 제공) | 중간 | 많음 (인증 테이블, API 라우트, 권한 검사를 전부 작성) |

### 1.3 결정: **A. Supabase + React(Vite, TypeScript) + Vercel**

**고른 이유**
1. PRD의 권한 규칙 "화면이 아니라 서버·DB에서 거부"를 **RLS 정책 한 줄씩으로 표에 직접** 걸 수 있다. 앱 코드에 실수가 있어도 DB가 막는다. 검증 #5·#6·#17을 DB 쿼리로 바로 확인할 수 있다.
2. 원자적 처리 두 개(샘플 채우기, AI 한도 판정+진행 중 기록)를 각각 **Postgres 함수 하나**로 만들면 트랜잭션 경계가 명확하다. 클라이언트는 `rpc()` 한 번만 부른다.
3. AI 키는 Edge Function 비밀 값으로만 존재하고, 브라우저에는 공개용 `anon` 키만 간다(anon 키는 RLS가 있으므로 공개돼도 됨).
4. 카드 없이 무료로 시작하고 배포까지 된다.
5. PRD의 데이터 구조가 이미 관계형(외래키, 연쇄 삭제, 선택지 제약, 길이 제약)이라 SQL 제약으로 그대로 옮겨진다.

**버린 이유**
- **B. Firebase**: AI 키를 서버에 두려면 Cloud Functions가 필요한데 Blaze 요금제(카드 등록)를 요구해 C1에 어긋난다. 또 Firestore는 필드가 없는 문서를 `orderBy` 결과에서 빼서 "지원일 빈 건은 맨 아래" 정렬(C6)에 우회가 필요하고, "지원 건 0개 확인 + 샘플 넣기"를 원자적으로 하려면 사용자별 카운터 문서를 별도로 유지해야 한다.
- **C. Next.js + Neon + Auth.js**: 조건은 다 충족할 수 있지만 DB가 로그인 사용자를 모르므로 권한이 전부 앱 서버 코드에 달려 있다. 인증 테이블·API 라우트·권한 검사를 직접 짜야 해서 작업량이 가장 많고, 한 곳을 빠뜨리면 다른 사람 데이터가 노출된다. 1인 단기 프로젝트에서 이득보다 위험이 크다.

**A의 알려진 제약과 대응**
- Supabase Free 프로젝트는 일정 기간(약 1주) 활동이 없으면 일시 정지된다 → 제출·심사 기간 직전에 접속해 깨워 두고, README에 적는다.
- RLS로 거부된 조회·수정·삭제는 오류가 아니라 **"0건"으로 응답**한다(HTTP 200). 검증 #5의 "거부"는 "응답 0건 + DB 변경 없음"으로 판정한다. 로그아웃 상태(#6)는 `anon` 역할의 테이블 권한을 회수해 **권한 오류(401/42501)**로 명확히 거부되게 한다(3장).
- AI 제공자 비용은 무료가 아니다 → PRD의 하루 100회 전체 한도가 비용 상한 역할.

### 1.4 구성

```
브라우저 (React SPA, Vercel)
 ├─ supabase-js (anon 키 + 사용자 JWT) ──► PostgREST ──► Postgres (RLS)
 │                                         └─ rpc: seed_sample_data()
 └─ fetch /functions/v1/analyze-posting ──► Edge Function (Deno)
                                              ├─ 사용자 JWT로 검증·조회 (RLS 적용)
                                              ├─ service_role로 rpc: begin_ai_call / finish_ai_call
                                              └─ AI API (비밀 키는 여기만)
```

- 프런트: React + Vite + TypeScript, react-router. 상태 관리는 React 기본 기능으로 시작.
- 백엔드: Supabase (Postgres, Auth, Edge Functions). 스키마는 `supabase/migrations/*.sql`로 저장소에 둔다.
- 배포: Vercel (SPA 경로 재작성 설정 `vercel.json`).
- AI: Claude API(빠르고 저렴한 소형 모델). 모델 ID·구조화 출력 방식은 S3 단계 착수 시 공식 문서로 확인.
- 개발·테스트: Supabase CLI 로컬 스택(Docker). Docker를 쓸 수 없으면 두 번째 무료 프로젝트를 스테이징으로 쓴다.

### 1.5 저장소 구조 (예정)

```
web/                         React 앱
supabase/migrations/         스키마·RLS·함수 SQL
supabase/functions/analyze-posting/   AI 분석 Edge Function
supabase/seed.sql            (로컬 전용) 테스트 사용자
tests/                       동시 요청·권한 검증 스크립트 (Node + supabase-js)
docs/                        설계·계획
```

---

## 2. 표 구조

공통: 모든 `user_id`는 `auth.users(id)` 참조, 기본값 `auth.uid()`. 선택지는 Postgres enum 대신 `text + CHECK`로 둔다(선택지 변경이 마이그레이션 한 줄로 끝남). 화면 표시 문자열과 DB 값은 같게(한글) 해서 변환 계층을 두지 않는다.

### applications
| 컬럼 | 타입 / 제약 |
|---|---|
| id | `uuid pk default gen_random_uuid()` |
| user_id | `uuid not null default auth.uid() references auth.users on delete cascade` |
| company | `text not null check (length(btrim(company)) > 0)` |
| position | `text not null check (length(btrim(position)) > 0)` |
| channel | `text null check (channel in ('게임잡','원티드','잡코리아','리멤버','헤드헌터','직접 지원','기타'))` |
| status | `text not null default '관심' check (status in ('관심','지원 완료','서류 통과','과제·코테','면접','최종 합격','불합격','포기'))` |
| applied_at, deadline | `date null` |
| posting_text | `text null check (char_length(posting_text) <= 8000)` |
| memo | `text null` |
| created_at, updated_at | `timestamptz not null default now()`, `updated_at`은 트리거로 갱신 |

- `unique (id, user_id)` — ai_analyses의 복합 외래키 대상.
- 인덱스: `(user_id, applied_at desc nulls last, created_at desc)` — 목록 정렬과 일치.
- 상태 전환 순서 제약 없음(PRD). 트리거로 막지 않는다.
- 정렬은 쿼리에서 `order('applied_at', {ascending:false, nullsFirst:false}).order('created_at', {ascending:false})`.
- 회사명 검색은 `ilike '%검색어%'` (데이터가 적어 인덱스 불필요). 필터·검색·정렬 모두 DB 쿼리로 처리.

### profiles (Should)
| 컬럼 | 타입 / 제약 |
|---|---|
| user_id | `uuid pk default auth.uid() references auth.users on delete cascade` — 사용자당 1개 |
| summary, strengths, gaps | `text null` |
| engines, skills | `text[] not null default '{}'` |
| updated_at | `timestamptz not null default now()` + 트리거 |

- "프로필이 비어 있음" 정의를 SQL 함수 하나로 고정: `is_profile_empty(p)` = 행이 없거나, 모든 텍스트가 공백이고 두 배열이 비어 있음. Edge Function과 샘플 채우기가 같은 정의를 쓴다.

### ai_analyses (Should)
| 컬럼 | 타입 / 제약 |
|---|---|
| id | `uuid pk` |
| application_id, user_id | `foreign key (application_id, user_id) references applications(id, user_id) on delete cascade` |
| fit_score | `int not null check (fit_score between 0 and 100)` |
| matched_skills, missing_skills | `text[] not null` |
| comment | `text not null check (length(btrim(comment)) > 0)` |
| created_at | `timestamptz not null default now()` |

- 복합 외래키로 "남의 지원 건에 내 분석을 붙이는" 경우를 DB가 막는다.
- 지원 건 삭제 시 연쇄 삭제(PRD 7장). 화면은 `created_at desc limit 1`로 최신 1건만.

### ai_usage (Should)
| 컬럼 | 타입 / 제약 |
|---|---|
| id | `uuid pk` |
| user_id | `uuid not null references auth.users on delete cascade` — applications와 **연결하지 않음**(지원 건 삭제해도 기록 유지) |
| called_at | `timestamptz not null default now()` |
| result | `text not null check (result in ('진행 중','성공','실패'))` |
| failure_reason | `text null check (failure_reason in ('AI 오류','시간 초과','형식 오류'))` |

- `check ((result = '실패') = (failure_reason is not null))` — 실패일 때만 사유가 있다.
- 인덱스: `(called_at)`, `(user_id, called_at)`.

---

## 3. 권한 규칙 (RLS + 권한 회수)

두 겹으로 막는다.
1. **테이블 권한(GRANT)**: `anon`에게서 모든 표의 권한을 회수 → 로그아웃 요청은 RLS까지 가지 않고 권한 오류로 거부(#6). `authenticated`에게서 `ai_usage`의 insert/update/delete 회수.
2. **RLS**: 모든 표 `enable row level security`. 정책은 `to authenticated`로만 만든다.

| 표 | select | insert | update | delete |
|---|---|---|---|---|
| applications | `user_id = auth.uid()` | check `user_id = auth.uid()` | using·check `user_id = auth.uid()` (소유자 변경 불가) | `user_id = auth.uid()` |
| profiles | 동일 | 동일 | 동일 | 동일 |
| ai_analyses | 동일 | check `user_id = auth.uid()` + 복합 FK | 정책 없음(분석은 수정하지 않음) | `user_id = auth.uid()` |
| ai_usage | `user_id = auth.uid()` | **정책 없음 + 권한 회수** | **없음** | **없음** |

- `ai_usage` 쓰기는 Edge Function이 `service_role`로 부르는 DB 함수만 한다(service_role은 RLS를 우회).
- 정책 안에서는 `(select auth.uid())` 형태로 써서 행마다 재평가하지 않게 한다.
- DB 함수 실행 권한: 기본 `PUBLIC` 실행 권한을 회수하고 필요한 역할에만 준다.
  - `seed_sample_data()` → `authenticated`만
  - `begin_ai_call()`, `finish_ai_call()` → `service_role`만
  - `my_ai_remaining()` → `authenticated`만
- 분석 결과 저장은 클라이언트가 `ai_analyses`에 직접 insert(RLS 적용)한다. 사용자가 점수를 조작해 넣을 수는 있지만 본인에게만 보이는 본인 데이터라 허용한다. 한도에는 영향 없음(한도는 ai_usage 기준이고 ai_usage는 서버만 씀).

---

## 4. 원자적 처리 — 어디서, 어떻게

원칙: **"확인 후 기록"을 클라이언트나 Edge Function에서 두 번의 요청으로 나누지 않는다.** 확인과 기록은 하나의 Postgres 함수(=하나의 트랜잭션) 안에서, 잠금을 잡은 뒤에 한다.

### 4.1 샘플 데이터 채우기 — DB 함수 `seed_sample_data()`

- 위치: Postgres 함수, `SECURITY INVOKER`(RLS가 그대로 적용되어 본인 계정에만 들어감). 클라이언트가 `supabase.rpc('seed_sample_data')`로 호출.
- 순서:
  1. `auth.uid()`가 null이면 예외.
  2. `pg_advisory_xact_lock(hashtextextended('seed:' || auth.uid(), 0))` — **같은 사용자의 동시 호출을 직렬화**. 다른 사용자끼리는 서로 막지 않음. 트랜잭션 종료 시 자동 해제.
  3. `exists(select 1 from applications where user_id = auth.uid())`이면 예외 `SAMPLE_NOT_EMPTY` (errcode 지정) → 화면은 "이미 지원 건이 있습니다".
  4. 가상 회사 지원 건 6개 insert (공고 원문 포함, 지원일 빈 건·상태 다양하게 섞어 #3 확인에도 쓰임).
  5. (Should 단계에서 함수 교체) 프로필이 비어 있으면 가상 프로필 upsert.
  6. 넣은 건수 반환.
- 왜 이걸로 충분한가: 두 번째 호출은 2에서 첫 호출의 커밋까지 대기 → 3에서 이미 있는 행을 보고 거부. 결과적으로 한 세트만 들어간다(#8).
- 알려진 한계: 샘플 채우기와 "직접 추가"가 동시에 일어나면 둘 다 들어갈 수 있다. PRD 요구(샘플 동시 요청 시 한 세트)와 무관하고 피해가 없어 허용.

### 4.2 AI 한도 판정 + "진행 중" 기록 — DB 함수 `begin_ai_call()`

- 위치: Postgres 함수, `SECURITY DEFINER`, 실행 권한 `service_role`만. Edge Function이 호출.
- 시그니처: `begin_ai_call(p_user_id uuid, p_user_limit int, p_global_limit int) returns uuid` — 한도를 인자로 받아 Edge Function 환경 변수(`AI_USER_DAILY_LIMIT=10`, `AI_GLOBAL_DAILY_LIMIT=100`)로 조정 → 테스트에서 낮춰서 #12·#14 확인. service_role만 부를 수 있으므로 사용자가 한도를 바꿀 수 없다.
- 순서:
  1. `pg_advisory_xact_lock(hashtextextended('ai_quota', 0))` — **전역 잠금 하나**로 모든 사용자의 판정을 직렬화. 하루 최대 100건이라 병목이 아니며, 잠금 하나로 사용자 한도와 전체 한도가 동시에 지켜진다(#13·#14).
  2. 오늘 시작 = `date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'` (KST 자정).
  3. 사용자 사용량 = 오늘 + 해당 사용자 + `counts_for_user(...)`가 참인 행 수. `>= p_user_limit`이면 예외 `AI_USER_LIMIT`.
  4. 전체 사용량 = 오늘 + 모든 행(사유 무관). `>= p_global_limit`이면 예외 `AI_GLOBAL_LIMIT`.
  5. `insert ... result='진행 중'` 후 id 반환.
- 사용자 한도 판정 순서: 사용자 한도를 먼저 본다(본인이 다 썼으면 본인 문구가 더 정확).

**집계 규칙은 한 함수로 고정** — `counts_for_user(result, failure_reason, called_at)` (`STABLE`):

| 기록 상태 | 사용자 횟수 | 전체 횟수 |
|---|---|---|
| 진행 중, 2분 이내 | ✅ | ✅ |
| 진행 중, 2분 지남 (=시간 초과 간주) | ❌ | ✅ |
| 성공 | ✅ | ✅ |
| 실패(형식 오류) | ✅ | ✅ |
| 실패(AI 오류) / 실패(시간 초과) | ❌ | ✅ |

- 2분 지난 "진행 중"은 **행을 고치지 않고 집계 시점에 계산**한다. 별도 정리 작업(cron)이 필요 없고, 서버가 중간에 죽어도 2분 뒤 자동으로 사용자 횟수에서 빠진다(#16).
- `begin_ai_call`(서버 판정)과 `my_ai_remaining()`(화면 표시)이 같은 `counts_for_user`를 쓰므로 표시와 판정이 어긋나지 않는다.

### 4.3 결과 기록 — DB 함수 `finish_ai_call(p_id, p_result, p_reason)`

- `SECURITY DEFINER`, `service_role`만.
- `result = '진행 중'`인 행만 갱신(중복 갱신 방지).
- **called_at이 2분을 넘었으면 요청 값과 무관하게 `실패(시간 초과)`로 기록** — 2분 넘게 걸린 호출이 뒤늦게 "성공"으로 바뀌어 사용자 횟수에 다시 잡히는 일을 막는다. Edge Function의 AI 호출 타임아웃은 60초로 두어 정상적으로는 2분에 닿지 않게 한다.

### 4.4 Edge Function `analyze-posting` 흐름

```
POST { application_id }  (Authorization: 사용자 JWT)
1. JWT 검증 → user_id. 없으면 401
2. 사용자 JWT로 만든 클라이언트(RLS 적용)로 지원 건 조회 → 없으면 404 (남의 건 포함)
3. posting_text 비어 있음 / 8,000자 초과 → 400            ← 횟수 소모 전에 거부
4. 프로필 조회, is_profile_empty → 400 PROFILE_EMPTY        ← 횟수 소모 전에 거부
5. service_role로 rpc begin_ai_call(user_id, 한도 env) → AI_USER_LIMIT / AI_GLOBAL_LIMIT면 429 + 구분 코드  ← AI 호출 전 거부
6. AI 호출 (AbortController 60초)
     - 네트워크·5xx·제공자 오류 → finish(실패, AI 오류) → 502
     - 타임아웃 → finish(실패, 시간 초과) → 504
7. 응답 형식 검증: fit_score 0~100 정수, matched/missing 문자열 배열, comment 비지 않은 문자열
     - 실패 → finish(실패, 형식 오류) → 422
8. finish(성공) → 200 { fit_score, matched_skills, missing_skills, comment }   (저장은 안 함)
```

- 응답 오류 코드 → 화면 문구 매핑은 프런트 한 곳에서 관리(PRD 문구 그대로).
- 테스트용 `AI_MOCK` 환경 변수(`ok` / `ai_error` / `timeout` / `format_error`)로 6~7단계를 흉내 낸다(#15·#19). **로컬·스테이징에만 설정**하고, 요청 파라미터로는 절대 바꿀 수 없게 한다.

---

## 5. 인증·배포 설정

- Google Cloud: OAuth 클라이언트(웹), 승인된 리디렉션 URI = `https://<project>.supabase.co/auth/v1/callback`. 스코프는 기본(openid, email, profile)만 — 민감 스코프가 아니어서 "프로덕션 게시" 시 별도 심사 부담이 적다. 앱 로고는 올리지 않는다(올리면 브랜드 확인 심사 대상이 될 수 있음).
- Supabase Auth: Google 공급자 활성화, 이메일 공급자 비활성화(Won't 6). **Site URL = Vercel 배포 주소**, Redirect URLs에 배포 주소와 `http://localhost:5173` 추가.
- 프런트: `signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })` — 실행 환경 주소로 돌아오므로 배포에서 localhost로 튕기지 않는다(#9).
- 비밀 값 위치:
  - 브라우저: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (공개돼도 되는 값)
  - Edge Function 비밀: `ANTHROPIC_API_KEY`, 한도 env, (로컬만) `AI_MOCK`
  - `.env*`는 `.gitignore`. service_role 키와 AI 키는 프런트 코드·저장소에 두지 않는다(#18).

---

## 6. 테스트 방법 요약

| 대상 | 방법 |
|---|---|
| RLS·권한(#5 #6 #17) | 로컬: 관리자 API로 테스트 사용자 2명 생성(로컬 전용, 운영에는 이메일 로그인 없음) → 각 JWT로 supabase-js 요청 → 응답 + DB 직접 조회. 배포: 구글 계정 2개의 세션 토큰으로 curl |
| 샘플 동시성(#8) | `tests/seed-concurrency` — 같은 JWT로 `Promise.all` 10건 → 성공 1건, 나머지 `SAMPLE_NOT_EMPTY`, 지원 건 수 = 6 |
| 한도·동시성(#12~#14) | 한도 env를 낮춘 로컬 Edge Function + `AI_MOCK=ok`로 동시 요청 → 통과 1건, ai_usage 건수 확인 |
| 실패 집계(#15 #16 #19) | `AI_MOCK` 사유별 실행 / `called_at`을 3분 전으로 넣은 진행 중 행 → `my_ai_remaining()` 확인 |
| 비밀 키(#18) | `git grep`로 키 패턴 검색 + 배포된 JS 번들 검색 |
