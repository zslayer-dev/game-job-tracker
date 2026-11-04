-- C1: 관리자 페이지(Could) — 관리자 표·함수, AI 사용 권한, 사용 횟수 초기화
-- (PRD 5장 Could 7, 7장, 8장 / docs/design.md 2장 관리자 관련 표, 3장, 4.2, 4.5)
--
-- 원칙
--   - 관리자 지정은 SQL Editor로만(admins에 사용자 쓰기 권한 없음).
--   - 관리자 기능은 모두 DB 함수에서 is_admin()으로 확인한다. 화면 숨김은 보안이 아니다.
--   - DEFINER는 관리자 함수 4개뿐(가입자 목록은 auth.users를 읽어야 하고, 쓰기는 사용자 쓰기 권한이 없는 표에 해야 함).
--     4개 모두 본문 첫 문장이 관리자 확인이다. is_admin()은 INVOKER(admins 본인 행 조회 RLS).
--   - 초기화는 ai_usage를 지우지 않고 ai_quota_resets에 남긴다. 사용자 횟수는 오늘 마지막 초기화 이후만 세고,
--     전체 100회 상한은 그대로 오늘 기록을 모두 센다.
--   - AI 허용은 begin_ai_call 안에서 판정한다(AI 호출 전, 기록 전 → 횟수에 들어가지 않음). 모드 기본값은 'all'.
--   - 관리자 동작(허용·해제, 초기화, 모드 변경)은 admin_actions에 user_id만 남긴다(이메일 등 개인정보 없음).

-- ── 표 ──────────────────────────────────────────────────────────────────────

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 서비스 전체에 1행
create table public.ai_settings (
  id boolean primary key default true,
  access_mode text not null default 'all',
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  constraint ai_settings_singleton check (id),
  constraint ai_settings_access_mode_check check (access_mode in ('all', 'allowlist'))
);
insert into public.ai_settings (id) values (true);

create table public.ai_allowlist (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid not null
);

create table public.ai_quota_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reset_at timestamptz not null default now(),
  reset_by uuid not null
);
create index ai_quota_resets_user_reset_idx on public.ai_quota_resets (user_id, reset_at);

-- actor_id·target_user_id는 외래키 없이 uuid만: 탈퇴 후에도 기록은 남고, 개인정보(이메일)는 남기지 않는다
create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null,
  target_user_id uuid null,
  detail jsonb null,
  created_at timestamptz not null default now(),
  constraint admin_actions_action_check check (action in ('ai_allow', 'ai_disallow', 'quota_reset', 'mode_change')),
  constraint admin_actions_target_check check ((action = 'mode_change') = (target_user_id is null))
);
create index admin_actions_created_idx on public.admin_actions (created_at);

-- ── 권한 ─────────────────────────────────────────────────────────────────────
-- 운영("새 표 자동 노출" 끔)과 로컬이 같은 결과가 되도록 모두 명시한다(design.md 3.0).

alter table public.admins enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_allowlist enable row level security;
alter table public.ai_quota_resets enable row level security;
alter table public.admin_actions enable row level security;

-- 본인 행만 조회(= 내가 관리자인지). 다른 사람의 행은 보이지 않는다.
create policy admins_select_own on public.admins
  for select to authenticated using ((select auth.uid()) = user_id);
-- 모드는 비밀이 아니다(my_ai_remaining이 읽는다)
create policy ai_settings_select_all on public.ai_settings
  for select to authenticated using (true);
create policy ai_allowlist_select_own on public.ai_allowlist
  for select to authenticated using ((select auth.uid()) = user_id);
create policy ai_quota_resets_select_own on public.ai_quota_resets
  for select to authenticated using ((select auth.uid()) = user_id);
-- admin_actions: 정책 없음

revoke all on table public.admins, public.ai_settings, public.ai_allowlist, public.ai_quota_resets, public.admin_actions
  from anon, authenticated, service_role;
grant select on table public.admins, public.ai_settings, public.ai_allowlist, public.ai_quota_resets to authenticated;

-- ── 판정 보조 함수 (INVOKER) ────────────────────────────────────────────────
-- begin_ai_call·admin_list_users(DEFINER, 소유자 권한)와 my_ai_remaining(INVOKER, RLS)이 같은 정의를 쓴다.
-- INVOKER라 일반 사용자가 남의 user_id를 넣어도 RLS로 남의 행은 보이지 않는다(남의 초기화·허용 여부를 알 수 없음).

-- AI 사용 허용 여부: 모드 'all'이면 모두, 'allowlist'면 목록에 있는 사용자만
create function public.ai_user_allowed(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select s.access_mode from public.ai_settings s where s.id), 'all') = 'all'
      or exists (select 1 from public.ai_allowlist a where a.user_id = p_user_id);
$$;

-- 사용자 횟수를 세기 시작하는 시각: 오늘 시작(KST 자정)과 오늘 마지막 초기화 중 늦은 쪽
create function public.ai_user_quota_start(p_user_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select greatest(
    public.ai_day_start(),
    coalesce((select max(r.reset_at) from public.ai_quota_resets r where r.user_id = p_user_id), public.ai_day_start())
  );
$$;

-- 관리자인가 (본인만, 인자 없음). INVOKER: admins 본인 행 조회 RLS로 판단한다.
create function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

-- ── 한도 판정 교체 (design.md 4.2) ──────────────────────────────────────────

create or replace function public.begin_ai_call(p_user_id uuid, p_user_limit integer default null, p_global_limit integer default null)
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

  -- 전역 잠금 하나로 모든 사용자의 판정과 관리자 변경(허용·초기화·모드)을 직렬화한다
  perform pg_advisory_xact_lock(hashtextextended('ai_quota', 0));

  -- AI 사용 권한(Could, #26): 기록 전에 거부 → 사용자·전체 횟수에 들어가지 않고 AI도 호출하지 않는다
  if not public.ai_user_allowed(p_user_id) then
    raise exception 'AI_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  day_start := public.ai_day_start();

  -- 사용자 한도: 오늘 마지막 초기화 이후만 센다(Could, #25)
  select count(*) into user_used
    from public.ai_usage u
   where u.user_id = p_user_id
     and u.called_at >= public.ai_user_quota_start(p_user_id)
     and public.counts_for_user(u.result, u.failure_reason, u.called_at);
  if user_used >= user_limit then
    raise exception 'AI_USER_LIMIT' using errcode = 'P0001';
  end if;

  -- 전체 한도: 초기화와 무관하게 오늘 기록을 모두 센다(비용 안전장치)
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

-- 화면 표시: 반환 컬럼(allowed)이 늘어 create or replace가 안 되므로 다시 만든다
drop function public.my_ai_remaining();

create function public.my_ai_remaining(out remaining integer, out daily_limit integer, out allowed boolean)
language plpgsql
stable
security invoker
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

  -- begin_ai_call과 같은 규칙(초기화 이후, 집계 규칙). RLS가 본인 행만 보여 주지만 조건에도 명시한다.
  select count(*) into used
    from public.ai_usage u
   where u.user_id = uid
     and u.called_at >= public.ai_user_quota_start(uid)
     and public.counts_for_user(u.result, u.failure_reason, u.called_at);

  remaining := greatest(daily_limit - used, 0);
  allowed := public.ai_user_allowed(uid);
end;
$$;

-- ── 관리자 함수 (DEFINER, 첫 문장 관리자 확인, design.md 4.5) ───────────────
-- 선언부에 초기값을 두지 않는다: 관리자 확인보다 먼저 실행되는 코드가 없게 한다.

create function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  application_count integer,
  ai_used_today integer,
  ai_daily_limit integer,
  ai_allowed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 지원 건은 개수만. 내용·프로필·분석 결과는 돌려주지 않는다(PRD 8장)
  return query
    select u.id,
           u.email::text,
           u.created_at,
           u.last_sign_in_at,
           (select count(*)::integer from public.applications a where a.user_id = u.id),
           (select count(*)::integer
              from public.ai_usage g
             where g.user_id = u.id
               and g.called_at >= public.ai_user_quota_start(u.id)
               and public.counts_for_user(g.result, g.failure_reason, g.called_at)),
           (select l.user_limit from public.ai_daily_limits() l),
           public.ai_user_allowed(u.id)
      from auth.users u
     order by u.created_at desc;
end;
$$;

create function public.admin_set_ai_access_mode(p_mode text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  old_mode text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_mode is null or p_mode not in ('all', 'allowlist') then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota', 0));

  select s.access_mode into old_mode from public.ai_settings s where s.id for update;
  if old_mode = p_mode then
    return false; -- 바뀐 것이 없으면 기록하지 않는다
  end if;

  update public.ai_settings s
     set access_mode = p_mode, updated_at = now(), updated_by = auth.uid()
   where s.id;
  insert into public.admin_actions (actor_id, action, detail)
  values (auth.uid(), 'mode_change', jsonb_build_object('from', old_mode, 'to', p_mode));
  return true;
end;
$$;

create function public.admin_set_ai_allowed(p_user_id uuid, p_allowed boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_allowed is null then
    raise exception 'VALIDATION' using errcode = 'P0001';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota', 0));

  if p_allowed then
    insert into public.ai_allowlist (user_id, granted_by) values (p_user_id, auth.uid())
      on conflict (user_id) do nothing;
  else
    delete from public.ai_allowlist a where a.user_id = p_user_id;
  end if;
  get diagnostics changed = row_count;

  if changed = 0 then
    return false; -- 이미 그 상태면 기록하지 않는다
  end if;
  insert into public.admin_actions (actor_id, action, target_user_id)
  values (auth.uid(), case when p_allowed then 'ai_allow' else 'ai_disallow' end, p_user_id);
  return true;
end;
$$;

create function public.admin_reset_ai_quota(p_user_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  reset_time timestamptz;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota', 0));

  -- ai_usage는 지우지 않는다. 초기화 시점만 남긴다.
  insert into public.ai_quota_resets (user_id, reset_by) values (p_user_id, auth.uid())
    returning reset_at into reset_time;
  insert into public.admin_actions (actor_id, action, target_user_id)
  values (auth.uid(), 'quota_reset', p_user_id);
  return reset_time;
end;
$$;

-- ── 실행 권한 ────────────────────────────────────────────────────────────────

revoke execute on function public.ai_user_allowed(uuid) from public, anon, service_role;
revoke execute on function public.ai_user_quota_start(uuid) from public, anon, service_role;
revoke execute on function public.is_admin() from public, anon, service_role;
revoke execute on function public.my_ai_remaining() from public, anon, service_role;
revoke execute on function public.admin_list_users() from public, anon, service_role;
revoke execute on function public.admin_set_ai_access_mode(text) from public, anon, service_role;
revoke execute on function public.admin_set_ai_allowed(uuid, boolean) from public, anon, service_role;
revoke execute on function public.admin_reset_ai_quota(uuid) from public, anon, service_role;

grant execute on function public.ai_user_allowed(uuid) to authenticated;
grant execute on function public.ai_user_quota_start(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_ai_remaining() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_ai_access_mode(text) to authenticated;
grant execute on function public.admin_set_ai_allowed(uuid, boolean) to authenticated;
grant execute on function public.admin_reset_ai_quota(uuid) to authenticated;
