# S5 — Should 검증 체크리스트

배포 주소: **https://game-job-tracker.vercel.app**
대상: PRD 10장 #12~#19, #21, #22(Should 범위: 분석 코멘트 2,000자·기술 목록 30개), #20(Should 배포 후 재확인), design.md 7.5의 운영 CORS 403.
이미 통과: #11·#23(2026-11-04, 배포 주소).

> 검증용 구글 계정 2개(**A**, **B**)는 CLAUDE.md의 예외로 운영 DB에 데이터를 만들 수 있다. **끝나면 5장대로 정리한다.**
> 실제 AI 호출은 비용이 들므로 꼭 필요한 항목(#21 1회, #12 선택)만 배포 주소에서 한다. 실패 사유·동시성처럼 운영에서 일부러 만들 수 없는 것은 로컬 테스트로 대신한다.

---

## 1. 항목별 확인 방법

| # | 내용 | 배포 주소에서 | 로컬 테스트로 대신 (이미 통과) |
|---|---|---|---|
| 12 | 한도 초과는 AI 호출 전 거부, 저장 안 한 분석도 횟수 포함, 사용자·전체 문구 구분 | **선택**: A로 오늘 10회를 다 쓴 뒤 11번째에 사용자 한도 문구 확인(AI 10회 비용). 저장 안 한 분석의 차감은 #21 때 남은 횟수로 함께 확인 | `s3-analyze-posting` #12(사용자 한도·전체 한도, 거부 시 기록 없음), `e2e/analysis` 오류 문구. 전체 100회는 운영에서 만들지 않는다 |
| 13 | 사용자 남은 1회에서 동시 요청 → 1건만 | — (운영에서 한도를 낮출 수 없음) | `s2-ai-quota` #13(동시 10건·5건 → 1건, 잠금을 빼면 실패 확인) |
| 14 | 전체 남은 1회에서 다른 사용자 동시 요청 → 1건만 | — | `s2-ai-quota` #14(사용자 5명 동시 → 1건) |
| 15 | AI 오류·시간 초과는 사용자 횟수 제외·전체 포함, 형식 오류는 둘 다 포함 | — (운영에서 AI 오류를 일부러 만들 수 없음) | `s2-ai-quota` #15(DB 집계), `s3-analyze-posting` #15(AI_MOCK 모드별 함수 응답·기록) |
| 16 | 2분 지난 진행 중은 사용자 횟수 제외·전체 포함 | — | `s2-ai-quota` #16(3분 전 행, finish가 시간 초과로 기록, KST 자정) |
| 17 | ai_usage 본인 조회만, 다른 사용자 조회·직접 쓰기 거부 | **3-2** API 직접 요청 + **4장** `npm run test:prod` | `s2-ai-quota` #17 |
| 18 | 비밀 키가 배포 화면 코드와 저장소에 없다 | **3-5** 배포 번들 검색 + `npx supabase secrets list`(값이 아니라 해시만 보임) | `s3-analyze-posting` #18(저장소·응답·함수 로그) |
| 19 | 형식이 깨진 AI 응답은 저장 안 되고 오류가 보인다 | — | `s3-analyze-posting` #19(AI_MOCK=format_error → 422, 저장 0건), 형식 검증 단위 테스트 |
| 20 | Security Advisor 경고 0건(Should 배포 후) | **2장** 대시보드 | 로컬 `npx supabase db advisors --type security` 0건 |
| 21 | 본문에 다른 user_id를 넣어도 본인 한도만 차감 | **3-3** API 직접 요청(AI 1회) | `s3-analyze-posting` #21(잘못 고친 함수로 실패 확인) |
| 22 | 분석 코멘트 2,000자·기술 목록 30개 초과 저장 거부 | **3-4** API 직접 요청 + **4장** `npm run test:prod` | `s2-ai-quota` #22 |
| — | 운영 CORS: 허용 안 된 Origin → 403 | **3-1** (아래 "사전 확인" 참고) | `s3-analyze-posting` CORS 판단 단위 테스트 |

**사전 확인 (2026-11-04, Claude가 아래 3-1·3-5 명령을 그대로 실행, 토큰 없이 읽기만 함)**
- 3-1: 허용 안 된 Origin의 POST·사전 요청 → `403 {"error":"FORBIDDEN"}`, Allow-Origin 없음. 허용된 Origin 사전 요청 → `204`, Allow-Origin = 배포 주소. 토큰 없는 POST → `401 {"error":"AUTH_REQUIRED"}`.
- 3-5: 배포 번들(`/assets/index-*.js`, `*.css`)에 `sk-ant-`·`sb_secret_`·`service_role`·`ANTHROPIC`·JWT 형태 문자열 없음. 공개 키(`sb_publishable_`)만 있음(정상).
- 참고: 운영 게이트웨이는 `Authorization: Bearer sb_publishable_…`처럼 형식이 틀린 키를 함수까지 보내지 않고 직접 401로 거부하며, 이 게이트웨이 응답에는 `Access-Control-Allow-Origin: *`가 붙는다(함수 응답이 아님).

---

## 2. 브라우저·대시보드로 확인

| # | 할 일 | 통과 기준 |
|---|---|---|
| 20 | Supabase 대시보드 → Advisors → **Security Advisor** | 경고 0건 (Leaked Password Protection은 예외). 특히 "Signed-In Users Can Execute SECURITY DEFINER Function"이 없어야 한다 |
| — | 대시보드 → Authentication → Providers | 이메일 공급자 꺼짐(재확인) |
| 12 (선택) | A로 같은 지원 건을 오늘 10회 분석한 뒤 11번째 클릭 | "오늘 분석 횟수를 모두 사용했습니다. 내일 다시 시도해 주세요." / 남은 횟수 `0 / 10회` |

---

## 3. PowerShell로 API 직접 요청

### 3-0. 준비 (M7과 같은 방법, 토큰을 기록에 남기지 않음)

A·B 창 각각에서 로그인하고, A는 [샘플 데이터 채우기]로 지원 건·프로필을 만들어 둔다(프로필이 있어야 분석이 된다). 토큰·공개 키 담는 법은 [m7-checklist.md](m7-checklist.md) 2-1과 같다.

```powershell
$TokA = (Get-Clipboard -Raw).Trim(); Set-Clipboard -Value ' '     # A 창 콘솔에서 copy(...) 한 뒤
$TokB = (Get-Clipboard -Raw).Trim(); Set-Clipboard -Value ' '     # B 창
$ApiKey = (Get-Clipboard -Raw).Trim(); Set-Clipboard -Value ' '   # Publishable key
$UserA = '여기에-A의-사용자-ID'
$UserB = '여기에-B의-사용자-ID'
$AppId = '여기에-A의-지원건-ID'      # 공고 원문이 있는 A의 지원 건(샘플 중 하나)
```

요청 함수(한 번 붙여 넣기). PowerShell 5.1은 오류 응답 본문이 `ErrorDetails`에 있을 때와 응답 스트림에 남아 있을 때(길이 헤더 없는 응답)가 달라서 둘 다 읽는다. 2026-11-04에 운영 주소로 동작을 확인했다.

```powershell
$Base = 'https://yykukwakssqwuwfjrnce.supabase.co'

function Read-ErrorBody($err) {
  $msg = $err.ErrorDetails.Message
  if (-not $msg) { $msg = (New-Object IO.StreamReader($err.Exception.Response.GetResponseStream(), [Text.Encoding]::UTF8)).ReadToEnd() }
  $msg
}

function Send-Request {
  param([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$Json)
  $params = @{ Method = $Method; Uri = $Uri; Headers = $Headers; UseBasicParsing = $true }
  if ($Json) {
    $params['Body'] = [Text.Encoding]::UTF8.GetBytes($Json)
    $params['ContentType'] = 'application/json; charset=utf-8'
  }
  try {
    $r = Invoke-WebRequest @params
    "$($r.StatusCode) ACAO=$($r.Headers['Access-Control-Allow-Origin']) $([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()))"
  } catch [System.Net.WebException] {
    if (-not $_.Exception.Response) { throw }
    "$([int]$_.Exception.Response.StatusCode) ACAO=$($_.Exception.Response.Headers['Access-Control-Allow-Origin']) $(Read-ErrorBody $_)"
  }
}

# REST(표·rpc)
function Invoke-Api {
  param([string]$Method, [string]$Path, [string]$Token, [string]$Json)
  $h = @{ apikey = $ApiKey; Prefer = 'return=representation' }
  if ($Token) { $h['Authorization'] = "Bearer $Token" }
  Send-Request $Method "$Base/rest/v1/$Path" $h $Json
}

# Edge Function analyze-posting
function Invoke-Fn {
  param([string]$Json, [string]$Token, [string]$Origin, [string]$Method = 'POST')
  $h = @{}
  if ($ApiKey) { $h['apikey'] = $ApiKey }
  if ($Token) { $h['Authorization'] = "Bearer $Token" }
  if ($Origin) { $h['Origin'] = $Origin }
  Send-Request $Method "$Base/functions/v1/analyze-posting" $h $Json
}
```

### 3-0b. 대안: 브라우저 콘솔에서 `fetch` (2026-11-04 S5 검증에 실제로 쓴 방법)

콘솔의 `copy()`가 클립보드에 쓰지 못하는 환경(브라우저 설정·확장 프로그램 등)에서는 토큰을 PowerShell로 옮기지 말고, **각 계정의 배포 주소 창 콘솔에서 바로 요청한다.** 토큰이 그 브라우저 창 밖으로 나가지 않으므로 터미널 기록·클립보드에 남을 일이 없다. 요청은 배포 주소에서 나가므로 CSP(`connect-src`)와 CORS 허용 목록을 그대로 통과한다.

1) A 창과 B 창 각각의 개발자 도구 콘솔에 아래를 붙여 넣는다(붙여넣기가 막히면 `allow pasting` 먼저). `KEY`에는 Publishable key를 넣는다(공개 키라 콘솔에 써도 된다. secret key는 절대 쓰지 않는다).

```js
const BASE = 'https://yykukwakssqwuwfjrnce.supabase.co'
const KEY = '여기에-Publishable-key'
const ME = JSON.parse(localStorage.getItem('sb-yykukwakssqwuwfjrnce-auth-token'))
console.log('내 사용자 ID:', ME.user.id)

async function show(label, res) {
  console.log(label, res.status, await res.text())
}
// REST(표·rpc): api('GET', 'ai_usage?select=result')
async function api(method, path, body) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${ME.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  await show(`${method} ${path}`, res)
}
// Edge Function: fn({ application_id: '...' })
async function fn(body) {
  const res = await fetch(`${BASE}/functions/v1/analyze-posting`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${ME.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await show('analyze-posting', res)
}
```

2) 출력된 사용자 ID를 서로의 창에 옮겨 적는다(사용자 ID는 비밀이 아니다). 3-2~3-4의 PowerShell 명령과 같은 요청을 이렇게 보낸다:

| 항목 | 어느 창 | 콘솔 명령 | 통과 기준 |
|---|---|---|---|
| #17 A 자기 기록 | A | `await api('GET', 'ai_usage?select=result,called_at')` | `200` + A의 기록 |
| #17 B가 A의 기록 | B | `await api('GET', 'ai_usage?user_id=eq.<A의 ID>&select=id')` | `200 []` |
| #17 B가 A의 프로필·분석 | B | `await api('GET', 'profiles?user_id=eq.<A의 ID>')` / `await api('GET', 'ai_analyses?application_id=eq.<A의 지원건 ID>')` | `200 []` |
| #17 직접 쓰기 | A | `await api('POST', 'ai_usage', { user_id: ME.user.id, result: '실패', failure_reason: 'AI 오류' })` / `await api('DELETE', 'ai_usage?user_id=eq.' + ME.user.id)` | `403` + `42501` |
| #17 한도 함수 직접 호출 | A | `await api('POST', 'rpc/begin_ai_call', { p_user_id: ME.user.id, p_user_limit: 1000 })` | `403` permission denied |
| #21 전 | A·B | `await api('POST', 'rpc/my_ai_remaining', {})` | A=N, B=M 기록 |
| #21 요청 (AI 1회) | A | `await fn({ application_id: '<A의 지원건 ID>', user_id: '<B의 ID>', p_user_id: '<B의 ID>' })` | `200` + 분석 결과 |
| #21 후 | A·B | `await api('POST', 'rpc/my_ai_remaining', {})` | A=N-1, B=M |
| #22 코멘트 2,001자 | A | `await api('POST', 'ai_analyses', { application_id: '<A의 지원건 ID>', fit_score: 50, comment: '가'.repeat(2001) })` | `400` + `23514` + `ai_analyses_comment_len` |
| #22 기술 31개 | A | `await api('POST', 'ai_analyses', { application_id: '<A의 지원건 ID>', fit_score: 50, comment: 'x', matched_skills: Array.from({ length: 31 }, (_, i) => 's' + i) })` | `400` + `23514` + `ai_analyses_matched_skills_count` |

3) 끝나면 두 창에서 로그아웃하고 창을 닫는다(콘솔 변수도 사라진다). `console.log(ME)`처럼 토큰을 화면에 출력하거나, 콘솔 내용을 캡처·공유하지 않는다.

> CORS 403(3-1)과 배포 번들 검색(3-5)은 토큰이 필요 없어 PowerShell로 하는 편이 편하다. 콘솔에서 보내는 요청은 Origin이 항상 배포 주소라 허용 안 된 Origin을 흉내 낼 수 없다.

### 3-1. 운영 CORS (토큰 불필요, AI 호출 없음)

| 요청 | 명령 | 통과 기준 |
|---|---|---|
| 허용 안 된 Origin POST | `Invoke-Fn '{"application_id":"00000000-0000-0000-0000-000000000000"}' -Origin 'https://evil.example'` | `403 ACAO= {"error":"FORBIDDEN"}` |
| 허용 안 된 Origin 사전 요청 | `Invoke-Fn -Method OPTIONS -Origin 'https://evil.example'` | `403 ACAO=` |
| 허용된 Origin 사전 요청 | `Invoke-Fn -Method OPTIONS -Origin 'https://game-job-tracker.vercel.app'` | `204 ACAO=https://game-job-tracker.vercel.app` |
| 토큰 없음 | `Invoke-Fn '{"application_id":"00000000-0000-0000-0000-000000000000"}'` | `401 ACAO= {"error":"AUTH_REQUIRED"}` |

### 3-2. #17 ai_usage·Should 표 교차 검증

먼저 A가 분석을 한 번 이상 해서 ai_usage 기록이 있어야 한다(3-3을 먼저 해도 된다).

| 요청 | 명령 | 통과 기준 |
|---|---|---|
| A는 자기 기록 조회 | `Invoke-Api GET "ai_usage?select=result,called_at" $TokA` | `200` + A의 기록 |
| B가 A의 기록 조회 | `Invoke-Api GET "ai_usage?user_id=eq.$UserA&select=id" $TokB` | `200 []` |
| A가 직접 기록 추가 | `Invoke-Api POST "ai_usage" $TokA (@{ user_id = $UserA; result = '실패'; failure_reason = 'AI 오류' } \| ConvertTo-Json -Compress)` | `403` + `"code":"42501"` |
| A가 직접 기록 수정 | `Invoke-Api PATCH "ai_usage?user_id=eq.$UserA" $TokA '{"result":"실패","failure_reason":"AI 오류"}'` | `403` + `"code":"42501"` |
| A가 직접 기록 삭제 | `Invoke-Api DELETE "ai_usage?user_id=eq.$UserA" $TokA` | `403` + `"code":"42501"` |
| A가 한도 함수 직접 호출 | `Invoke-Api POST "rpc/begin_ai_call" $TokA (@{ p_user_id = $UserA; p_user_limit = 1000 } \| ConvertTo-Json -Compress)` | `403`(또는 `404`) + 실행 권한 없음 |
| B가 A의 프로필 조회 | `Invoke-Api GET "profiles?user_id=eq.$UserA" $TokB` | `200 []` |
| B가 A의 분석 조회 | `Invoke-Api GET "ai_analyses?application_id=eq.$AppId" $TokB` | `200 []` |

### 3-3. #21 본문에 다른 user_id를 넣어도 본인 한도만 차감 (AI 1회)

```powershell
Invoke-Api POST "rpc/my_ai_remaining" $TokA '{}'      # A 전: {"remaining":N, ...}
Invoke-Api POST "rpc/my_ai_remaining" $TokB '{}'      # B 전: {"remaining":M, ...}
Invoke-Fn (@{ application_id = $AppId; user_id = $UserB; p_user_id = $UserB } | ConvertTo-Json -Compress) $TokA
Invoke-Api POST "rpc/my_ai_remaining" $TokA '{}'      # A 후
Invoke-Api POST "rpc/my_ai_remaining" $TokB '{}'      # B 후
```

통과 기준: 분석 요청이 `200` + 분석 결과, **A는 N-1, B는 M 그대로**. 이 분석은 저장하지 않았으므로 "저장 안 한 분석도 횟수에 포함"(#12)도 함께 확인된다.

### 3-4. #22 분석 결과 상한 (AI 호출 없음)

```powershell
$Long = '가' * 2001
Invoke-Api POST "ai_analyses" $TokA (@{ application_id = $AppId; fit_score = 50; comment = $Long } | ConvertTo-Json -Compress)
Invoke-Api POST "ai_analyses" $TokA (@{ application_id = $AppId; fit_score = 50; comment = 'x'; matched_skills = @(1..31 | ForEach-Object { "s$_" }) } | ConvertTo-Json -Compress)
```

| 요청 | 통과 기준 |
|---|---|
| 코멘트 2,001자 | `400` + `"code":"23514"` + `ai_analyses_comment_len` |
| 매칭 기술 31개 | `400` + `"code":"23514"` + `ai_analyses_matched_skills_count` |

### 3-5. #18 배포 번들에 비밀 키가 없다 (토큰 불필요)

```powershell
$Site = 'https://game-job-tracker.vercel.app'
$html = (Invoke-WebRequest "$Site/" -UseBasicParsing).Content
$assets = @([regex]::Matches($html, '(?:src|href)="(/assets/[^"]+\.(?:js|css))"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
foreach ($a in $assets) {
  $text = [Text.Encoding]::UTF8.GetString((Invoke-WebRequest "$Site$a" -UseBasicParsing).RawContentStream.ToArray())
  $hits = @([regex]::Matches($text, 'sk-ant-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{10,}|service_role|SERVICE_ROLE|ANTHROPIC|eyJhbGciOi') | ForEach-Object { $_.Value } | Select-Object -Unique)
  "$a  검색 결과: $(if ($hits.Count) { $hits -join ', ' } else { '없음' })"
}
npx supabase secrets list
```

통과 기준: 모든 파일 "없음". `secrets list`에는 이름과 해시만 보이고, `AI_MOCK`·`AI_USER_DAILY_LIMIT`·`AI_GLOBAL_DAILY_LIMIT`가 없다.

### 3-6. 정리

```powershell
Remove-Variable TokA, TokB, ApiKey, UserA, UserB, AppId, Long -ErrorAction SilentlyContinue
Set-Clipboard -Value ' '
```

---

## 4. 운영 DB 롤백 검사 다시 실행

[m7-checklist.md](m7-checklist.md) 6-2와 같은 방법으로 `npm run test:prod`. S5에서 profiles·ai_analyses·ai_usage 교차 검증(#17, #22 분석 결과)과 Should 표 권한 점검을 추가했다.

- 로컬 DB 기준 **47개**. 운영은 `rls_auto_enable` 검사가 하나 더 돌아 **48개**가 나와야 한다.
- 마지막 줄 `ROLLBACK 완료, 운영 데이터 변경 없음`.
- 로컬에서 profiles RLS를 끄고 ai_usage 쓰기 권한을 준 상태로 돌리면 9개가 실패해 검사가 문제를 잡는 것을 확인했다.

---

## 5. 운영 테스트 데이터 정리 (CLAUDE.md 규칙)

Supabase 대시보드 → SQL Editor에서 A·B 것만 지운다. 지원 건을 지우면 분석 결과도 함께 지워진다(연쇄 삭제).

```sql
-- A·B의 사용자 ID를 확인한 뒤 실행
delete from public.applications where user_id in ('A의-사용자-ID', 'B의-사용자-ID');
delete from public.profiles     where user_id in ('A의-사용자-ID', 'B의-사용자-ID');
delete from public.ai_usage     where user_id in ('A의-사용자-ID', 'B의-사용자-ID');   -- 검증 계정의 호출 기록(전체 한도 집계에서도 빠진다)
```

---

## 6. 결과 알려 주기

```
#12 통과/선택 안 함 / #17 통과 / #18 통과 / #20 통과(경고 0) / #21 통과(A N→N-1, B 그대로) / #22 통과 / CORS 403 통과 / test:prod 48개 통과
실패가 있으면: #번호 — 실제로 본 상태 코드·본문 또는 화면
```

#13·#14·#15·#16·#19는 로컬 테스트 결과로 PRD 10장에 기록한다.
