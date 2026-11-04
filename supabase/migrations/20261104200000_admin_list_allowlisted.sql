-- C2: 관리자 화면용으로 admin_list_users()에 ai_allowlisted(허용 목록에 있는지) 열을 추가한다.
-- ai_allowed는 "실제 허용 여부"(전체 허용 모드에서는 모두 true)라, 화면이 허용 목록 구성원과
-- "허용 목록이 비었는지"(모드 전환 경고)를 알 수 없었다. ai_allowlist는 RLS로 본인 행만 보이므로 이 함수로 돌려준다.
-- 반환 열이 바뀌어 create or replace가 안 되므로 지우고 다시 만든다(권한도 다시 준다).
-- 규칙은 그대로: SECURITY DEFINER, search_path = '', 본문 첫 문장 관리자 확인, authenticated만 실행.

drop function public.admin_list_users();

create function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  application_count integer,
  ai_used_today integer,
  ai_daily_limit integer,
  ai_allowed boolean,
  ai_allowlisted boolean
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
           public.ai_user_allowed(u.id),
           exists (select 1 from public.ai_allowlist w where w.user_id = u.id)
      from auth.users u
     order by u.created_at desc;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon, service_role;
grant execute on function public.admin_list_users() to authenticated;
