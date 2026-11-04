-- my_ai_remaining()을 SECURITY INVOKER로 바꾼다.
-- 운영 Security Advisor: "Signed-In Users Can Execute SECURITY DEFINER Function" (authenticated가 DEFINER 함수를 실행)
--
-- DEFINER가 필요 없는 이유:
--   - 사용자는 ai_usage에서 본인 행을 RLS(ai_usage_select_own)로 조회할 수 있다 → 호출자 권한으로 세면 된다.
--   - DEFINER로 둔 이유는 내부 함수(counts_for_user, ai_daily_limits, ai_day_start)를 부르기 위해서였다.
--     이 세 함수는 표를 읽지 않는 순수 계산이라 authenticated에게 실행 권한을 줘도 알려 주는 정보가 없다
--     (인자로 받은 값과 now(), 상수만 쓴다). 그래서 실행 권한을 주고 my_ai_remaining은 INVOKER로 둔다.
-- begin_ai_call·finish_ai_call은 그대로 DEFINER + service_role 전용이다(ai_usage 쓰기 권한은 소유자에게만).

create or replace function public.my_ai_remaining(out remaining integer, out daily_limit integer)
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

  -- RLS가 본인 행만 보여 주지만, 조건에도 auth.uid()를 명시해 둔다
  select count(*) into used
    from public.ai_usage u
   where u.user_id = uid
     and u.called_at >= public.ai_day_start()
     and public.counts_for_user(u.result, u.failure_reason, u.called_at);

  remaining := greatest(daily_limit - used, 0);
end;
$$;

-- 실행 권한은 그대로: authenticated만 (create or replace는 권한을 유지하지만 명시해 둔다)
revoke execute on function public.my_ai_remaining() from public, anon, service_role;
grant execute on function public.my_ai_remaining() to authenticated;

-- INVOKER인 my_ai_remaining이 authenticated 권한으로 부르므로 실행 권한이 필요하다. 표를 읽지 않는 순수 계산.
grant execute on function public.ai_daily_limits() to authenticated;
grant execute on function public.ai_day_start() to authenticated;
grant execute on function public.counts_for_user(text, text, timestamptz) to authenticated;
