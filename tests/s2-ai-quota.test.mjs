// S2 검증: ai_analyses·ai_usage 표와 한도 함수 (PRD 10장 #13 #14 #15 #16 #17, #22 Should 범위, design.md 4.2·4.3)
// 실행: npm run test:db   (로컬 스택 전용)
// begin_ai_call·finish_ai_call은 Edge Function처럼 service_role 클라이언트(admin)로 부른다.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { admin, anonClient, createTestUser, deleteTestUsers, withDb } from './helpers/local.mjs'

const users = []
const BIG = 1_000_000 // 이 테스트에서 신경 쓰지 않는 쪽 한도

async function newUser(label) {
  const u = await createTestUser(label)
  users.push(u)
  return u
}

after(async () => {
  await deleteTestUsers(users)
})

const begin = (userId, userLimit = BIG, globalLimit = BIG) =>
  admin.rpc('begin_ai_call', { p_user_id: userId, p_user_limit: userLimit, p_global_limit: globalLimit })
const finish = (id, result, reason = null) => admin.rpc('finish_ai_call', { p_id: id, p_result: result, p_failure_reason: reason })

// 지난 시각의 기록은 함수로 만들 수 없으므로 DB에 직접 넣는다
async function insertUsage(userId, result, reason, calledAtSql = 'now()') {
  await withDb((db) =>
    db.query(`insert into public.ai_usage (user_id, result, failure_reason, called_at) values ($1, $2, $3, ${calledAtSql})`, [userId, result, reason]),
  )
}

// 오늘(KST) 전체 기록 수 — 함수와 별개로 SQL로 직접 센다
async function globalToday() {
  return withDb(async (db) =>
    Number(
      (
        await db.query(
          `select count(*) from public.ai_usage where called_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`,
        )
      ).rows[0].count,
    ),
  )
}

async function remaining(u) {
  const { data, error } = await u.client.rpc('my_ai_remaining')
  assert.equal(error, null)
  return data
}

function tally(results) {
  const by = {}
  for (const r of results) {
    const key = r.error ? r.error.message : 'ok'
    by[key] = (by[key] ?? 0) + 1
  }
  return by
}

describe('#13 사용자 한도 남은 1회에서 같은 사용자 동시 요청 → 1건만 통과', () => {
  test('사용 0회 + 한도 1 → 동시 10건 중 1건 성공, 9건 AI_USER_LIMIT', async () => {
    const u = await newUser('s2-user-race')
    const results = await Promise.all(Array.from({ length: 10 }, () => begin(u.id, 1)))
    assert.deepEqual(tally(results), { ok: 1, AI_USER_LIMIT: 9 })
    const rows = await withDb(async (db) => (await db.query('select result from public.ai_usage where user_id = $1', [u.id])).rows)
    assert.deepEqual(rows, [{ result: '진행 중' }])
  })

  test('사용 2회 + 한도 3 (남은 1회) → 동시 5건 중 1건 성공', async () => {
    const u = await newUser('s2-user-race2')
    await insertUsage(u.id, '성공', null)
    await insertUsage(u.id, '실패', '형식 오류')
    const results = await Promise.all(Array.from({ length: 5 }, () => begin(u.id, 3)))
    assert.deepEqual(tally(results), { ok: 1, AI_USER_LIMIT: 4 })
  })
})

describe('#14 전체 한도 남은 1회에서 다른 사용자 동시 요청 → 1건만 통과', () => {
  test('사용자 5명이 동시에 1건씩 → 1건 성공, 4건 AI_GLOBAL_LIMIT', async () => {
    const group = await Promise.all([1, 2, 3, 4, 5].map((i) => newUser(`s2-global-${i}`)))
    const limit = (await globalToday()) + 1
    const results = await Promise.all(group.map((u) => begin(u.id, BIG, limit)))
    assert.deepEqual(tally(results), { ok: 1, AI_GLOBAL_LIMIT: 4 })
    assert.equal(await globalToday(), limit)
  })

  test('사용자 한도와 전체 한도가 모두 찼으면 사용자 한도를 먼저 알려 준다', async () => {
    const u = await newUser('s2-both')
    await insertUsage(u.id, '성공', null)
    const { error } = await begin(u.id, 1, await globalToday())
    assert.equal(error?.message, 'AI_USER_LIMIT')
  })
})

describe('#15 실패 사유별 집계', () => {
  let u
  let before4
  before(async () => {
    u = await newUser('s2-reasons')
    before4 = await globalToday()
    for (const [result, reason] of [
      ['실패', 'AI 오류'],
      ['실패', '시간 초과'],
      ['실패', '형식 오류'],
      ['성공', null],
    ]) {
      const { data: id, error } = await begin(u.id)
      assert.equal(error, null)
      const done = await finish(id, result, reason)
      assert.equal(done.data, true)
    }
  })

  test('사용자 횟수: AI 오류·시간 초과는 빠지고, 형식 오류·성공만 센다 (2회)', async () => {
    const r = await remaining(u)
    assert.deepEqual(r, { remaining: 8, daily_limit: 10 })
    // 한도 3이면 1회 더 되고, 그다음은 막힌다
    assert.equal((await begin(u.id, 3)).error, null)
    assert.equal((await begin(u.id, 3)).error?.message, 'AI_USER_LIMIT')
  })

  test('전체 횟수: 사유와 무관하게 4건 모두 센다', async () => {
    // before4 + 4건(+ 위 테스트의 1건)이 이미 있다 → 한도를 before4 + 4로 두면 거부
    const { error } = await begin(u.id, BIG, before4 + 4)
    assert.equal(error?.message, 'AI_GLOBAL_LIMIT')
  })

  test('finish_ai_call은 진행 중인 행만 한 번 고친다', async () => {
    const { data: id } = await begin(u.id)
    assert.equal((await finish(id, '성공')).data, true)
    assert.equal((await finish(id, '실패', 'AI 오류')).data, false)
    const row = await withDb(async (db) => (await db.query('select result, failure_reason from public.ai_usage where id = $1', [id])).rows[0])
    assert.deepEqual(row, { result: '성공', failure_reason: null })
  })

  test('잘못된 결과·사유 조합은 거부', async () => {
    const { data: id } = await begin(u.id)
    assert.equal((await finish(id, '진행 중')).error?.message, 'INVALID_RESULT')
    assert.equal((await finish(id, '실패')).error?.code, '23514') // 실패인데 사유 없음
    assert.equal((await finish(id, '성공', 'AI 오류')).error?.code, '23514') // 성공인데 사유 있음
  })
})

describe('#16 "진행 중" 2분 경과', () => {
  test('2분 지난 진행 중은 사용자 횟수에서 빠지고 전체에는 남는다', async () => {
    const u = await newUser('s2-stale')
    await insertUsage(u.id, '진행 중', null, "now() - interval '3 minutes'")
    await insertUsage(u.id, '진행 중', null, "now() - interval '1 minute'")
    assert.equal((await remaining(u)).remaining, 9, '2분 이내 1건만 사용자 횟수')
    const g = await globalToday()
    assert.equal((await begin(u.id, BIG, g)).error?.message, 'AI_GLOBAL_LIMIT', '두 건 모두 전체 횟수')
  })

  test('finish_ai_call은 2분 지난 행을 요청 값과 무관하게 실패(시간 초과)로 기록', async () => {
    const u = await newUser('s2-late')
    const id = await withDb(async (db) =>
      (
        await db.query(
          `insert into public.ai_usage (user_id, result, called_at) values ($1, '진행 중', now() - interval '3 minutes') returning id`,
          [u.id],
        )
      ).rows[0].id,
    )
    assert.equal((await finish(id, '성공')).data, true)
    const row = await withDb(async (db) => (await db.query('select result, failure_reason from public.ai_usage where id = $1', [id])).rows[0])
    assert.deepEqual(row, { result: '실패', failure_reason: '시간 초과' })
    assert.equal((await remaining(u)).remaining, 10)
  })

  test('하루는 KST 자정 기준: 어제 23:59(KST) 기록은 세지 않고 오늘 00:00은 센다', async () => {
    const u = await newUser('s2-kst')
    const midnight = "(date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')"
    await insertUsage(u.id, '성공', null, `${midnight} - interval '1 minute'`)
    assert.equal((await remaining(u)).remaining, 10)
    await insertUsage(u.id, '성공', null, midnight)
    assert.equal((await remaining(u)).remaining, 9)
  })
})

describe('화면 표시(my_ai_remaining)와 판정(begin_ai_call)이 같은 값을 쓴다', () => {
  test('기본 한도(인자 없음)로: 남은 1회면 begin 통과, 남은 0회면 AI_USER_LIMIT', async () => {
    assert.ok((await globalToday()) < 90, '전체 기본 한도(100)에 걸리지 않는 상태에서 확인한다')
    const u = await newUser('s2-same')
    // 섞인 기록: 사용자 횟수에 들어가는 것 9건 + 빠지는 것 3건
    for (let i = 0; i < 8; i++) await insertUsage(u.id, '성공', null)
    await insertUsage(u.id, '실패', '형식 오류')
    await insertUsage(u.id, '실패', 'AI 오류')
    await insertUsage(u.id, '실패', '시간 초과')
    await insertUsage(u.id, '진행 중', null, "now() - interval '5 minutes'")

    assert.deepEqual(await remaining(u), { remaining: 1, daily_limit: 10 })
    const first = await admin.rpc('begin_ai_call', { p_user_id: u.id })
    assert.equal(first.error, null)
    assert.deepEqual(await remaining(u), { remaining: 0, daily_limit: 10 })
    const second = await admin.rpc('begin_ai_call', { p_user_id: u.id })
    assert.equal(second.error?.message, 'AI_USER_LIMIT')
  })
})

describe('my_ai_remaining(): 본인 사용량만 센다 (SECURITY INVOKER + RLS)', () => {
  let a
  let b
  before(async () => {
    a = await newUser('s2-mine-a')
    b = await newUser('s2-mine-b')
    for (let i = 0; i < 4; i++) await insertUsage(a.id, '성공', null)
  })

  test('A의 사용량이 B에게 섞이지 않는다', async () => {
    assert.equal((await remaining(a)).remaining, 6)
    assert.equal((await remaining(b)).remaining, 10)
  })

  test('인자로 다른 사용자를 지정할 수 없다', async () => {
    const { error } = await b.client.rpc('my_ai_remaining', { p_user_id: a.id })
    assert.ok(error)
  })

  test('로그아웃 상태(anon)는 실행할 수 없다', async () => {
    const { error } = await anonClient().rpc('my_ai_remaining')
    assert.equal(error?.code, '42501')
  })

  test('auth.uid()가 없으면 AUTH_REQUIRED (authenticated 역할 + sub 없음)', async () => {
    const err = await withDb(async (db) => {
      await db.query('begin')
      try {
        await db.query('set local role authenticated')
        await db.query(`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`)
        await db.query('select * from public.my_ai_remaining()')
        return null
      } catch (e) {
        return e
      } finally {
        await db.query('rollback')
      }
    })
    assert.equal(err?.message, 'AUTH_REQUIRED')
  })
})

describe('#17 ai_usage: 본인 조회만, 직접 쓰기 거부', () => {
  let a
  let b
  before(async () => {
    a = await newUser('s2-usage-a')
    b = await newUser('s2-usage-b')
    await insertUsage(a.id, '성공', null)
  })

  test('A는 자기 기록을 조회한다', async () => {
    const { data, error } = await a.client.from('ai_usage').select('user_id, result')
    assert.equal(error, null)
    assert.deepEqual(data, [{ user_id: a.id, result: '성공' }])
  })

  test('B는 A의 기록을 조회할 수 없다 (0건)', async () => {
    const { data } = await b.client.from('ai_usage').select('*').eq('user_id', a.id)
    assert.deepEqual(data, [])
  })

  test('사용자가 직접 추가·수정·삭제하면 권한 오류이고 DB는 그대로', async () => {
    const ins = await a.client.from('ai_usage').insert({ user_id: a.id, result: '실패', failure_reason: 'AI 오류' })
    assert.equal(ins.error?.code, '42501')
    const upd = await a.client.from('ai_usage').update({ result: '실패', failure_reason: 'AI 오류' }).eq('user_id', a.id)
    assert.equal(upd.error?.code, '42501')
    const del = await a.client.from('ai_usage').delete().eq('user_id', a.id)
    assert.equal(del.error?.code, '42501')
    const rows = await withDb(async (db) => (await db.query('select result from public.ai_usage where user_id = $1', [a.id])).rows)
    assert.deepEqual(rows, [{ result: '성공' }])
  })

  test('사용자는 begin_ai_call·finish_ai_call을 부를 수 없다 (한도를 바꾸거나 기록을 고칠 수 없음)', async () => {
    const b1 = await a.client.rpc('begin_ai_call', { p_user_id: a.id, p_user_limit: BIG, p_global_limit: BIG })
    assert.equal(b1.error?.code, '42501')
    const f1 = await a.client.rpc('finish_ai_call', { p_id: a.id, p_result: '성공' })
    assert.equal(f1.error?.code, '42501')
  })

  test('로그아웃 상태는 조회도 권한 오류', async () => {
    const { error } = await anonClient().from('ai_usage').select('*')
    assert.equal(error?.code, '42501')
  })
})

describe('ai_analyses: 본인만, 복합 FK, 연쇄 삭제, 수정 없음', () => {
  let a
  let b
  let appA
  let appB
  const valid = () => ({ fit_score: 70, matched_skills: ['C#'], missing_skills: ['GAS'], comment: '적합' })

  before(async () => {
    a = await newUser('s2-ana-a')
    b = await newUser('s2-ana-b')
    appA = (await a.client.from('applications').insert({ company: '가상A', position: 'x' }).select('id').single()).data.id
    appB = (await b.client.from('applications').insert({ company: '가상B', position: 'x' }).select('id').single()).data.id
  })

  test('A는 자기 지원 건에 분석을 저장·조회한다', async () => {
    const { data, error } = await a.client.from('ai_analyses').insert({ application_id: appA, ...valid() }).select().single()
    assert.equal(error, null)
    assert.equal(data.user_id, a.id)
  })

  test('A가 B의 지원 건에 분석을 붙이면 거부 (복합 FK)', async () => {
    const { error } = await a.client.from('ai_analyses').insert({ application_id: appB, ...valid() })
    assert.equal(error?.code, '23503')
  })

  test('A가 user_id를 B로 지정해 B의 지원 건에 붙이면 거부 (RLS)', async () => {
    const { error } = await a.client.from('ai_analyses').insert({ application_id: appB, user_id: b.id, ...valid() })
    assert.equal(error?.code, '42501')
  })

  test('B는 A의 분석을 조회·삭제할 수 없다', async () => {
    const sel = await b.client.from('ai_analyses').select('*').eq('application_id', appA)
    assert.deepEqual(sel.data, [])
    const del = await b.client.from('ai_analyses').delete().eq('application_id', appA).select()
    assert.deepEqual(del.data, [])
    const left = await withDb(async (db) => Number((await db.query('select count(*) from public.ai_analyses where application_id = $1', [appA])).rows[0].count))
    assert.equal(left, 1)
  })

  test('분석 결과는 수정할 수 없다', async () => {
    const { error } = await a.client.from('ai_analyses').update({ fit_score: 100 }).eq('application_id', appA)
    assert.equal(error?.code, '42501')
  })

  test('지원 건을 지우면 분석도 지워지고, ai_usage 기록은 남는다', async () => {
    const app = (await a.client.from('applications').insert({ company: '삭제용', position: 'x' }).select('id').single()).data.id
    await a.client.from('ai_analyses').insert({ application_id: app, ...valid() })
    await insertUsage(a.id, '성공', null)
    await a.client.from('applications').delete().eq('id', app)
    const r = await withDb(async (db) => ({
      analyses: Number((await db.query('select count(*) from public.ai_analyses where application_id = $1', [app])).rows[0].count),
      usage: Number((await db.query('select count(*) from public.ai_usage where user_id = $1', [a.id])).rows[0].count),
    }))
    assert.deepEqual(r, { analyses: 0, usage: 1 })
  })

  test('로그아웃 상태는 조회·추가 권한 오류', async () => {
    const anon = anonClient()
    assert.equal((await anon.from('ai_analyses').select('*')).error?.code, '42501')
    assert.equal((await anon.from('ai_analyses').insert({ application_id: appA, ...valid() })).error?.code, '42501')
  })
})

describe('#22 분석 결과 상한 (Should 범위, DB 제약)', () => {
  let a
  let app
  before(async () => {
    a = await newUser('s2-limit')
    app = (await a.client.from('applications').insert({ company: '가상', position: 'x' }).select('id').single()).data.id
  })

  const save = (over) =>
    a.client.from('ai_analyses').insert({ application_id: app, fit_score: 50, matched_skills: [], missing_skills: [], comment: '코멘트', ...over })
  const list = (n) => Array.from({ length: n }, (_, i) => `기술${i}`)

  function assertConstraint(error, name) {
    assert.ok(error, `오류가 나야 하는데 저장됐다 (${name})`)
    assert.equal(error.code, '23514')
    assert.match(error.message, new RegExp(`"${name}"`))
  }

  test('경계값은 저장된다 (코멘트 2,000자, 기술 목록 각 30개, 점수 0·100)', async () => {
    for (const over of [
      { comment: '가'.repeat(2000), matched_skills: list(30), missing_skills: list(30) },
      { fit_score: 0 },
      { fit_score: 100 },
    ]) {
      assert.equal((await save(over)).error, null)
    }
  })

  test('코멘트 2,001자 거부', async () => assertConstraint((await save({ comment: '가'.repeat(2001) })).error, 'ai_analyses_comment_len'))
  test('빈 코멘트·공백 코멘트 거부', async () => {
    assertConstraint((await save({ comment: '' })).error, 'ai_analyses_comment_not_blank')
    assertConstraint((await save({ comment: ' \n\t' })).error, 'ai_analyses_comment_not_blank')
  })
  test('매칭 기술 31개 거부', async () => assertConstraint((await save({ matched_skills: list(31) })).error, 'ai_analyses_matched_skills_count'))
  test('부족 기술 31개 거부', async () => assertConstraint((await save({ missing_skills: list(31) })).error, 'ai_analyses_missing_skills_count'))
  test('적합도 범위 밖(-1, 101) 거부', async () => {
    assertConstraint((await save({ fit_score: -1 })).error, 'ai_analyses_fit_score_range')
    assertConstraint((await save({ fit_score: 101 })).error, 'ai_analyses_fit_score_range')
  })
})

describe('권한 설정 점검 (운영 "새 표 자동 노출 끔"과 같은 결과인지)', () => {
  test('표 권한: ai_analyses는 authenticated select·insert·delete, ai_usage는 select만. anon·service_role은 없음', async () => {
    const grants = await withDb(async (db) =>
      (
        await db.query(
          `select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
             from information_schema.role_table_grants
            where table_schema = 'public' and table_name in ('ai_analyses', 'ai_usage')
              and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
            group by table_name, grantee
            order by table_name, grantee`,
        )
      ).rows,
    )
    assert.deepEqual(grants, [
      { table_name: 'ai_analyses', grantee: 'authenticated', privs: 'DELETE,INSERT,SELECT' },
      { table_name: 'ai_usage', grantee: 'authenticated', privs: 'SELECT' },
    ])
  })

  test('RLS가 켜져 있고 정책은 authenticated 대상, ai_analyses update·ai_usage 쓰기 정책 없음', async () => {
    const r = await withDb(async (db) => ({
      rls: (await db.query(`select relname, relrowsecurity from pg_class where oid in ('public.ai_analyses'::regclass, 'public.ai_usage'::regclass) order by relname`)).rows,
      policies: (
        await db.query(
          `select tablename, cmd, roles::text[] as roles from pg_policies
            where schemaname = 'public' and tablename in ('ai_analyses', 'ai_usage') order by tablename, cmd`,
        )
      ).rows,
    }))
    assert.deepEqual(r.rls, [
      { relname: 'ai_analyses', relrowsecurity: true },
      { relname: 'ai_usage', relrowsecurity: true },
    ])
    assert.deepEqual(
      r.policies.map((p) => [p.tablename, p.cmd, p.roles]),
      [
        ['ai_analyses', 'DELETE', ['authenticated']],
        ['ai_analyses', 'INSERT', ['authenticated']],
        ['ai_analyses', 'SELECT', ['authenticated']],
        ['ai_usage', 'SELECT', ['authenticated']],
      ],
    )
  })

  test('함수: search_path 비어 있음, 보안 모드·변동성·실행 권한', async () => {
    const fns = await withDb(async (db) =>
      (
        await db.query(
          `select p.proname, p.proconfig, p.prosecdef, p.provolatile,
                  has_function_privilege('anon', p.oid, 'execute') as anon,
                  has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                  has_function_privilege('service_role', p.oid, 'execute') as service_role
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('ai_daily_limits', 'ai_day_start', 'counts_for_user', 'begin_ai_call', 'finish_ai_call', 'my_ai_remaining')
            order by p.proname`,
        )
      ).rows,
    )
    const by = Object.fromEntries(fns.map((f) => [f.proname, f]))
    assert.equal(fns.length, 6)
    for (const f of fns) assert.deepEqual(f.proconfig, ['search_path=""'], f.proname)
    const pick = (f) => ({ definer: f.prosecdef, vol: f.provolatile, anon: f.anon, authenticated: f.authenticated, service_role: f.service_role })
    assert.deepEqual(pick(by.begin_ai_call), { definer: true, vol: 'v', anon: false, authenticated: false, service_role: true })
    assert.deepEqual(pick(by.finish_ai_call), { definer: true, vol: 'v', anon: false, authenticated: false, service_role: true })
    // INVOKER: RLS로 본인 ai_usage만 본다 (Security Advisor "Signed-In Users Can Execute SECURITY DEFINER Function" 해소)
    assert.deepEqual(pick(by.my_ai_remaining), { definer: false, vol: 's', anon: false, authenticated: true, service_role: false })
    // 표를 읽지 않는 순수 계산 함수: my_ai_remaining(INVOKER)이 부르므로 authenticated만 실행
    for (const name of ['ai_daily_limits', 'ai_day_start', 'counts_for_user']) {
      assert.deepEqual(
        { anon: by[name].anon, authenticated: by[name].authenticated, service_role: by[name].service_role, definer: by[name].prosecdef },
        { anon: false, authenticated: true, service_role: false, definer: false },
        name,
      )
    }
    assert.equal(by.counts_for_user.provolatile, 's')
  })

  test('authenticated가 실행하는 SECURITY DEFINER 함수가 public에 없다 (Security Advisor 0건 조건)', async () => {
    const rows = await withDb(async (db) =>
      (
        await db.query(
          `select p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`,
        )
      ).rows,
    )
    assert.deepEqual(rows, [])
  })

  test('내부 계산 함수 세 개는 표를 읽지 않는다', async () => {
    const result = await withDb(async (db) => {
      // 본문에 FROM이 없다 (표·뷰를 읽으려면 FROM이 필요)
      const src = (
        await db.query(
          `select proname, prosrc from pg_proc
            where pronamespace = 'public'::regnamespace and proname in ('ai_daily_limits', 'ai_day_start', 'counts_for_user')`,
        )
      ).rows
      // 표 권한이 하나도 없는 역할로도 실행된다 (INVOKER라 표를 읽으면 permission denied가 난다)
      await db.query('begin')
      try {
        await db.query('create role s2_no_tables nologin')
        // postgres는 슈퍼유저가 아니라 만든 역할로 바꾸려면 구성원이 되어야 한다
        await db.query('grant s2_no_tables to current_user')
        await db.query('grant usage on schema public to s2_no_tables')
        await db.query(
          'grant execute on function public.ai_daily_limits(), public.ai_day_start(), public.counts_for_user(text, text, timestamptz) to s2_no_tables',
        )
        await db.query('set local role s2_no_tables')
        const r = (
          await db.query(
            `select (select user_limit from public.ai_daily_limits()) as user_limit,
                    public.ai_day_start() is not null as day_start,
                    public.counts_for_user('성공', null, now()) as counts`,
          )
        ).rows[0]
        return { src, r }
      } finally {
        await db.query('rollback')
      }
    })
    assert.equal(result.src.length, 3)
    for (const f of result.src) assert.doesNotMatch(f.prosrc, /\bfrom\b/i, `${f.proname} 본문에 FROM이 있다`)
    assert.deepEqual(result.r, { user_limit: 10, day_start: true, counts: true })
  })

  test('service_role은 표 권한 없이 함수만으로 기록을 남긴다 (운영과 같은 조건)', async () => {
    const u = await newUser('s2-service')
    // 표 직접 접근은 거부된다
    const direct = await admin.from('ai_usage').select('id').limit(1)
    assert.equal(direct.error?.code, '42501')
    // 함수로는 시작·종료가 된다
    const { data: id, error } = await admin.rpc('begin_ai_call', { p_user_id: u.id })
    assert.equal(error, null)
    assert.equal((await finish(id, '성공')).data, true)
  })

  test('begin_ai_call에 user_id가 없으면 AUTH_REQUIRED', async () => {
    const { error } = await admin.rpc('begin_ai_call', { p_user_id: null })
    assert.equal(error?.message, 'AUTH_REQUIRED')
  })
})
