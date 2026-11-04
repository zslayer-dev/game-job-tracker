-- S2: AI 분석 결과·호출 기록 표와 한도 함수 (PRD 8장 AI 분석·입력, docs/design.md 2장·3장·4.2·4.3)
--
-- ai_analyses : 저장한 분석 결과. 본인만 조회·추가·삭제(수정 없음). 지원 건과 복합 FK로 묶여 함께 삭제된다.
-- ai_usage    : AI 호출 기록. 사용자는 본인 기록 조회만, 쓰기는 service_role이 부르는 함수(begin/finish)만.
-- 한도 기본값은 DB 한 곳(ai_daily_limits)에만 둔다. 판정(begin_ai_call)과 화면 표시(my_ai_remaining)가 같은 값을 쓴다.
--   begin_ai_call의 한도 인자는 로컬 테스트에서 낮출 때만 쓴다. 운영 Edge Function은 넘기지 않는다(null → 기본값).

-- ── 표 ──────────────────────────────────────────────────────────────────────

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null default auth.uid(),
  fit_score integer not null,
  matched_skills text[] not null default '{}',
  missing_skills text[] not null default '{}',
  comment text not null,
  created_at timestamptz not null default now(),
  -- 남의 지원 건에 내 분석을 붙일 수 없다. 지원 건을 지우면 분석도 지워진다.
  constraint ai_analyses_application_fk foreign key (application_id, user_id)
    references public.applications (id, user_id) on delete cascade,
  constraint ai_analyses_fit_score_range check (fit_score between 0 and 100),
  constraint ai_analyses_matched_skills_count check (cardinality(matched_skills) <= 30),
  constraint ai_analyses_missing_skills_count check (cardinality(missing_skills) <= 30),
  constraint ai_analyses_comment_not_blank check (comment ~ '[^[:space:]]'),
  constraint ai_analyses_comment_len check (char_length(comment) <= 2000)
);

-- 화면은 지원 건마다 최신 1건만 본다
create index ai_analyses_application_created_idx on public.ai_analyses (application_id, created_at desc);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  -- applications와 연결하지 않는다: 지원 건을 지워도 호출 기록(한도 집계)은 남아야 한다
  user_id uuid not null references auth.users (id) on delete cascade,
  called_at timestamptz not null default now(),
  result text not null,
  failure_reason text null,
  constraint ai_usage_result_check check (result in ('진행 중', '성공', '실패')),
  constraint ai_usage_failure_reason_check check (failure_reason in ('AI 오류', '시간 초과', '형식 오류')),
  -- 실패일 때만 사유가 있다
  constraint ai_usage_reason_iff_failed check ((result = '실패') = (failure_reason is not null))
);

create index ai_usage_called_at_idx on public.ai_usage (called_at);
create index ai_usage_user_called_at_idx on public.ai_usage (user_id, called_at);

-- ── 권한 ─────────────────────────────────────────────────────────────────────
-- 운영("새 표 자동 노출" 끔)과 로컬이 같은 결과가 되도록 모두 명시한다(design.md 3.0).
-- service_role도 표 권한을 주지 않는다: Edge Function은 표에 직접 쓰지 않고 SECURITY DEFINER 함수만 부른다.
-- (운영은 자동 노출이 꺼져 있어 원래 없고, 로컬 기본 권한도 회수해 운영과 같게 만든다)

alter table public.ai_analyses enable row level security;
alter table public.ai_usage enable row level security;

create policy ai_analyses_select_own on public.ai_analyses
  for select to authenticated using ((select auth.uid()) = user_id);
create policy ai_analyses_insert_own on public.ai_analyses
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ai_analyses_delete_own on public.ai_analyses
  for delete to authenticated using ((select auth.uid()) = user_id);
-- update 정책 없음: 분석 결과는 고치지 않는다(권한도 주지 않음)

create policy ai_usage_select_own on public.ai_usage
  for select to authenticated using ((select auth.uid()) = user_id);
-- insert/update/delete 정책 없음 + 권한 없음

revoke all on table public.ai_analyses from anon, authenticated, service_role;
revoke all on table public.ai_usage from anon, authenticated, service_role;
grant select, insert, delete on table public.ai_analyses to authenticated;
grant select on table public.ai_usage to authenticated;

-- ── 함수 ─────────────────────────────────────────────────────────────────────

-- 한도 기본값의 유일한 정의. 바꾸려면 마이그레이션으로 이 함수를 교체한다.
create function public.ai_daily_limits(out user_limit integer, out global_limit integer)
language sql
immutable
set search_path = ''
as $$
  select 10, 100;
$$;

-- 오늘 시작 시각 = 한국 시간(KST) 자정
create function public.ai_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
$$;

-- 사용자 횟수에 넣는 기록인가 (design.md 4.2 집계 규칙 표). 전체 횟수는 사유와 무관하게 모두 센다.
--   진행 중 2분 이내 / 성공 / 실패(형식 오류) → 센다
--   진행 중 2분 지남(=시간 초과 간주) / 실패(AI 오류) / 실패(시간 초과) → 빼 준다
-- 표를 읽지 않는 계산 함수라 STABLE(now() 사용).
create function public.counts_for_user(p_result text, p_failure_reason text, p_called_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_result
    when '진행 중' then p_called_at > now() - interval '2 minutes'
    when '성공' then true
    when '실패' then p_failure_reason = '형식 오류'
    else false
  end;
$$;

-- 한도 판정 + "진행 중" 기록을 한 번에 (design.md 4.2). Edge Function이 service_role로 부른다.
--   p_user_id: Edge Function이 검증된 JWT에서 얻은 값만 넘긴다.
--   p_user_limit, p_global_limit: null이면 DB 기본값. 로컬 테스트에서 낮출 때만 넘긴다.
-- SECURITY DEFINER: ai_usage 쓰기 권한은 함수 소유자에게만 있다.
-- VOLATILE(기본값) 유지: 잠금을 기다리는 동안 다른 호출이 커밋한 행을 봐야 한다.
create function public.begin_ai_call(p_user_id uuid, p_user_limit integer default null, p_global_limit integer default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_limit integer;
  global_limit integer;
  day_start timestamptz;
  user_used integer;
  global_used integer;
  new_id uuid;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select coalesce(p_user_limit, l.user_limit), coalesce(p_global_limit, l.global_limit)
    into user_limit, global_limit
    from public.ai_daily_limits() l;

  -- 전역 잠금 하나로 모든 사용자의 판정을 직렬화한다 → 사용자 한도와 전체 한도가 함께 지켜진다(#13, #14)
  perform pg_advisory_xact_lock(hashtextextended('ai_quota', 0));

  day_start := public.ai_day_start();

  -- 사용자 한도를 먼저 본다(본인이 다 썼으면 본인 문구가 더 정확)
  select count(*) into user_used
    from public.ai_usage u
   where u.user_id = p_user_id
     and u.called_at >= day_start
     and public.counts_for_user(u.result, u.failure_reason, u.called_at);
  if user_used >= user_limit then
    raise exception 'AI_USER_LIMIT' using errcode = 'P0001';
  end if;

  select count(*) into global_used
    from public.ai_usage u
   where u.called_at >= day_start;
  if global_used >= global_limit then
    raise exception 'AI_GLOBAL_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.ai_usage (user_id, result) values (p_user_id, '진행 중') returning id into new_id;
  return new_id;
end;
$$;

-- 결과 기록 (design.md 4.3). "진행 중"인 행만 고친다(중복 갱신 방지). 고쳤으면 true.
-- 시작한 지 2분이 지났으면 요청 값과 무관하게 실패(시간 초과)로 기록한다
-- → 늦게 끝난 호출이 "성공"으로 바뀌어 사용자 횟수에 다시 잡히지 않게.
create function public.finish_ai_call(p_id uuid, p_result text, p_failure_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_result not in ('성공', '실패') then
    raise exception 'INVALID_RESULT' using errcode = 'P0001';
  end if;

  update public.ai_usage u
     set result = case when u.called_at <= now() - interval '2 minutes' then '실패' else p_result end,
         failure_reason = case when u.called_at <= now() - interval '2 minutes' then '시간 초과' else p_failure_reason end
   where u.id = p_id
     and u.result = '진행 중';
  return found;
end;
$$;

-- 화면 표시용: 오늘 내 남은 횟수와 하루 한도. 판정(begin_ai_call)과 같은 기본값·집계 규칙을 쓴다.
-- SECURITY DEFINER(내부 함수 counts_for_user를 부르기 위해)라 RLS를 거치지 않으므로
-- 오직 auth.uid() 기준으로만 센다. 인자로 사용자를 받지 않는다.
create function public.my_ai_remaining(out remaining integer, out daily_limit integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  used integer;
begin
  if uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select l.user_limit into daily_limit from public.ai_daily_limits() l;

  select count(*) into used
    from public.ai_usage u
   where u.user_id = uid
     and u.called_at >= public.ai_day_start()
     and public.counts_for_user(u.result, u.failure_reason, u.called_at);

  remaining := greatest(daily_limit - used, 0);
end;
$$;

-- 실행 권한: 기본 PUBLIC 실행 권한을 회수하고 필요한 역할에만 준다(design.md 3.1)
revoke execute on function public.ai_daily_limits() from public, anon, authenticated, service_role;
revoke execute on function public.ai_day_start() from public, anon, authenticated, service_role;
revoke execute on function public.counts_for_user(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function public.begin_ai_call(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.finish_ai_call(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.my_ai_remaining() from public, anon, service_role;

grant execute on function public.begin_ai_call(uuid, integer, integer) to service_role;
grant execute on function public.finish_ai_call(uuid, text, text) to service_role;
grant execute on function public.my_ai_remaining() to authenticated;
