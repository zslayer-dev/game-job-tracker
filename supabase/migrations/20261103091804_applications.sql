-- M2: applications 표, 제약, 트리거, RLS, 권한 (docs/design.md 2·3장)
--
-- 운영 프로젝트는 "새 표 자동 노출" 끔 / "자동 RLS" 켬이고, 로컬 스택은 Supabase 기본값(새 표에 권한 자동 부여)이다.
-- 두 환경이 같은 결과가 되도록 권한과 RLS를 대시보드 설정에 기대지 않고 여기서 모두 명시한다.

-- ---------------------------------------------------------------------------
-- 기본 권한: 앞으로 public에 만드는 객체에 anon 권한이 자동으로 붙지 않게 한다
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- ---------------------------------------------------------------------------
-- 표
-- ---------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company text not null,
  position text not null,
  channel text,
  status text not null default '관심',
  applied_at date,
  deadline date,
  posting_text text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 제약 이름은 화면 오류 문구를 고르는 데 쓴다(design.md 7.8)
  constraint applications_company_not_blank check (length(btrim(company)) > 0),
  constraint applications_position_not_blank check (length(btrim(position)) > 0),
  constraint applications_channel_valid check (
    channel in ('게임잡', '원티드', '잡코리아', '리멤버', '헤드헌터', '직접 지원', '기타')
  ),
  constraint applications_status_valid check (
    status in ('관심', '지원 완료', '서류 통과', '과제·코테', '면접', '최종 합격', '불합격', '포기')
  ),
  constraint applications_posting_text_len check (char_length(posting_text) <= 8000),
  constraint applications_memo_len check (char_length(memo) <= 5000),
  -- ai_analyses의 복합 외래키 대상 (S2)
  constraint applications_id_user_id_key unique (id, user_id)
);

-- 목록 정렬(지원일 최신순, 빈 값 맨 아래, 그 안에서 생성 최신순)과 같은 순서
create index applications_user_list_idx
  on public.applications (user_id, applied_at desc nulls last, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 사용자당 500건 상한
--   사용자별 advisory lock을 잡은 뒤 센다 → 499건에서 동시 추가 2건이 둘 다 통과하지 못한다.
--   잠금 키 'apps:<user_id>'는 seed_sample_data()(M5)와 같은 키다.
--   VOLATILE(기본값) 유지: STABLE이면 잠금을 기다리는 동안 커밋된 행을 보지 못해 옛 개수를 센다.
-- ---------------------------------------------------------------------------
create function public.enforce_application_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('apps:' || new.user_id::text, 0));

  if (select count(*) from public.applications where user_id = new.user_id) >= 500 then
    raise exception 'APP_LIMIT' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger applications_enforce_limit
  before insert on public.applications
  for each row execute function public.enforce_application_limit();

-- 트리거 함수는 직접 호출할 일이 없다
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_application_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: 본인 행만 (자동 RLS에 기대지 않고 명시)
-- ---------------------------------------------------------------------------
alter table public.applications enable row level security;

create policy applications_select_own on public.applications
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy applications_insert_own on public.applications
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- using + with check: 남의 행은 못 고치고, 내 행의 소유자를 남으로 바꾸지도 못한다
create policy applications_update_own on public.applications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy applications_delete_own on public.applications
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 표 권한: 로컬 기본 권한을 모두 걷어내고 필요한 것만 명시 GRANT
--   운영은 "새 표 자동 노출"이 꺼져 있어 이 GRANT가 없으면 로그인 사용자도 permission denied가 난다.
--   anon에게는 아무 권한도 없다 → 로그아웃 요청은 RLS 전에 권한 오류로 거부(#6).
-- ---------------------------------------------------------------------------
revoke all on table public.applications from anon, authenticated;
grant select, insert, update, delete on table public.applications to authenticated;
