-- S1: 경력 프로필 (PRD 7장 profiles, 8장 입력, docs/design.md 2장 profiles·3장 권한·4.1 샘플)
--
-- profiles: 사용자당 1개(user_id가 기본 키). 본인 것만 조회·추가·수정·삭제(RLS 4개 정책).
-- 상한(DB로도 막는다): summary·strengths·gaps 각 2,000자, engines·skills 각 30개, 항목은 1~50자이고 공백(줄바꿈·탭 포함)만으로 된 항목은 거부.
--   - 글자 수·개수는 CHECK 제약.
--   - 배열 항목 검사는 CHECK에 서브쿼리를 쓸 수 없어 BEFORE 트리거로 한다.
--     CHECK에 함수를 쓰면 그 함수에 authenticated 실행 권한을 줘야 해서 API로 노출되므로, 실행 권한이 필요 없는 트리거를 쓴다.
--     오류는 CHECK 위반과 같은 형식(23514 + 제약 이름)으로 내서 화면이 같은 방식으로 필드를 찾는다.

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  summary text null,
  engines text[] not null default '{}',
  skills text[] not null default '{}',
  strengths text null,
  gaps text null,
  updated_at timestamptz not null default now(),
  constraint profiles_summary_len check (char_length(summary) <= 2000),
  constraint profiles_strengths_len check (char_length(strengths) <= 2000),
  constraint profiles_gaps_len check (char_length(gaps) <= 2000),
  constraint profiles_engines_count check (cardinality(engines) <= 30),
  constraint profiles_skills_count check (cardinality(skills) <= 30)
);

create function public.validate_profile_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.engines) as t(v) where v is null or v !~ '[^[:space:]]' or char_length(v) > 50) then
    raise exception 'new row for relation "profiles" violates check constraint "profiles_engines_items"'
      using errcode = '23514', constraint = 'profiles_engines_items', table = 'profiles', schema = 'public';
  end if;
  if exists (select 1 from unnest(new.skills) as t(v) where v is null or v !~ '[^[:space:]]' or char_length(v) > 50) then
    raise exception 'new row for relation "profiles" violates check constraint "profiles_skills_items"'
      using errcode = '23514', constraint = 'profiles_skills_items', table = 'profiles', schema = 'public';
  end if;
  return new;
end;
$$;

create trigger profiles_validate_items
  before insert or update on public.profiles
  for each row execute function public.validate_profile_items();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 권한: 운영("새 표 자동 노출" 끔)과 로컬이 같은 결과가 되도록 모두 명시한다(design.md 3.0)
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profiles_update_own on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy profiles_delete_own on public.profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.profiles from anon, authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;

revoke execute on function public.validate_profile_items() from public, anon, authenticated;

-- "프로필이 비어 있음"의 유일한 정의(design.md 2장). 샘플 채우기와 AI 분석(Edge Function)이 같이 쓴다.
-- 호출한 본인의 프로필만 RLS 아래에서 본다 → 다른 사용자의 프로필 유무는 알 수 없다.
-- 행이 없거나, 세 텍스트가 모두 비었거나 공백뿐(줄바꿈·탭 포함)이고 두 배열이 비어 있으면 true.
-- 잠금 후 개수를 세는 함수가 아니므로 STABLE.
create function public.is_profile_empty()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select not exists (
    select 1
      from public.profiles p
     where p.user_id = (select auth.uid())
       and (
         coalesce(p.summary, '') ~ '[^[:space:]]'
         or coalesce(p.strengths, '') ~ '[^[:space:]]'
         or coalesce(p.gaps, '') ~ '[^[:space:]]'
         or cardinality(p.engines) > 0
         or cardinality(p.skills) > 0
       )
  );
$$;

-- seed_sample_data()(SECURITY INVOKER)와 Edge Function(사용자 JWT)이 authenticated로 부르므로 실행 권한이 필요하다.
-- 알려 주는 것은 "내 프로필이 비었는지"뿐이다.
revoke execute on function public.is_profile_empty() from public, anon;
grant execute on function public.is_profile_empty() to authenticated;

-- 샘플 채우기 교체(design.md 4.1 5단계): 지원 건을 넣은 뒤 프로필이 비어 있으면 가상 프로필도 채운다.
-- 지원 건이 있으면 SAMPLE_NOT_EMPTY로 거부되어 프로필도 건드리지 않는다. 반환값은 그대로 넣은 지원 건 수.

create or replace function public.seed_sample_data()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Seoul')::date;
  inserted integer;
begin
  if uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('apps:' || uid::text, 0));

  if exists (select 1 from public.applications where user_id = uid) then
    raise exception 'SAMPLE_NOT_EMPTY' using errcode = 'P0001';
  end if;

  -- 회사명은 모두 가상이다. 지원일 빈 건 2개, 상태 6종, 엔진·플랫폼·지원 경로를 섞는다.
  insert into public.applications (user_id, company, position, channel, status, applied_at, deadline, posting_text, memo)
  values
    (
      uid, '픽셀포지 스튜디오', 'Unreal 클라이언트 프로그래머 (PC·콘솔 액션 RPG)', '게임잡', '면접',
      today - 21, today - 7,
      E'[픽셀포지 스튜디오] 신규 PC·콘솔 액션 RPG 클라이언트 프로그래머 모집\n\n담당 업무\n- Unreal Engine 5 기반 전투·캐릭터 시스템 개발\n- 애니메이션 블루프린트, Gameplay Ability System(GAS) 기반 스킬 구현\n- 콘솔(PS5, Xbox Series) 최적화 및 프로파일링\n\n자격 요건\n- C++ 기반 게임 클라이언트 개발 경력 3년 이상\n- Unreal Engine 상용 프로젝트 출시 경험\n- 3D 수학, 물리, 애니메이션 시스템에 대한 이해\n\n우대 사항\n- GAS를 이용한 전투 시스템 구현 경험\n- 콘솔 TRC/XR 인증 대응 경험\n- 멀티플레이 리플리케이션 경험\n\n전형 절차: 서류 → 과제 → 1차 면접 → 2차 면접 → 처우 협의',
      E'샘플 데이터: 가상의 회사입니다.\n2차 면접 대기 중. 과제는 GAS로 스킬 3종 구현.'
    ),
    (
      uid, '블루노바 게임즈', 'Unity 클라이언트 프로그래머 (모바일 수집형 RPG)', '원티드', '서류 통과',
      today - 14, today + 10,
      E'[블루노바 게임즈] 모바일 수집형 RPG 클라이언트 개발자\n\n담당 업무\n- Unity(C#) 기반 UI·전투 연출 개발\n- Addressables를 이용한 리소스 관리, 패치 시스템 개선\n- 모바일 기기(Android/iOS) 성능 최적화\n\n자격 요건\n- Unity 클라이언트 개발 경력 2년 이상\n- C# 및 객체지향 설계에 대한 이해\n- 모바일 게임 라이브 서비스 경험\n\n우대 사항\n- UGUI 대규모 UI 최적화 경험\n- 셰이더(HLSL/Shader Graph) 작성 경험\n- 서버 통신(REST, WebSocket) 연동 경험\n\n전형 절차: 서류 → 코딩테스트 → 면접',
      E'샘플 데이터: 가상의 회사입니다.\n코딩테스트 일정 안내 기다리는 중.'
    ),
    (
      uid, '아이언밸리 엔터테인먼트', '자체 엔진 클라이언트 프로그래머 (MMORPG)', '헤드헌터', '과제·코테',
      today - 9, today + 3,
      E'[아이언밸리 엔터테인먼트] 자체 엔진 MMORPG 클라이언트 프로그래머\n\n담당 업무\n- 자체 C++ 엔진 기반 렌더링·월드 스트리밍 개선\n- 대규모 필드 오브젝트 컬링 및 LOD 시스템 개발\n- 툴 프로그래밍(에디터 기능 확장)\n\n자격 요건\n- C++ 게임 클라이언트 개발 경력 5년 이상\n- DirectX 11/12 또는 Vulkan 렌더링 파이프라인 이해\n- 멀티스레드 프로그래밍 경험\n\n우대 사항\n- MMORPG 출시 및 라이브 경험\n- 자체 엔진 개발·유지보수 경험\n- 메모리·CPU 프로파일링 도구 사용 경험\n\n전형 절차: 서류 → 사전 과제(1주) → 기술 면접 → 임원 면접',
      E'샘플 데이터: 가상의 회사입니다.\n사전 과제 마감 전 제출 필요.'
    ),
    (
      uid, '루나크래프트', '게임플레이 프로그래머 (인디 로그라이크)', '직접 지원', '지원 완료',
      today - 3, today + 20,
      E'[루나크래프트] 게임플레이 프로그래머 (Unity, PC 로그라이크)\n\n담당 업무\n- 절차적 던전 생성, 아이템·스킬 조합 시스템 개발\n- 데이터 기반(ScriptableObject) 밸런스 구조 설계\n- Steam 출시 빌드 관리\n\n자격 요건\n- Unity C# 게임플레이 프로그래밍 경험\n- 소규모 팀에서 기획·아트와 직접 협업 가능\n\n우대 사항\n- 로그라이크 장르 이해\n- Steamworks 연동 경험\n- 개인 프로젝트 출시 경험\n\n전형 절차: 서류 → 포트폴리오 리뷰 면접',
      E'샘플 데이터: 가상의 회사입니다.'
    ),
    (
      uid, '스톰하버 인터랙티브', '클라이언트 프로그래머 (PC 슈팅, 네트워크)', '잡코리아', '관심',
      null, today + 14,
      E'[스톰하버 인터랙티브] PC 온라인 슈팅 클라이언트 프로그래머\n\n담당 업무\n- Unreal Engine 기반 네트워크 동기화(클라이언트 예측, 지연 보상)\n- 무기·히트 판정 시스템 개발\n- 안티치트 연동 및 보안 관련 클라이언트 작업\n\n자격 요건\n- 게임 클라이언트 개발 경력 3년 이상\n- 실시간 멀티플레이 게임 네트워크 이해\n\n우대 사항\n- FPS/TPS 장르 개발 경험\n- Unreal 리플리케이션, Iris 사용 경험\n- 서버 개발 경험\n\n전형 절차: 서류 → 코딩테스트 → 면접(2회)',
      E'샘플 데이터: 가상의 회사입니다.\n네트워크 경험 보강 후 지원 고민 중.'
    ),
    (
      uid, '하늘조각 게임즈', '클라이언트 프로그래머 (캐주얼 퍼즐)', '리멤버', '포기',
      null, today - 2,
      E'[하늘조각 게임즈] 모바일 캐주얼 퍼즐 클라이언트 프로그래머\n\n담당 업무\n- Cocos Creator(TypeScript) 기반 퍼즐 게임 개발\n- 라이브 이벤트 콘텐츠 개발\n\n자격 요건\n- 모바일 게임 클라이언트 개발 경력 1년 이상\n- TypeScript 또는 JavaScript 숙련\n\n우대 사항\n- 퍼즐 장르 개발 경험\n- 광고 SDK 연동 경험\n\n전형 절차: 서류 → 면접',
      E'샘플 데이터: 가상의 회사입니다.\n주력 엔진과 맞지 않아 지원하지 않기로 함.'
    );

  get diagnostics inserted = row_count;

  -- 프로필이 비어 있을 때만(빈 행이 이미 있으면 그 행을 채운다). 직접 쓴 프로필은 덮어쓰지 않는다.
  if public.is_profile_empty() then
    insert into public.profiles (user_id, summary, engines, skills, strengths, gaps)
    values (
      uid,
      E'샘플 프로필: 가상의 경력입니다.
모바일·PC 게임 클라이언트 프로그래머 4년 차. Unity로 모바일 수집형 RPG 2종을 출시·라이브 운영했고, 최근 1년은 Unreal Engine 5로 PC 액션 게임 프로토타입을 만들었다.',
      array['Unity', 'Unreal Engine 5'],
      array['C#', 'C++', 'UI 시스템', '전투 시스템', '메모리·드로우콜 최적화', 'Git', 'Jenkins 빌드 자동화'],
      E'라이브 서비스 중 프레임 드랍·메모리 문제를 프로파일링으로 찾아 고친 경험이 많다.
기획·아트와 직접 소통하며 UI·전투 기능을 빠르게 붙인다.',
      E'콘솔 플랫폼 출시 경험이 없다.
멀티플레이 네트워크 동기화는 학습 단계다.
Unreal GAS는 개인 프로젝트에서만 써 봤다.'
    )
    on conflict (user_id) do update
      set summary = excluded.summary,
          engines = excluded.engines,
          skills = excluded.skills,
          strengths = excluded.strengths,
          gaps = excluded.gaps;
  end if;
  return inserted;
end;
$$;

-- 기본 실행 권한은 첫 마이그레이션에서 회수했다(alter default privileges). 로그인 사용자에게만 명시적으로 준다.
-- 운영은 "새 표 자동 노출"이 꺼져 있어 이 grant가 없으면 로그인 사용자도 실행할 수 없다.
revoke execute on function public.seed_sample_data() from public, anon;
grant execute on function public.seed_sample_data() to authenticated;
