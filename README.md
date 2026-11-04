# 게임업계 구직 트래커

여러 게임사에 동시에 지원하는 프로그래머가 회사마다 다른 전형 단계와 지원 이력을 한곳에서 추적하는 웹 서비스입니다.

- **배포 주소: https://game-job-tracker.vercel.app**
- **구글 계정으로 로그인해야 사용할 수 있습니다.** 공유 데모 계정은 없습니다. 처음 로그인하면 빈 화면에서 [샘플 데이터 채우기]로 가상 회사 지원 건 6개를 바로 넣어 볼 수 있습니다.
- 개인정보처리방침: https://game-job-tracker.vercel.app/privacy.html

## 핵심 기능 (Must)

| 기능 | 설명 |
|---|---|
| 구글 로그인·로그아웃 | 본인 데이터만 보입니다. 화면에서 숨기는 게 아니라 DB가 다른 사람의 요청을 거부합니다 |
| 지원 건 관리 | 회사, 포지션, 지원 경로, 상태(관심 → 지원 완료 → 서류 통과 → 과제·코테 → 면접 → 최종 합격 / 불합격·포기), 지원일, 마감일, 공고 원문, 메모를 추가·수정·삭제. 상태는 순서와 무관하게 바꿀 수 있습니다 |
| 목록 | 상태 필터, 회사명 검색, 지원일 최신순 정렬(지원일 없는 건은 맨 아래). 필터·검색어는 주소에 남아 새로고침·뒤로가기에도 유지 |
| 샘플 데이터 | 지원 건이 하나도 없을 때만 가상 회사 6건을 내 계정에 채웁니다. 여러 탭에서 동시에 눌러도 한 세트만 들어갑니다 |

Should(경력 프로필, AI 공고 분석)는 아직 구현 전입니다. 진행 상황은 [docs/plan.md](docs/plan.md)에 있습니다.

### 화면

| 로그인 | 지원 목록 | 지원 건 상세·편집 | 모바일 |
|---|---|---|---|
| ![로그인](docs/images/login.png) | ![지원 목록](docs/images/list.png) | ![상세·편집](docs/images/detail.png) | ![모바일](docs/images/mobile.png) |

## 기술 스택

| 구성 | 선택 | 이유 |
|---|---|---|
| DB·인증·서버 함수 | **Supabase** (Postgres, Auth, Edge Functions) | Postgres RLS가 로그인 토큰과 바로 연결되어 "본인 데이터만"을 DB에서 강제하고, 원자적 처리를 DB 함수 하나로 묶을 수 있음. 카드 없이 무료로 시작 |
| 프런트엔드 | **React + Vite + TypeScript** | 정적 SPA로 충분하고 빌드·배포가 단순함 |
| 배포 | **Vercel** | Git 푸시로 자동 배포, 보안 헤더를 `vercel.json`으로 설정 |
| (Should) AI | Claude API | 비밀 키는 Edge Function에만 둠 |

검토하고 버린 후보(Firebase, Next.js + Neon)와 이유는 [docs/design.md](docs/design.md) 1장에 있습니다.

## 보안·권한 설계 요약

- **본인 데이터만 (RLS)**: 모든 표에 RLS를 켜고 `user_id = auth.uid()`인 행만 조회·추가·수정·삭제할 수 있습니다. 다른 계정의 ID로 요청해도 0건이 되고, 소유자를 남으로 바꾸는 수정도 거부됩니다.
- **권한 명시**: 로그아웃 상태(`anon`)에는 표 권한 자체가 없어 요청이 권한 오류로 거부됩니다. 로그인 사용자(`authenticated`)에게는 필요한 권한만 마이그레이션에서 명시적으로 줍니다(운영 프로젝트는 새 표 자동 노출을 꺼 둠).
- **DB 함수 규칙**: 모든 함수에 `search_path = ''`와 스키마 명시, 실행 권한은 필요한 역할에만.
- **동시성**: "확인 후 기록"을 한 트랜잭션 안에서 사용자별 advisory lock을 잡은 뒤 처리합니다.
  - 샘플 채우기: 동시 10건 요청 → 1건만 성공, 나머지는 거부, 정확히 6건.
  - 지원 건 500건 상한: 499건에서 동시에 2건 추가 → 1건만 통과.
- **상한(화면 + DB 제약)**: 공고 원문 8,000자, 메모 5,000자, 사용자당 지원 건 500건.
- **화면**: 사용자 입력은 텍스트로만 렌더링(HTML 주입 없음). 오류는 정해진 코드·문구로만 보여 주고 DB 원본 오류는 노출하지 않습니다. 로그인 토큰이 만료되면 로그인 화면으로 안내합니다.
- **배포 설정**: CSP·X-Frame-Options 등 보안 헤더, 로그인 복귀 주소는 와일드카드 없이 정확한 주소만, 비밀 키는 브라우저 코드와 저장소에 두지 않음.

자세한 내용: [docs/design.md](docs/design.md) 2~4장(표·권한·원자적 처리), 7장(보안 규칙).

## 로컬 실행

필요 도구: Node.js 24 이상, Docker Desktop(실행 중). Supabase CLI는 루트 `package.json`에 버전을 고정해 두어 `npx supabase`로 씁니다. 아래 명령은 Windows PowerShell 기준입니다.

```powershell
npm install
npm install --prefix web

npx supabase start                                # 로컬 Postgres·Auth (처음엔 Docker 이미지 다운로드)

Copy-Item web\.env.example web\.env.local          # API_URL·PUBLISHABLE_KEY 값을 채운다
npx supabase status -o env

Copy-Item supabase\.env.example supabase\.env      # 로컬 구글 로그인용 클라이언트 ID·secret
npx supabase stop; npx supabase start             # supabase\.env를 바꾼 뒤 재시작

npm run dev --prefix web                          # http://localhost:5173 (127.0.0.1이 아니라 localhost로 열기)
```

- 마이그레이션은 `supabase/migrations/`에 있고 `npx supabase start` 또는 `npx supabase migration up`으로 로컬에 적용됩니다.
- 로컬 Supabase Studio: http://127.0.0.1:54323

## 테스트

```powershell
npm run test:db                                   # 로컬 스택 전용 DB 테스트
npm run test:e2e                                  # 로컬 화면 E2E (Playwright, Windows 기본 Edge)
npm run build --prefix web; npm run lint --prefix web
npx supabase db advisors --type security          # 로컬 보안 점검
```

`npm run test:db`는 로컬 스택이 아니면 실행을 거부하고, 테스트 사용자를 만들어 쓴 뒤 지웁니다.

| 파일 | 확인하는 것 |
|---|---|
| `tests/m2-applications.test.mjs` | 필수값·선택지·길이 제약, 다른 계정 접근 거부, 로그아웃 거부, 500건 상한·동시 추가, 권한·RLS 설정 |
| `tests/m2-rls-auto-enable.test.mjs` | 운영 자동 RLS 함수의 실행 권한 회수 마이그레이션 |
| `tests/m4-search.test.mjs` | 회사명 검색에서 특수문자(`\ . ^ $ * + ? ( ) [ ] { } \| % _`)·한글·대소문자가 글자 그대로 일치 |
| `tests/m5-seed.test.mjs` | 샘플 동시 요청 시 한 세트만, 다른 계정 격리, 재요청 거부 |
| `tests/e2e/cross-check.spec.mjs` | 실제 화면에서 추가·상태 유지, 다른 계정의 상세 주소 "찾을 수 없음", 로그아웃 상태 이동, 샘플 버튼 연타 시 6건만 |
| `tests/prod/cross-check.mjs` | 운영 DB에서 한 트랜잭션 안에 다른 계정 접근·로그아웃·상한·권한을 검사하고 ROLLBACK (`npm run test:prod`, 절차는 m7-checklist.md 6장) |

배포 주소에서의 검증 절차는 [docs/m7-checklist.md](docs/m7-checklist.md), 결과는 [PRD.md](PRD.md) 10장에 기록합니다.

## 알려진 제약

- **Supabase 무료 플랜 일시 정지**: 일정 기간(약 1주) 활동이 없으면 프로젝트가 일시 정지됩니다. 접속이 안 되면 대시보드에서 다시 시작해야 하며, 심사 기간에는 미리 접속해 깨워 둡니다.
- **Vercel 미리보기 주소에서는 로그인 불가**: 로그인 복귀 주소(Redirect URLs)를 보안상 와일드카드 없이 배포 주소와 `http://localhost:5173`만 등록했기 때문입니다. 로그인은 배포 주소에서만 됩니다.
- 구글 계정 로그인만 지원합니다(이메일·비밀번호 로그인 없음).

## 문서

| 문서 | 내용 |
|---|---|
| [PRD.md](PRD.md) | 요구사항, 서비스 규칙, 검증 기록(10장) |
| [docs/design.md](docs/design.md) | 기술 결정, 표 구조, 권한, 원자적 처리, 보안 규칙 |
| [docs/plan.md](docs/plan.md) | 단계별 작업 목록과 검증 번호 |
| [docs/m7-checklist.md](docs/m7-checklist.md) | 배포 주소 Must 검증 절차 |
| [retrospective.md](retrospective.md) | 회고 |
