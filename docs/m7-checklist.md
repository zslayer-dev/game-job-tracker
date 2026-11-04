# M7 — 배포 주소 Must 검증 체크리스트

배포 주소: **https://game-job-tracker.vercel.app**
대상: PRD 10장 #1~#10, #20, #22(Must 범위: memo 5,000자·지원 건 500건).
준비물: 구글 계정 2개(이하 **A**, **B**), Chrome 또는 Edge, Windows PowerShell.

> 검증용 계정 2개는 CLAUDE.md의 예외로 운영 DB에 데이터를 만들 수 있다. **끝나면 4장대로 정리한다.**
> 결과는 각 항목의 번호와 함께 "통과 / 실패(무엇이 달랐는지)"로 알려 주면 PRD 10장에 기록한다.

---

## 1. 브라우저로 직접 확인

일반 창 = 계정 A, 시크릿 창 = 계정 B(또는 로그아웃 상태)로 쓴다. 각 창에서 개발자 도구 콘솔을 열어 두고 CSP 위반·오류가 없는지 함께 본다.

| # | 할 일 | 통과 기준 |
|---|---|---|
| 9 | 시크릿 창에서 배포 주소 → 구글 로그인 | 배포 주소로 돌아온다(localhost로 가지 않음) |
| 10 | OAuth 테스트 사용자 목록에 없는 계정으로 로그인 | 로그인된다 |
| 7 | 지원 건이 없는 계정 A에서 [샘플 데이터 채우기] | 6건이 보이고 버튼이 사라진다 |
| 7 | 계정 B로 로그인 | A의 샘플 6건이 보이지 않는다(빈 상태 화면) |
| 8 | 계정 B(빈 상태)에서 탭 2~3개를 열고 거의 동시에 [샘플 데이터 채우기] | 새로고침 후 정확히 6건 (동시 10건은 로컬 `tests/m5-seed.test.mjs`로 확인됨) |
| 1 | A에서 [지원 건 추가]로 1건 추가 → 새로고침 | 목록에 남아 있다 |
| 2 | 그 건의 상태를 `면접` → `관심`처럼 앞뒤로 바꾸고 저장 → 로그아웃 → 다시 로그인 | 마지막 상태가 유지된다 |
| 3 | 목록에서 상태 필터·회사명 검색·정렬 확인(지원일 있는 건 2개 이상 + 빈 건 1개 이상) | 필터·검색 동작, 지원일 최신순, 빈 지원일은 맨 아래 |
| 4 | 추가 화면에서 회사명 또는 포지션을 비우고 저장 | "회사명을 입력해 주세요." 등 문구, 저장 안 됨 |
| 6 | 로그아웃 상태(시크릿 창)에서 `https://game-job-tracker.vercel.app/` 와 `/applications/new` 를 직접 열기 | 로그인 화면으로 간다 (API 쪽 거부는 2장 6번) |
| 20 | Supabase 대시보드 → Advisors → **Security Advisor** | 경고 0건 (Leaked Password Protection은 예외 — PRD #20 비고) |

추가로 함께 보면 좋은 것: 모바일 폭에서 목록 카드, 다크 모드 드롭다운, `/privacy.html` 열림.

---

## 2. PowerShell로 API 직접 요청 (#5, #6, #22)

화면을 거치지 않고 Supabase API에 직접 요청해서, **서버·DB가** 거부하는지 확인한다.

### 2-1. 준비: 토큰을 터미널 기록에 남기지 않고 변수에 담기

토큰을 명령줄에 직접 붙여 넣으면 PowerShell 기록(`PSReadLine` 기록 파일)에 남는다.
**클립보드 → 변수**로 옮기면 기록에는 변수 이름만 남는다.

1) 배포 주소에서 **계정 A로 로그인한 창**의 개발자 도구 콘솔에 아래를 입력한다.
   (붙여넣기가 막히면 콘솔 안내대로 `allow pasting`을 먼저 입력)

```js
copy(JSON.parse(localStorage.getItem('sb-yykukwakssqwuwfjrnce-auth-token')).access_token)
```

2) PowerShell에서 (토큰이 아니라 명령만 입력한다):

```powershell
$TokA = (Get-Clipboard -Raw).Trim(); Set-Clipboard -Value ' '
```

3) **계정 B 창**에서 같은 콘솔 명령을 실행한 뒤:

```powershell
$TokB = (Get-Clipboard -Raw).Trim(); Set-Clipboard -Value ' '
```

4) 공개 키(publishable key)도 같은 방법으로 담는다. Supabase 대시보드 → Project Settings → API Keys의 **Publishable key**를 복사한 뒤:

```powershell
$ApiKey = (Get-Clipboard -Raw).Trim(); Set-Clipboard -Value ' '
```

5) 계정 A의 사용자 ID(비밀 아님)는 A 창 콘솔에서 확인해 둔다.

```js
JSON.parse(localStorage.getItem('sb-yykukwakssqwuwfjrnce-auth-token')).user.id
```

> - access token은 약 1시간 뒤 만료된다. 중간에 401 `PGRST303`(JWT expired)이 나오면 1)~3)을 다시 한다.
> - **secret key·service_role key는 쓰지 않는다.** 이 검증은 사용자 토큰 + 공개 키만으로 한다.
> - 토큰 값을 화면에 출력(`$TokA` 단독 입력, `Write-Host $TokA`)하지 않는다.

### 2-2. 요청 함수 (한 번 붙여 넣기)

PowerShell 5.1은 4xx 응답에서 예외를 던지므로 상태 코드와 본문을 꺼내 보여 주는 함수를 쓴다. 한글이 깨지지 않게 UTF-8로 보낸다.

```powershell
$Base = 'https://yykukwakssqwuwfjrnce.supabase.co/rest/v1'

function Invoke-Api {
  param([string]$Method, [string]$Path, [string]$Token, [string]$Json)
  $headers = @{ apikey = $ApiKey; Prefer = 'return=representation' }
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = "$Base/$Path"; Headers = $headers; UseBasicParsing = $true }
  if ($Json) {
    $params['Body'] = [Text.Encoding]::UTF8.GetBytes($Json)
    $params['ContentType'] = 'application/json; charset=utf-8'
  }
  try {
    $r = Invoke-WebRequest @params
    "$($r.StatusCode) $([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()))"
  } catch [System.Net.WebException] {
    if (-not $_.Exception.Response) { throw }
    # PowerShell 5.1은 오류 응답 본문을 ErrorDetails에 담아 둔다(응답 스트림은 이미 비어 있음)
    "$([int]$_.Exception.Response.StatusCode) $($_.ErrorDetails.Message)"
  }
}
```

> 이 함수와 아래 명령은 Windows PowerShell 5.1에서 **로컬 스택**을 대상으로 미리 실행해 봤다(같은 명령, 주소·키만 로컬). 기대 결과도 그때 실제로 나온 값이다.

### 2-3. #5 계정 B는 계정 A의 지원 건을 보거나 바꿀 수 없다

A 창에서 지원 건 하나의 상세 화면을 열고, 주소창의 `/applications/` 뒤 ID를 복사한다. 그 건의 **메모 내용**을 기억해 둔다.

```powershell
$AppId = '여기에-A의-지원건-ID'
$UserA = '여기에-A의-사용자-ID'
```

| 요청 | 명령 | 통과 기준 |
|---|---|---|
| B가 A의 건 조회 | `Invoke-Api GET "applications?id=eq.$AppId" $TokB` | `200 []` |
| B가 A의 건 수정 | `Invoke-Api PATCH "applications?id=eq.$AppId" $TokB '{"memo":"B가 바꿈"}'` | `200 []` |
| B가 A의 건 삭제 | `Invoke-Api DELETE "applications?id=eq.$AppId" $TokB` | `200 []` |
| B가 A 소유로 추가 | `Invoke-Api POST "applications" $TokB (@{ company = 'B가 넣음'; position = 'x'; user_id = $UserA } \| ConvertTo-Json -Compress)` | `403` + `"code":"42501"` |
| 대조: A가 자기 건 조회 | `Invoke-Api GET "applications?id=eq.$AppId&select=id,memo" $TokA` | `200` + 원래 메모 1건 |

**DB 변경 없음 확인**: A 창에서 그 건을 새로고침해 메모가 원래대로인지 본다. 더 확실히 하려면 Supabase 대시보드 → SQL Editor에서:

```sql
select id, user_id, memo, updated_at from public.applications where id = '여기에-A의-지원건-ID';
```

→ 행이 그대로 있고 memo·updated_at이 바뀌지 않았으면 통과. `B가 넣음` 회사가 어느 계정에도 생기지 않았는지도 본다:

```sql
select count(*) from public.applications where company = 'B가 넣음';  -- 0이어야 한다
```

### 2-4. #6 로그아웃 상태의 조회·추가 거부

토큰 없이(공개 키만) 요청한다.

| 요청 | 명령 | 통과 기준 |
|---|---|---|
| 조회 | `Invoke-Api GET "applications?select=id"` | `401` + `"code":"42501"` |
| 추가 | `Invoke-Api POST "applications" $null (@{ company = '로그아웃 상태'; position = 'x' } \| ConvertTo-Json -Compress)` | `401` + `"code":"42501"` |

### 2-5. #22 상한 (Must 범위)

```powershell
$Memo5001 = '가' * 5001
Invoke-Api POST "applications" $TokA (@{ company = '상한 테스트'; position = 'x'; memo = $Memo5001 } | ConvertTo-Json -Compress)
```

| 요청 | 통과 기준 |
|---|---|
| memo 5,001자 추가 | `400` + `"code":"23514"` + `applications_memo_len` |
| (참고) 공고 원문 8,001자: 위에서 `memo` 대신 `posting_text = 'a' * 8001` | `400` + `applications_posting_text_len` |
| 지원 건 500건 상한 | **운영에서는 하지 않는다**(500건을 만들어야 함). 로컬 `tests/m2-applications.test.mjs`에서 500건·501번째·한 번에 501건·499건에서 동시 2건을 확인했다 |

---

## 3. 끝난 뒤 PowerShell 정리

```powershell
Remove-Variable TokA, TokB, ApiKey, AppId, UserA, Memo5001 -ErrorAction SilentlyContinue
Set-Clipboard -Value ' '
```

브라우저 두 창에서 로그아웃한다(refresh token이 폐기된다. 이미 발급된 access token은 최대 1시간 뒤 만료).

---

## 4. 운영 테스트 데이터 정리 (CLAUDE.md 규칙)

검증 계정 A·B의 지원 건을 화면에서 삭제하거나, Supabase 대시보드 → SQL Editor에서 두 계정 것만 지운다.

```sql
-- A·B의 사용자 ID를 확인한 뒤 실행
delete from public.applications where user_id in ('A의-사용자-ID', 'B의-사용자-ID');
```

계정(auth.users) 자체는 남겨 두어도 되고, 다시 검증할 때 쓰면 된다.

---

## 5. 결과 알려 주기

아래 형식으로 알려 주면 PRD 10장 결과 칸에 기록한다.

```
#1 통과 / #2 통과 / ... / #5 통과 / #6 통과 / #20 통과(경고 0, Leaked Password 예외) / #22 통과(memo 400)
실패가 있으면: #번호 — 실제로 본 상태 코드·본문 또는 화면
```

---

## 6. 자동화된 교차 검증

### 6-1. 로컬 화면 E2E (`npm run test:e2e`)

로컬 스택 + 로컬 개발 서버에서 Playwright로 실제 화면을 조작한다(브라우저는 Windows 기본 Edge). 임시 사용자 A·B·C를 만들어 세션을 주입하고, 끝나면 지운다. `web\.env.local`이 로컬 스택을 가리키지 않으면 실행을 거부한다. 개발 서버가 꺼져 있으면 자동으로 띄운다.

| 검사 | PRD |
|---|---|
| A: 추가 → 목록에 보임 → 새로고침 후 유지 → 상태 면접·관심 변경이 새로고침 후 유지 | #1, #2 |
| B: 목록에 A의 건 없음, A의 상세 주소 → "지원 건을 찾을 수 없습니다.", 폼·삭제 버튼 없음, B 토큰으로 직접 수정·삭제해도 0건 | #5 |
| 로그아웃 상태: `/`, `/applications/new`, 상세 주소 → 로그인 화면, 지원 데이터 요청 0건 | #6 |
| 빈 계정 C: 샘플 버튼을 다시 그려지기 전에 5번 클릭 → 요청 1번, 오류 없음, 6건 | #8 |

```powershell
npx supabase start
npm run test:e2e
```

### 6-2. 운영 DB 롤백 검사 (`npm run test:prod`)

> **상태: 미실행(Should 단계 운영 반영 후 회귀 검사용).** M7 운영 검증은 실제 계정 토큰으로 한 API 검증(2장, #5·#6·#22, 2026-11-04 통과)으로 대신했다.

`tests/prod/cross-check.mjs`가 운영 DB에 직접 접속해 **하나의 트랜잭션 안에서** 검사하고 마지막에 반드시 `ROLLBACK` 한다(중간에 실패해도 ROLLBACK). 운영 데이터는 바뀌지 않는다.

- 트랜잭션 안에서 임시 사용자 A·B(`prodcheck-…@example.invalid`)와 A의 지원 건을 만들고, `set local role authenticated` + `request.jwt.claims`로 B를 흉내 낸다(PostgREST가 요청마다 하는 것과 같음).
- 검사: #5(B의 조회·수정·삭제 0건, A 소유로 추가 거부, 소유자 변경 거부, A의 건 그대로), #6(anon 조회·추가 42501), #22(memo 5,001자·posting_text 8,001자 거부, 5,000자는 저장), 권한(authenticated 4개만, anon·PUBLIC 없음, RLS 켜짐, 함수 search_path 비어 있음, seed_sample_data·rls_auto_enable 실행 권한).
- 끝에 항목별 통과/실패와 `ROLLBACK 완료, 운영 데이터 변경 없음`을 출력한다. 이 문구는 ROLLBACK 후 트랜잭션 밖에서 임시 사용자가 0명인 것까지 확인했을 때만 나온다.
- 접속 문자열과 비밀번호는 출력하지 않는다(오류 문구에서도 지움). 실패가 있으면 종료 코드 1.
- 로컬 DB를 대상으로 미리 실행해 17개 통과를 확인했다. 로컬에서 RLS를 끄고 anon에 SELECT를 준 상태로 돌리면 8개가 실패해 검사가 문제를 잡는 것도 확인했다. 운영의 `postgres` 역할은 로컬과 달리 슈퍼유저가 아니므로, 처음 실행에서 `실행 중 오류 42501`(예: auth.users 추가 권한)이 나오면 그 출력을 알려 준다.

**준비 (한 번)**

1. Supabase 대시보드 → 상단 **Connect** → **Session pooler** 접속 문자열을 확인한다(`[YOUR-PASSWORD]` 자리가 있는 형태). Direct connection은 IPv6 전용이라 쓰지 않는다.
2. 대시보드 → Project Settings → Database → **SSL Configuration → Download certificate**로 인증서를 받는다. 저장소 밖(예: `$HOME\Downloads`)에 둔다. 스크립트는 운영 접속 시 이 인증서로 서버를 검증한다.
3. DB 비밀번호를 모르면 같은 Database 설정에서 재설정한다.

**실행 (값이 PowerShell 기록에 남지 않게)**

`Read-Host`로 입력한 값은 PSReadLine 기록 파일에 저장되지 않는다. 비밀번호는 `-AsSecureString`으로 받아 화면에도 보이지 않게 한다.

```powershell
$tpl = Read-Host '접속 문자열 ([YOUR-PASSWORD]는 그대로 둔 채 붙여 넣기)'
$pw  = Read-Host 'DB 비밀번호' -AsSecureString
$env:PROD_DB_URL = $tpl.Replace('[YOUR-PASSWORD]', [uri]::EscapeDataString([Net.NetworkCredential]::new('', $pw).Password))
Remove-Variable tpl, pw
$env:PROD_DB_CA = "$HOME\Downloads\prod-ca-2021.crt"   # 받은 인증서 파일 이름에 맞춘다

npm run test:prod
```

**끝난 뒤 정리**

```powershell
Remove-Item Env:PROD_DB_URL, Env:PROD_DB_CA -ErrorAction SilentlyContinue
```

환경 변수는 이 PowerShell 창에만 있으므로 창을 닫아도 사라진다. `$env:PROD_DB_URL`을 단독으로 입력해 값을 화면에 출력하지 않는다.
