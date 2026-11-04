# C3 — Could(관리자 기능) 검증 체크리스트

대상: PRD 10장 #24~#27, #20(Could 반영 후 Security Advisor).
이미 통과(2026-11-04, 배포 주소): **#24 화면**(관리자 메뉴는 관리자에게만, 일반 계정 `/admin` → "권한이 없습니다"), **#26**(허용 목록 모드에서 목록 밖 B 차단·상세 화면 안내·버튼 비활성).

남은 확인은 **두 단계**로 끝난다. 둘 다 PowerShell 창 하나에서 하고, 운영 데이터를 바꾸지 않는다.

| 단계 | 명령 | 확인하는 것 |
|---|---|---|
| 1 | `npm run test:prod` | #24(관리자 함수 직접 호출·admins), **#25**(초기화), **#27**(동작 기록) + 그동안의 #5·#6·#17·#22·권한 — 한 트랜잭션 안에서 검사하고 ROLLBACK |
| 2 | `npx supabase db advisors --remote ...` + 판정 | **#20**: 예외(관리자 함수 4개 + Leaked Password) 밖의 경고가 없는지 |

브라우저 콘솔 `fetch`로 직접 요청해 보는 방법은 3장(선택)에 참고로 남겨 둔다.

---

## 1단계. 운영 DB 롤백 검사 (`npm run test:prod`)

실행 방법(접속 문자열·인증서를 기록 없이 넣는 법)은 [m7-checklist.md](m7-checklist.md) 6-2와 같다.

```powershell
npm run test:prod
```

**통과 기준**
- `78개 통과, 0개 실패` (로컬 DB 기준 77개 + 운영에만 있는 `rls_auto_enable` 검사 1개)
- `관리자 초기화의 전역 잠금 유지 시간: N ms` — 로컬에서 16ms. 이 동안만 운영의 분석 요청이 기다린다.
- 마지막 줄 `ROLLBACK 완료, 운영 데이터 변경 없음` — ROLLBACK 뒤 트랜잭션 밖에서 임시 사용자, 임시 관리자 지정, 동작 기록, 초기화 기록, 호출 기록이 하나도 남지 않은 것까지 확인했을 때만 나온다.

**C3에서 더한 검사**

| # | 검사 |
|---|---|
| 24 | 일반 사용자 B의 관리자 함수 4개 → `FORBIDDEN`, `is_admin` B=false·A=true, anon 실행 불가, `admins`에서 B 0건·관리자도 자기 행만·B 자기 추가 불가·관리자도 삭제 불가, `ai_settings`·`ai_allowlist` 직접 쓰기 불가, 거부 뒤 관리자 표 그대로, 관리자 목록은 정해진 열만, 관리자 표 권한, `is_admin` INVOKER, 관리자 함수 4개 첫 문장이 관리자 확인 |
| 25 | 임시 B에 오늘 호출 4건 → 임시 관리자 A가 B 초기화 → B 남은 횟수 6→10, B 호출 기록 수·오늘 전체 건수 그대로, 사용자 한도 판정도 복구(`begin_ai_call` 통과), 전체 한도는 그대로(전체 한도 = 현재 건수면 `AI_GLOBAL_LIMIT`), `ai_quota_resets` 1건(`reset_by` = A) |
| 27 | `admin_actions`에 `quota_reset` 1건(actor = A, target = B, detail 없음), 이메일(`@`) 없음, 관리자·B 모두 읽기·추가 불가 |

- **잠금을 짧게**: 관리자 쓰기 함수(`admin_reset_ai_quota`)는 전역 잠금을 잡고 그 잠금은 ROLLBACK까지 유지된다. 그래서 다른 검사를 모두 끝낸 뒤 ROLLBACK 직전에 한 번만 부른다. 다른 관리자 쓰기 함수(모드 변경·허용)는 부르지 않는다.
- **로컬 확인(2026-11-04)**: 로컬 DB로 77개 통과. 초기화를 무시하도록 `ai_user_quota_start`를 깨뜨리면 #25 두 개가 실패하고, 되돌리면 다시 통과.

---

## 2단계. Security Advisor (#20) — CLI로 운영 확인

명령: `npx supabase db advisors --remote --type security --level info --output-format json`
(연결된 운영 프로젝트 대상. `db push --remote`가 되는 환경이면 그대로 된다. DB 비밀번호를 물으면 입력한다.)

아래를 PowerShell 창에 **붙여 넣어** 실행한다(파일로 저장해 실행하면 PowerShell 5.1이 한글을 깨뜨리므로 붙여 넣기를 권한다).

```powershell
function Test-Advisors([string]$Json) {
  $results = @(($Json | ConvertFrom-Json).results)
  $adminFns = @('admin_list_users', 'admin_reset_ai_quota', 'admin_set_ai_access_mode', 'admin_set_ai_allowed')
  $isException = {
    param($r)
    ($r.name -eq 'authenticated_security_definer_function_executable' -and $adminFns -contains $r.metadata.name) -or
    ($r.name -like '*leaked_password*') -or ($r.title -like '*Leaked Password*')
  }
  foreach ($r in $results) {
    $tag = if (& $isException $r) { '예외' } elseif ($r.level -eq 'INFO') { '참고' } else { '문제' }
    '{0}  {1,-5} {2}  {3}' -f $tag, $r.level, $r.name, $r.metadata.name
  }
  # INFO는 참고만(경고 아님). WARN·ERROR 중 예외 밖의 것이 하나라도 있으면 실패
  $bad = @($results | Where-Object { $_.level -ne 'INFO' -and -not (& $isException $_) })
  if ($bad.Count -eq 0) { "통과: 예외(관리자 함수 4개 + Leaked Password) 밖의 WARN·ERROR 없음" }
  else { "실패: 예외 밖 경고 $($bad.Count)건" }
}

$json = npx supabase db advisors --remote --type security --level info --output-format json 2>$null | Out-String
Test-Advisors $json
```

**판정 규칙**

| 결과 항목 | 판정 |
|---|---|
| `authenticated_security_definer_function_executable`(0029) + 함수 이름이 관리자 함수 4개 중 하나 | 예외 (PRD #20 비고) |
| 이름에 `leaked_password`가 들어가거나 제목이 "Leaked Password …" | 예외 (PRD #20 비고) |
| `rls_enabled_no_policy` — `admin_actions` (INFO) | 참고: 의도된 설계(정책 없이 RLS만 켬 → 사용자는 읽기·쓰기 불가, 관리자 함수만 기록). INFO는 경고가 아니다 |
| 그 밖의 WARN·ERROR (예: 관리자 함수가 아닌 함수의 DEFINER 노출, `function_search_path_mutable`) | **실패** |

- 관리자 함수 4개의 경고 이름(0029)은 Supabase 린터 문서로 확인했다. Leaked Password 경고는 정확한 이름을 문서로 확인하지 못해 이름·제목 둘 다로 넓게 맞춘다. 이 경고가 CLI 결과에 아예 없을 수도 있다(인증 설정 점검이라 DB 린터가 아닐 수 있음) — 그래도 통과다. 대시보드에서는 보인다.
- **로컬 확인(2026-11-04)**: 판정 함수를 표본 JSON으로 시험했다 — 예외만 있으면 통과, `function_search_path_mutable`이 섞이면 실패, 관리자 함수가 아닌 함수(`seed_sample_data`)의 DEFINER 경고면 실패. 로컬 DB(`--remote` 없이)는 `admin_actions` INFO 1건만 나와 통과. 단, 로컬 점검은 DEFINER 노출 경고(0029)를 내지 않으므로 이 부분은 운영에서만 확인된다.

---

## 3장(선택). 브라우저 콘솔 `fetch`로 직접 확인

1·2단계로 충분하다. 화면·API 동작을 눈으로 보고 싶을 때만 한다. 계정: **관리자**, **B**(일반 계정). 각 계정의 배포 주소 창 콘솔에 [s5-checklist.md](s5-checklist.md) 3-0b의 코드(`api()`, `fn()`)를 붙여 넣는다. 토큰은 그 창 밖으로 나가지 않는다.

| # | 어느 창 | 콘솔 명령 | 통과 기준 |
|---|---|---|---|
| 24 | B | `await api('POST', 'rpc/is_admin', {})` | `200 false` |
| 24 | B | `await api('POST', 'rpc/admin_list_users', {})` (나머지 관리자 함수도 같음) | `400` + `P0001` + `FORBIDDEN` |
| 24 | B | `await api('GET', 'admins?select=user_id')` | `200 []` |
| 24 | B | `await api('POST', 'admins', { user_id: ME.user.id })` | `403` + `42501` |
| 25 | B → 관리자 화면 → B | B `await api('POST', 'rpc/my_ai_remaining', {})` → 관리자 화면에서 B [횟수 초기화] → 다시 B | `remaining` R → 10 |
| 26 | B | (허용 목록 모드, B 미허용) `await fn({ application_id: '<B의 지원건 ID>' })` | `403 {"error":"AI_NOT_ALLOWED"}` — 끝나면 "전체 허용"으로 되돌린다 |
| 27 | 관리자·B | `await api('GET', 'admin_actions?select=id')` / `await api('POST', 'admin_actions', { actor_id: ME.user.id, action: 'quota_reset', target_user_id: ME.user.id })` | `403` + `42501` |

위 상태 코드는 같은 요청을 로컬 REST로 보내 확인했다(2026-11-04). SQL Editor로 오늘 기록을 보려면:

```sql
select created_at, actor_id, action, target_user_id, detail
  from public.admin_actions
 where created_at >= now() - interval '1 day'
 order by created_at;
```

---

## 4. 정리

- 3장을 했다면: 모드가 "허용 목록만"이면 "전체 허용"으로 되돌리고, 검증 계정 데이터를 지운다(SQL Editor).
  ```sql
  delete from public.applications    where user_id in ('관리자-ID', 'B의-ID');   -- 분석 결과도 함께 지워진다
  delete from public.profiles        where user_id in ('관리자-ID', 'B의-ID');
  delete from public.ai_usage        where user_id in ('관리자-ID', 'B의-ID');
  delete from public.ai_quota_resets where user_id in ('관리자-ID', 'B의-ID');
  delete from public.ai_allowlist    where user_id in ('관리자-ID', 'B의-ID');
  ```
- `admin_actions`는 운영 감사 기록이라 지우지 않는다(이메일 없이 사용자 ID만 있음). 관리자 지정(`admins`)도 그대로 둔다.
- 1·2단계만 했다면 정리할 것이 없다(1단계는 ROLLBACK, 2단계는 읽기만).

---

## 5. 결과 알려 주기

```
test:prod 78개 통과, 잠금 N ms, ROLLBACK 완료 / advisors 통과(예외 n건, 참고 n건)
실패가 있으면: 실패 줄 그대로
```
