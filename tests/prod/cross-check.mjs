// 운영 DB 교차 검증 (npm run test:prod) — PRD #5, #6, #17, #22(memo·분석 결과), Should 표(profiles·ai_analyses·ai_usage) 교차 검증, 권한 점검.
// 전부 하나의 트랜잭션 안에서 실행하고 마지막에 반드시 ROLLBACK 한다. 운영 데이터는 바뀌지 않는다.
//
// 입력(환경 변수로만 받는다. 값은 파일·로그·출력에 남기지 않는다):
//   PROD_DB_URL  운영 DB 접속 문자열 (Supabase 대시보드 → Connect → Session pooler)
//   PROD_DB_CA   운영 DB SSL 인증서 파일 경로 (대시보드 → Database Settings → SSL Configuration에서 받음)
// 실행 방법: docs/m7-checklist.md 6장
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const rawUrl = process.env.PROD_DB_URL
if (!rawUrl) {
  console.error('PROD_DB_URL 환경 변수가 없습니다. docs/m7-checklist.md 6장을 보세요.')
  process.exit(2)
}

// 오류 문구에 접속 문자열·비밀번호가 섞여 나오지 않게 지운다
let parsed
try {
  parsed = new URL(rawUrl)
} catch {
  console.error('PROD_DB_URL 형식이 올바르지 않습니다(값은 출력하지 않음).')
  process.exit(2)
}
const secrets = [rawUrl, parsed.password, decodeURIComponent(parsed.password)].filter((s) => s && s.length >= 4)
function redact(text) {
  let out = String(text)
  for (const s of secrets) out = out.split(s).join('***')
  return out.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***')
}

// SSL: 로컬 스택이 아니면 인증서 검증을 반드시 한다(접속 문자열의 sslmode는 무시하고 여기서 정한다)
const isLocal = ['127.0.0.1', 'localhost'].includes(parsed.hostname)
for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl']) parsed.searchParams.delete(k)
let ssl = false
if (!isLocal) {
  const caPath = process.env.PROD_DB_CA
  if (!caPath) {
    console.error('PROD_DB_CA(운영 DB SSL 인증서 파일 경로)가 없습니다. docs/m7-checklist.md 6장을 보세요.')
    process.exit(2)
  }
  try {
    ssl = { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
  } catch {
    console.error('PROD_DB_CA 경로의 인증서 파일을 읽지 못했습니다.')
    process.exit(2)
  }
}

const db = new pg.Client({ connectionString: parsed.toString(), ssl, application_name: 'game-job-tracker test:prod' })
const results = []
const record = (name, ok, detail = '') => results.push({ name, ok, detail })

// 검사 하나를 SAVEPOINT 안에서 실행하고 항상 되돌린다(역할 전환·변경 모두 취소).
// fn이 던진 DB 오류는 { error } 로 돌려준다.
async function inSavepoint(fn) {
  await db.query('savepoint check_sp')
  try {
    return { value: await fn() }
  } catch (error) {
    if (!error.code) throw error
    return { error }
  } finally {
    await db.query('rollback to savepoint check_sp')
  }
}

// 로그인한 사용자(또는 로그아웃 상태 anon)를 흉내 낸다. PostgREST가 요청마다 하는 것과 같다.
async function actAs(uid) {
  const claims = uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' }
  await db.query(`set local role ${uid ? 'authenticated' : 'anon'}`)
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
}

function expectDenied(name, r, code, constraint) {
  const ok = Boolean(r.error) && r.error.code === code && (!constraint || r.error.constraint === constraint)
  const got = r.error ? `${r.error.code}${r.error.constraint ? ` ${r.error.constraint}` : ''}` : '거부되지 않음'
  record(name, ok, `기대 ${code}${constraint ? ` ${constraint}` : ''} / 실제 ${got}`)
}

function expectRows(name, r, n) {
  const got = r.error ? `오류 ${r.error.code}` : `${r.value}건`
  record(name, !r.error && r.value === n, `기대 ${n}건 / 실제 ${got}`)
}

const tag = randomUUID().slice(0, 8)
const userA = randomUUID()
const userB = randomUUID()
const emails = [`prodcheck-a-${tag}@example.invalid`, `prodcheck-b-${tag}@example.invalid`]

let rolledBack = false
let connected = false
try {
  await db.connect()
  connected = true
  await db.query('begin')
  await db.query("set local statement_timeout = '30s'")
  await db.query("set local lock_timeout = '5s'")

  // 트랜잭션 안에서만 존재하는 임시 사용자 A·B와 A의 지원 건
  for (const [id, email] of [[userA, emails[0]], [userB, emails[1]]]) {
    await db.query(
      `insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now())`,
      [id, email],
    )
  }
  const { rows } = await db.query(
    `insert into public.applications (user_id, company, position, memo)
     values ($1, '교차검증-A', 'x', '원래 메모') returning id, updated_at`,
    [userA],
  )
  const appId = rows[0].id

  // ── #5 계정 B는 계정 A의 지원 건을 보거나 바꿀 수 없다
  expectRows('#5 B가 A의 건 조회', await inSavepoint(async () => {
    await actAs(userB)
    return (await db.query('select id from public.applications where id = $1', [appId])).rowCount
  }), 0)
  expectRows('#5 B가 A의 건 수정', await inSavepoint(async () => {
    await actAs(userB)
    return (await db.query("update public.applications set memo = 'B가 바꿈' where id = $1", [appId])).rowCount
  }), 0)
  expectRows('#5 B가 A의 건 삭제', await inSavepoint(async () => {
    await actAs(userB)
    return (await db.query('delete from public.applications where id = $1', [appId])).rowCount
  }), 0)
  expectDenied('#5 B가 A 소유로 추가', await inSavepoint(async () => {
    await actAs(userB)
    await db.query("insert into public.applications (user_id, company, position) values ($1, 'B가 넣음', 'x')", [userA])
  }), '42501')
  expectDenied('#5 A가 자기 건의 소유자를 B로 변경', await inSavepoint(async () => {
    await actAs(userA)
    await db.query('update public.applications set user_id = $2 where id = $1', [appId, userB])
  }), '42501')
  expectRows('#5 대조: A는 자기 건을 조회', await inSavepoint(async () => {
    await actAs(userA)
    return (await db.query('select id from public.applications where id = $1', [appId])).rowCount
  }), 1)
  {
    const after = await db.query('select user_id, memo, updated_at from public.applications where id = $1', [appId])
    const r = after.rows[0]
    const ok = r && r.user_id === userA && r.memo === '원래 메모' && r.updated_at.getTime() === rows[0].updated_at.getTime()
    record('#5 A의 건이 그대로(소유자·메모·updated_at)', Boolean(ok), ok ? '' : '변경됨')
  }

  // ── #6 로그아웃 상태(anon)의 조회·추가 거부
  expectDenied('#6 anon 조회', await inSavepoint(async () => {
    await actAs(null)
    await db.query('select id from public.applications limit 1')
  }), '42501')
  expectDenied('#6 anon 추가', await inSavepoint(async () => {
    await actAs(null)
    await db.query("insert into public.applications (company, position) values ('로그아웃 상태', 'x')")
  }), '42501')

  // ── #22 상한 (Must 범위)
  expectDenied('#22 memo 5,001자 거부', await inSavepoint(async () => {
    await actAs(userA)
    await db.query("insert into public.applications (company, position, memo) values ('상한', 'x', repeat('가', 5001))")
  }), '23514', 'applications_memo_len')
  expectDenied('#22 posting_text 8,001자 거부', await inSavepoint(async () => {
    await actAs(userA)
    await db.query("insert into public.applications (company, position, posting_text) values ('상한', 'x', repeat('a', 8001))")
  }), '23514', 'applications_posting_text_len')
  expectRows('#22 대조: memo 5,000자는 저장', await inSavepoint(async () => {
    await actAs(userA)
    return (await db.query("insert into public.applications (company, position, memo) values ('상한', 'x', repeat('가', 5000))")).rowCount
  }), 1)

  // ── Should 표 교차 검증 (S5): profiles · ai_analyses · ai_usage
  // A의 프로필·분석 결과·호출 기록을 트랜잭션 안에서만 만든다(마지막에 ROLLBACK).
  await db.query(`insert into public.profiles (user_id, summary, skills) values ($1, '원래 요약', '{C#}')`, [userA])
  const { rows: ana } = await db.query(
    `insert into public.ai_analyses (application_id, user_id, fit_score, matched_skills, missing_skills, comment)
     values ($1, $2, 70, '{C#}', '{GAS}', '원래 코멘트') returning id`,
    [appId, userA],
  )
  const analysisId = ana[0].id
  const { rows: use } = await db.query(`insert into public.ai_usage (user_id, result) values ($1, '성공') returning id`, [userA])
  const usageId = use[0].id

  // profiles (본인만 조회·추가·수정·삭제)
  expectRows('profiles: B가 A의 프로필 조회', await inSavepoint(async () => {
    await actAs(userB)
    return (await db.query('select user_id from public.profiles where user_id = $1', [userA])).rowCount
  }), 0)
  expectRows('profiles: B가 A의 프로필 수정', await inSavepoint(async () => {
    await actAs(userB)
    return (await db.query("update public.profiles set summary = 'B가 바꿈' where user_id = $1", [userA])).rowCount
  }), 0)
  expectRows('profiles: B가 A의 프로필 삭제', await inSavepoint(async () => {
    await actAs(userB)
    return (await db.query('delete from public.profiles where user_id = $1', [userA])).rowCount
  }), 0)
  expectDenied('profiles: B가 A 소유로 추가', await inSavepoint(async () => {
    await actAs(userB)
    await db.query("insert into public.profiles (user_id, summary) values ($1, 'B가 넣음')", [userA])
  }), '42501')
  expectDenied('profiles: A가 자기 프로필의 소유자를 B로 변경', await inSavepoint(async () => {
    await actAs(userA)
    await db.query('update public.profiles set user_id = $2 where user_id = $1', [userA, userB])
  }), '42501')
  expectDenied('profiles: anon 조회', await inSavepoint(async () => {
    await actAs(null)
    await db.query('select user_id from public.profiles limit 1')
  }), '42501')
  expectDenied('profiles: 엔진 31개 거부', await inSavepoint(async () => {
    await actAs(userA)
    await db.query("update public.profiles set engines = array(select 'e' || g from generate_series(1, 31) g) where user_id = $1", [userA])
  }), '23514', 'profiles_engines_count')

  // ai_analyses (본인만 조회·추가·삭제, 수정 없음, 복합 FK)
  expectRows('ai_analyses: B가 A의 분석 조회', await inSavepoint(async () => {
    await actAs(userB)
    return (await db.query('select id from public.ai_analyses where id = $1', [analysisId])).rowCount
  }), 0)
  expectRows('ai_analyses: B가 A의 분석 삭제', await inSavepoint(async () => {
    await actAs(userB)
    return (await db.query('delete from public.ai_analyses where id = $1', [analysisId])).rowCount
  }), 0)
  expectDenied('ai_analyses: 수정은 누구도 못 함(A 본인도)', await inSavepoint(async () => {
    await actAs(userA)
    await db.query('update public.ai_analyses set fit_score = 100 where id = $1', [analysisId])
  }), '42501')
  expectDenied('ai_analyses: B가 A 소유로 A의 지원 건에 추가', await inSavepoint(async () => {
    await actAs(userB)
    await db.query(
      "insert into public.ai_analyses (application_id, user_id, fit_score, comment) values ($1, $2, 1, 'B가 넣음')",
      [appId, userA],
    )
  }), '42501')
  expectDenied('ai_analyses: B가 자기 이름으로 A의 지원 건에 붙임(복합 FK)', await inSavepoint(async () => {
    await actAs(userB)
    await db.query("insert into public.ai_analyses (application_id, fit_score, comment) values ($1, 1, 'B가 붙임')", [appId])
  }), '23503')
  expectDenied('ai_analyses: anon 조회', await inSavepoint(async () => {
    await actAs(null)
    await db.query('select id from public.ai_analyses limit 1')
  }), '42501')
  expectDenied('#22 ai_analyses: 코멘트 2,001자 거부', await inSavepoint(async () => {
    await actAs(userA)
    await db.query("insert into public.ai_analyses (application_id, fit_score, comment) values ($1, 1, repeat('가', 2001))", [appId])
  }), '23514', 'ai_analyses_comment_len')
  expectDenied('#22 ai_analyses: 매칭 기술 31개 거부', await inSavepoint(async () => {
    await actAs(userA)
    await db.query(
      "insert into public.ai_analyses (application_id, fit_score, matched_skills, comment) values ($1, 1, array(select 's' || g from generate_series(1, 31) g), 'x')",
      [appId],
    )
  }), '23514', 'ai_analyses_matched_skills_count')

  // ai_usage (#17: 본인 조회만, 직접 쓰기 거부)
  expectRows('#17 ai_usage: A는 자기 기록 조회', await inSavepoint(async () => {
    await actAs(userA)
    return (await db.query('select id from public.ai_usage where id = $1', [usageId])).rowCount
  }), 1)
  expectRows('#17 ai_usage: B가 A의 기록 조회', await inSavepoint(async () => {
    await actAs(userB)
    return (await db.query('select id from public.ai_usage where id = $1', [usageId])).rowCount
  }), 0)
  expectDenied('#17 ai_usage: 사용자가 직접 추가', await inSavepoint(async () => {
    await actAs(userA)
    await db.query("insert into public.ai_usage (user_id, result, failure_reason) values ($1, '실패', 'AI 오류')", [userA])
  }), '42501')
  expectDenied('#17 ai_usage: 사용자가 직접 수정', await inSavepoint(async () => {
    await actAs(userA)
    await db.query("update public.ai_usage set result = '실패', failure_reason = 'AI 오류' where id = $1", [usageId])
  }), '42501')
  expectDenied('#17 ai_usage: 사용자가 직접 삭제', await inSavepoint(async () => {
    await actAs(userA)
    await db.query('delete from public.ai_usage where id = $1', [usageId])
  }), '42501')
  expectDenied('#17 ai_usage: 사용자가 begin_ai_call 호출', await inSavepoint(async () => {
    await actAs(userA)
    await db.query('select public.begin_ai_call($1, 1000000, 1000000)', [userA])
  }), '42501')
  {
    const r = await inSavepoint(async () => {
      await actAs(userB)
      return (await db.query('select remaining, daily_limit from public.my_ai_remaining()')).rows[0]
    })
    const ok = !r.error && r.value.remaining === r.value.daily_limit
    record('my_ai_remaining: B에게 A의 사용량이 섞이지 않음', ok, r.error ? `오류 ${r.error.code}` : `B remaining=${r.value.remaining}/${r.value.daily_limit}`)
  }
  {
    const after = await db.query(
      `select (select summary from public.profiles where user_id = $1) as summary,
              (select fit_score from public.ai_analyses where id = $2) as score,
              (select result from public.ai_usage where id = $3) as result`,
      [userA, analysisId, usageId],
    )
    const r = after.rows[0]
    const ok = r.summary === '원래 요약' && r.score === 70 && r.result === '성공'
    record('Should 표: A의 프로필·분석·기록이 그대로', ok, ok ? '' : JSON.stringify(r))
  }

  // ── 권한 점검
  {
    const { rows: g } = await db.query(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'applications' and grantee in ('authenticated', 'anon', 'PUBLIC')`,
    )
    const auth = g.filter((x) => x.grantee === 'authenticated').map((x) => x.privilege_type).sort()
    const expected = ['DELETE', 'INSERT', 'SELECT', 'UPDATE']
    record('권한: authenticated는 SELECT·INSERT·UPDATE·DELETE 4개만', JSON.stringify(auth) === JSON.stringify(expected), `실제 ${auth.join(',') || '없음'}`)
    const others = g.filter((x) => x.grantee !== 'authenticated').map((x) => `${x.grantee}:${x.privilege_type}`)
    record('권한: anon·PUBLIC 표 권한 없음', others.length === 0, others.length ? `실제 ${others.join(',')}` : '')
  }
  {
    const { rows: t } = await db.query(
      `select c.relname, c.relrowsecurity from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')`,
    )
    const off = t.filter((x) => !x.relrowsecurity).map((x) => x.relname)
    record(`RLS: public 표 ${t.length}개 모두 켜짐`, t.length > 0 && off.length === 0, off.length ? `꺼짐 ${off.join(',')}` : '')
  }
  {
    // 플랫폼이 만든 rls_auto_enable은 우리 함수가 아니므로 search_path 대신 실행 권한 회수를 본다
    const { rows: f } = await db.query(
      `select p.proname, coalesce(p.proconfig, '{}') as cfg from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       left join pg_catalog.pg_depend d on d.objid = p.oid and d.deptype = 'e'
       where n.nspname = 'public' and d.objid is null and p.proname <> 'rls_auto_enable'`,
    )
    const bad = f.filter((x) => !x.cfg.some((c) => c === 'search_path=""' || c === "search_path=''")).map((x) => x.proname)
    record(`함수: public 함수 ${f.length}개 모두 search_path 비어 있음`, f.length > 0 && bad.length === 0, bad.length ? `비어 있지 않음 ${bad.join(',')}` : f.map((x) => x.proname).join(', '))
  }
  {
    const { rows: e } = await db.query(
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed
       from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('seed_sample_data', 'rls_auto_enable')`,
    )
    const seed = e.find((x) => x.fn.startsWith('seed_sample_data'))
    record('함수 권한: seed_sample_data는 authenticated만 실행', Boolean(seed && seed.authed && !seed.anon), seed ? `anon=${seed.anon} authenticated=${seed.authed}` : '함수 없음')
    const auto = e.find((x) => x.fn.startsWith('rls_auto_enable'))
    if (auto) record('함수 권한: rls_auto_enable 실행 권한 회수', !auto.anon && !auto.authed, `anon=${auto.anon} authenticated=${auto.authed}`)
  }
  {
    // Should 표 권한: profiles 4개, ai_analyses 조회·추가·삭제, ai_usage 조회만. anon·PUBLIC·service_role은 AI 표 권한 없음
    const { rows: g } = await db.query(
      `select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name in ('profiles', 'ai_analyses', 'ai_usage')
          and grantee in ('authenticated', 'anon', 'PUBLIC', 'service_role')
        group by table_name, grantee`,
    )
    const get = (t, r) => g.find((x) => x.table_name === t && x.grantee === r)?.privs ?? '없음'
    const want = { profiles: 'DELETE,INSERT,SELECT,UPDATE', ai_analyses: 'DELETE,INSERT,SELECT', ai_usage: 'SELECT' }
    for (const [t, privs] of Object.entries(want)) {
      record(`권한: ${t} authenticated = ${privs}`, get(t, 'authenticated') === privs, `실제 ${get(t, 'authenticated')}`)
    }
    const extra = g.filter(
      (x) => x.grantee === 'anon' || x.grantee === 'PUBLIC' || (x.grantee === 'service_role' && x.table_name !== 'profiles'),
    )
    record('권한: Should 표에 anon·PUBLIC 권한 없음, AI 표에 service_role 권한 없음', extra.length === 0, extra.map((x) => `${x.table_name}/${x.grantee}:${x.privs}`).join(' '))
  }
  {
    const { rows: f } = await db.query(
      `select p.proname, p.prosecdef,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    )
    // 관리자 함수 4개(C1)만 예외(PRD #20). C1을 운영에 올리기 전에는 0개, 올린 뒤에는 4개.
    const ADMIN_DEFINERS = ['admin_list_users', 'admin_reset_ai_quota', 'admin_set_ai_access_mode', 'admin_set_ai_allowed']
    const exposedDefiner = f.filter((x) => x.prosecdef && (x.anon || x.authed)).map((x) => x.proname)
    const unexpected = exposedDefiner.filter((n) => !ADMIN_DEFINERS.includes(n))
    const anonDefiner = f.filter((x) => x.prosecdef && x.anon).map((x) => x.proname)
    record(
      '함수 권한: anon·authenticated가 실행하는 SECURITY DEFINER 함수는 관리자 함수 4개 외 없음, anon은 없음',
      unexpected.length === 0 && anonDefiner.length === 0,
      `노출 ${exposedDefiner.join(', ') || '없음'}${unexpected.length ? ` / 예외 밖 ${unexpected.join(', ')}` : ''}`,
    )
    for (const name of ['begin_ai_call', 'finish_ai_call']) {
      const x = f.find((y) => y.proname === name)
      record(
        `함수 권한: ${name}는 service_role만(DEFINER)`,
        Boolean(x && x.prosecdef && x.service && !x.authed && !x.anon),
        x ? `definer=${x.prosecdef} service_role=${x.service} authenticated=${x.authed} anon=${x.anon}` : '함수 없음',
      )
    }
  }
} catch (error) {
  record('실행 중 오류', false, redact(`${error.code ?? ''} ${error.message ?? error}`.trim()))
} finally {
  if (connected) {
    try {
      await db.query('rollback')
      rolledBack = true
    } catch (error) {
      console.error('ROLLBACK 실패:', redact(error.message))
    }
  }
}

// 트랜잭션 밖에서 다시 확인: 임시 사용자가 남지 않았다
let leftover = null
if (rolledBack) {
  try {
    const { rows } = await db.query('select count(*)::int as n from auth.users where email = any($1)', [emails])
    leftover = rows[0].n
  } catch (error) {
    console.error('정리 확인 실패:', redact(error.message))
  }
}
if (connected) await db.end().catch(() => {})

console.log('\n운영 DB 교차 검증 결과')
for (const r of results) {
  console.log(`  ${r.ok ? '통과' : '실패'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}개 통과, ${failed}개 실패`)

if (rolledBack && leftover === 0) {
  console.log('ROLLBACK 완료, 운영 데이터 변경 없음')
} else if (!connected) {
  console.log('DB에 접속하지 못했습니다. 아무것도 실행되지 않았습니다.')
} else {
  console.log('ROLLBACK을 확인하지 못했습니다. 연결이 끊긴 트랜잭션은 DB가 자동으로 되돌리지만, Studio에서 prodcheck- 사용자가 없는지 확인하세요.')
}
process.exitCode = failed === 0 && rolledBack && leftover === 0 ? 0 : 1
