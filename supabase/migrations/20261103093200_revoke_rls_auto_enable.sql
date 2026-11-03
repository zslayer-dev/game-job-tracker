-- 운영 프로젝트의 "자동 RLS" 옵션이 만든 SECURITY DEFINER 함수 public.rls_auto_enable()을
-- anon·authenticated가 직접 실행할 수 있다는 Security Advisor 경고(#20) 대응.
-- 이벤트 트리거로 실행되는 함수라 실행 권한을 회수해도 자동 RLS 동작에는 영향이 없다.
-- 로컬 스택에는 이 함수가 없으므로 있을 때만 회수한다.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
