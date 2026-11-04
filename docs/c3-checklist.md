# C3 — Could(관리자 기능) 검증 체크리스트

배포 주소: **https://game-job-tracker.vercel.app**
대상: PRD 10장 #24~#27, #20(Could 반영 후 Security Advisor).
이미 통과(2026-11-04, 배포 주소): **#24 화면**(관리자 메뉴는 관리자에게만, 일반 계정 `/admin` → "권한이 없습니다"), **#26**(허용 목록 모드에서 목록 밖 B 차단·상세 화면 안내·버튼 비활성).

> 계정: **관리자**(SQL Editor로 `admins`에 넣은 본인 계정), **B**(일반 계정). 검증용 계정 데이터는 끝나면 5장대로 정리한다.
> 요청은 [s5-checklist.md](s5-checklist.md) **3-0b**와 같은 **브라우저 콘솔 `fetch`** 방식으로 한다. 각 계정의 배포 주소 창 콘솔에 3-0b의 코드(`api()`, `fn()`)를 붙여 넣어 두고, 사용자 ID를 서로 옮겨 적는다. 토큰은 그 창 밖으로 나가지 않는다.

---

## 1. 항목별 확인 방법

| # | 내용 | 배포 주소에서 | 로컬 테스트로 대신 (이미 통과) |
|---|---|---|---|
| 24 | 일반 사용자 거부, 자기 자신을 관리자로 못 만듦 | 화면은 통과. **2장** 콘솔로 관리자 함수 직접 호출·`admins` 조회·추가 + **4장** `npm run test:prod` | `tests/c1-admin.test.mjs` #24, `tests/e2e/admin.spec.mjs` |
| 25 | 초기화 후 사용자 횟수만 복구, 전체 유지, 기록 보존 | **3-1** B의 남은 횟수 전후(콘솔) + 호출 기록·전체 건수 전후(SQL Editor). 초기화 동작 자체는 이미 확인 | `tests/c1-admin.test.mjs` #25 — 전체 한도 판정이 초기화와 무관한지(전체 한도 = 현재 건수면 거부)는 운영에서 한도를 낮출 수 없어 로컬로 대신 |
| 26 | 허용 목록 모드 미허용 사용자 AI 호출 전 거부 | **통과**(위). 함수 응답 코드까지 보려면 3-2(선택) | `tests/c1-admin.test.mjs` #26(기록·횟수 증가 없음), `tests/s3-analyze-posting.test.mjs` #26(403), `tests/e2e/admin.spec.mjs` |
| 27 | 관리자 동작 기록, 화면·API로 읽기·수정·삭제 불가 | **3-3** SQL Editor로 오늘 기록 확인 + 콘솔로 읽기·쓰기 시도 + 4장 | `tests/c1-admin.test.mjs` #27(바뀐 것이 없으면 기록 안 함, 수정·삭제 불가), `tests/e2e/admin.spec.mjs` |
| 20 | Security Advisor (Could 반영 후) | 대시보드 → Advisors | 로컬 테스트: DEFINER 노출은 관리자 함수 4개뿐 |

---

## 2. #24 일반 사용자 B의 직접 호출 (콘솔, AI 호출 없음)

| 요청 | 어느 창 | 콘솔 명령 | 통과 기준 |
|---|---|---|---|
| 관리자 여부 | B | `await api('POST', 'rpc/is_admin', {})` | `200 false` |
| 관리자 여부 | 관리자 | `await api('POST', 'rpc/is_admin', {})` | `200 true` |
| 유저 목록 | B | `await api('POST', 'rpc/admin_list_users', {})` | `400` + `"code":"P0001"` + `"message":"FORBIDDEN"` (목록 없음) |
| 모드 변경 | B | `await api('POST', 'rpc/admin_set_ai_access_mode', { p_mode: 'allowlist' })` | `400` + `FORBIDDEN` |
| 허용 목록에 자기 추가 | B | `await api('POST', 'rpc/admin_set_ai_allowed', { p_user_id: ME.user.id, p_allowed: true })` | `400` + `FORBIDDEN` |
| 자기 횟수 초기화 | B | `await api('POST', 'rpc/admin_reset_ai_quota', { p_user_id: ME.user.id })` | `400` + `FORBIDDEN` |
| admins 조회 | B | `await api('GET', 'admins?select=user_id')` | `200 []` |
| admins 조회 | 관리자 | `await api('GET', 'admins?select=user_id')` | `200` + 자기 행 1건만 |
| 자기 자신을 관리자로 | B | `await api('POST', 'admins', { user_id: ME.user.id })` | `403` + `42501` |
| 모드 직접 변경 | B | `await api('PATCH', 'ai_settings?id=eq.true', { access_mode: 'allowlist' })` | `403` + `42501` |
| 허용 목록 직접 추가 | B | `await api('POST', 'ai_allowlist', { user_id: ME.user.id, granted_by: ME.user.id })` | `403` + `42501` |

끝난 뒤 관리자 화면에서 모드·허용 목록·B의 오늘 AI가 바뀌지 않았는지 본다.

---

## 3. 운영 확인

### 3-1. #25 초기화: 사용자 횟수만 복구, 전체·기록은 그대로

1) B가 오늘 분석 기록이 없으면 B 창에서 AI 분석을 1회 한다(AI 1회 비용). 이미 초기화한 뒤라도 그 뒤 기록이 있으면 된다.
2) 전:
   - B 창: `await api('POST', 'rpc/my_ai_remaining', {})` → `remaining` = R (R < 10)
   - SQL Editor:
     ```sql
     select
       (select count(*) from public.ai_usage where user_id = 'B의-사용자-ID') as b_rows,
       (select count(*) from public.ai_usage
         where called_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as today_all;
     ```
3) 관리자 화면에서 B의 [횟수 초기화] → 확인
4) 후:
   - B 창: `my_ai_remaining` → **`remaining` 10, `allowed` true**
   - 관리자 화면: B의 오늘 AI **0 / 10**
   - SQL Editor 같은 쿼리: **`b_rows`·`today_all` 둘 다 2)와 같음** (기록을 지우지 않았고 전체 횟수도 그대로)

### 3-2. (선택) #26 함수 응답 코드

관리자 화면에서 "허용 목록만"으로 바꾸고(목록에 B 없음), B 창에서:

```js
await fn({ application_id: '<B의 지원건 ID>' })
```

→ `403 {"error":"AI_NOT_ALLOWED"}`, B의 `my_ai_remaining`은 그대로. 끝나면 **"전체 허용"으로 되돌린다.**

### 3-3. #27 관리자 동작 기록

SQL Editor(오늘 검증한 동작이 순서대로 보여야 한다):

```sql
select created_at, actor_id, action, target_user_id, detail
  from public.admin_actions
 where created_at >= now() - interval '1 day'
 order by created_at;
```

| 확인 | 통과 기준 |
|---|---|
| 동작 | 오늘 한 허용·해제(`ai_allow`/`ai_disallow`), 초기화(`quota_reset`), 모드 변경(`mode_change`)이 시각 순서로 있다 |
| 누가 | `actor_id` = 관리자 사용자 ID |
| 대상 | 허용·해제·초기화는 `target_user_id` = 대상 사용자 ID, 모드 변경은 비어 있고 `detail`에 `{"from":…, "to":…}` |
| 개인정보 | 어느 열에도 이메일이 없다 |
| 2장의 거부된 호출 | B의 거부된 호출은 기록되지 않았다 |

콘솔(관리자 창과 B 창 각각):

| 요청 | 콘솔 명령 | 통과 기준 |
|---|---|---|
| 읽기 | `await api('GET', 'admin_actions?select=id')` | `403` + `42501` (관리자도) |
| 추가 | `await api('POST', 'admin_actions', { actor_id: ME.user.id, action: 'quota_reset', target_user_id: ME.user.id })` | `403` + `42501` |
| 삭제 | `await api('DELETE', 'admin_actions?actor_id=eq.' + ME.user.id)` | `403` + `42501` |

---

## 4. 운영 DB 롤백 검사 다시 실행

[m7-checklist.md](m7-checklist.md) 6-2와 같은 방법으로 `npm run test:prod`.

- C3에서 관리자 검사를 추가했다: 일반 사용자 B의 관리자 함수 4개 → FORBIDDEN, `is_admin` B=false·A=true, anon 실행 불가, `admins`에서 B 0건·관리자도 자기 행만·B 자기 추가 불가·관리자도 삭제 불가, `ai_settings`·`ai_allowlist` 직접 쓰기 불가, `admin_actions` 관리자·B 모두 읽기·쓰기 불가, 관리자 목록은 정해진 열만, 거부 뒤 관리자 표 불변, 관리자 표 권한, `is_admin` INVOKER, 관리자 함수 4개 첫 문장 확인.
- 트랜잭션 안에서만 A를 관리자로 만들고 ROLLBACK 한다. 관리자의 쓰기 함수는 부르지 않는다(전역 잠금 때문에 운영의 분석 요청을 잠시 기다리게 만들 수 있어서).
- 로컬 DB 기준 **70개**. 운영은 `rls_auto_enable` 검사가 하나 더 돌아 **71개**가 나와야 한다. 마지막 줄 `ROLLBACK 완료, 운영 데이터 변경 없음`.
- 로컬에서 `admins`에 사용자 추가·삭제 권한을, `admin_actions`에 조회 권한을 준 상태로 돌리면 5개가 실패해 검사가 문제를 잡는 것을 확인했다.

---

## 5. 정리

- 모드가 "허용 목록만"이면 관리자 화면에서 **"전체 허용"으로 되돌린다.** B를 허용 목록에서 뺀다(필요하면).
- 검증용 계정 데이터(CLAUDE.md 규칙) — SQL Editor:
  ```sql
  delete from public.applications    where user_id in ('관리자-ID', 'B의-ID');   -- 분석 결과도 함께 지워진다
  delete from public.profiles        where user_id in ('관리자-ID', 'B의-ID');
  delete from public.ai_usage        where user_id in ('관리자-ID', 'B의-ID');
  delete from public.ai_quota_resets where user_id in ('관리자-ID', 'B의-ID');
  delete from public.ai_allowlist    where user_id in ('관리자-ID', 'B의-ID');
  ```
- `admin_actions`는 운영 감사 기록이라 지우지 않는다(이메일 없이 사용자 ID만 있음). 관리자 지정(`admins`)도 그대로 둔다.
- 콘솔 창은 로그아웃 후 닫는다.

---

## 6. 결과 알려 주기

```
#24 API 통과 / #25 통과(B 남은 R→10, b_rows·today_all 그대로) / #27 통과(기록 n건, 이메일 없음, 콘솔 403) / #20 통과(관리자 함수 4개 + Leaked Password) / test:prod 71개 통과
실패가 있으면: #번호 — 실제로 본 상태 코드·본문 또는 화면
```
