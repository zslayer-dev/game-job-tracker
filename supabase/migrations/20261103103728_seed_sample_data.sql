-- M5: 샘플 데이터 채우기 (PRD 8장 샘플 데이터, docs/design.md 4.1)
--
-- "지원 건이 없는지 확인"과 "샘플 넣기"를 한 트랜잭션으로 묶는다.
--   1) 사용자별 advisory lock — 키 'apps:<user_id>'는 500건 상한 트리거와 같다.
--      같은 사용자의 동시 호출(여러 탭)은 여기서 줄을 선다. 같은 트랜잭션 안의 재획득(트리거)은 허용된다.
--   2) 지원 건이 하나라도 있으면 SAMPLE_NOT_EMPTY
--   3) 가상 회사 지원 건 6개 insert
-- SECURITY INVOKER: RLS가 그대로 적용되어 호출한 본인 계정에만 들어간다.
-- VOLATILE(기본값) 유지: STABLE이면 잠금을 기다리는 동안 다른 호출이 커밋한 행을 보지 못해 중복으로 들어간다.

create function public.seed_sample_data()
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
  return inserted;
end;
$$;

-- 기본 실행 권한은 첫 마이그레이션에서 회수했다(alter default privileges). 로그인 사용자에게만 명시적으로 준다.
-- 운영은 "새 표 자동 노출"이 꺼져 있어 이 grant가 없으면 로그인 사용자도 실행할 수 없다.
revoke execute on function public.seed_sample_data() from public, anon;
grant execute on function public.seed_sample_data() to authenticated;
