// C1 검증: 관리자 표·함수, AI 사용 권한, 사용 횟수 초기화 (PRD 10장 #24 #25 #26 #27, #20 예외 조건, design.md 4.5)
// 실행: npm run test:db   (로컬 스택 전용)
// 관리자 지정은 운영과 같이 DB에 직접 넣는다(SQL Editor 대신 withDb).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { admin, anonClient, createTestUser, deleteTestUsers, withDb } from './helpers/local.mjs'

const users = []
const ADMIN_FUNCS = ['admin_list_users', 'admin_reset_ai_quota', 'admin_set_ai_access_mode', 'admin_set_ai_allowed']
const BIG = 1_000_000

async function newUser(label) {
  const u = await createTestUser(label)
  users.push(u)
  return u
}

async function makeAdmin(u) {
  await withDb((db) => db.query('insert into public.admins (user_id) values ($1)', [u.id]))
}

const sql = (text, params = []) => withDb(async (db) => (await db.query(text, params)).rows)
const one = async (text, params) => (await sql(text, params))[0]

async function mode() {
  return (await one('select access_mode from public.ai_settings')).access_mode
}

// 이 파일의 테스트가 모드를 바꿔도 다음 테스트(다른 파일 포함)에 영향이 없게 되돌린다
async function resetMode() {
  await sql(`update public.ai_settings set access_mode = 'all'`)
}

async function snapshot() {
  return one(
    `select (select access_mode from public.ai_settings) as mode,
            (select count(*)::int from public.ai_allowlist) as allow,
            (select count(*)::int from public.ai_quota_resets) as resets,
            (select count(*)::int from public.admin_actions) as actions,
            (select count(*)::int from public.admins) as admins`,
  )
}

async function insertUsage(userId, n, result = '성공') {
  await sql(`insert into public.ai_usage (user_id, result) select $1, $2 from generate_series(1, $3)`, [userId, result, n])
}

async function globalToday() {
  return Number(
    (await one(`select count(*) from public.ai_usage where called_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`)).count,
  )
}

async function remaining(u) {
  const { data, error } = await u.client.rpc('my_ai_remaining')
  assert.equal(error, null)
  return data
}

const begin = (userId, userLimit = null, globalLimit = BIG) =>
  admin.rpc('begin_ai_call', { p_user_id: userId, p_user_limit: userLimit, p_global_limit: globalLimit })

let boss
let plain
let other

before(async () => {
  await resetMode()
  boss = await newUser('c1-admin')
  plain = await newUser('c1-user')
  other = await newUser('c1-other')
  await makeAdmin(boss)
})

after(async () => {
  await resetMode()
  await sql('delete from public.admin_actions where actor_id = any($1)', [users.map((u) => u.id)])
  await deleteTestUsers(users)
})

// ── #24 일반 사용자 거부, 자기 자신을 관리자로 못 만듦 ─────────────────────────

describe('#24 일반 사용자는 관리자 기능을 쓸 수 없다', () => {
  test('is_admin(): 관리자만 true, 일반 사용자 false', async () => {
    assert.equal((await boss.client.rpc('is_admin')).data, true)
    assert.equal((await plain.client.rpc('is_admin')).data, false)
  })

  test('일반 사용자가 관리자 함수 4개를 부르면 FORBIDDEN이고 DB·기록은 그대로', async () => {
    const before = await snapshot()
    const calls = [
      plain.client.rpc('admin_list_users'),
      plain.client.rpc('admin_set_ai_access_mode', { p_mode: 'allowlist' }),
      plain.client.rpc('admin_set_ai_allowed', { p_user_id: plain.id, p_allowed: true }),
      plain.client.rpc('admin_reset_ai_quota', { p_user_id: plain.id }),
    ]
    for (const r of await Promise.all(calls)) {
      assert.equal(r.error?.code, 'P0001')
      assert.equal(r.error?.message, 'FORBIDDEN')
      assert.equal(r.data, null)
    }
    assert.deepEqual(await snapshot(), before)
  })

  test('로그아웃 상태(anon)는 관리자 함수·is_admin을 실행할 수 없다', async () => {
    const anon = anonClient()
    for (const [fn, args] of [
      ['is_admin', {}],
      ['admin_list_users', {}],
      ['admin_set_ai_access_mode', { p_mode: 'allowlist' }],
      ['admin_set_ai_allowed', { p_user_id: plain.id, p_allowed: true }],
      ['admin_reset_ai_quota', { p_user_id: plain.id }],
    ]) {
      const { error } = await anon.rpc(fn, args)
      assert.equal(error?.code, '42501', fn)
    }
  })

  test('admins: 일반 사용자는 조회해도 0건, 관리자는 자기 행만 보인다', async () => {
    const second = await newUser('c1-admin2')
    await makeAdmin(second)
    const asPlain = await plain.client.from('admins').select('user_id')
    assert.equal(asPlain.error, null)
    assert.deepEqual(asPlain.data, [])
    const byId = await plain.client.from('admins').select('user_id').eq('user_id', boss.id)
    assert.deepEqual(byId.data, [], '다른 사람(관리자)의 행은 보이지 않는다')
    const asBoss = await boss.client.from('admins').select('user_id')
    assert.deepEqual(asBoss.data, [{ user_id: boss.id }], '관리자도 다른 관리자의 행은 보이지 않는다')
  })

  test('자기 자신을 관리자로 추가할 수 없고, 수정·삭제도 권한 오류', async () => {
    const ins = await plain.client.from('admins').insert({ user_id: plain.id })
    assert.equal(ins.error?.code, '42501')
    const upd = await boss.client.from('admins').update({ user_id: plain.id }).eq('user_id', boss.id)
    assert.equal(upd.error?.code, '42501')
    const del = await boss.client.from('admins').delete().eq('user_id', boss.id)
    assert.equal(del.error?.code, '42501')
    assert.equal((await plain.client.rpc('is_admin')).data, false)
    assert.ok(await one('select 1 as ok from public.admins where user_id = $1', [boss.id]), '관리자 행은 그대로')
  })

  test('관리자 전용 표에 사용자가 직접 쓸 수 없다 (ai_settings·ai_allowlist·ai_quota_resets)', async () => {
    const before = await snapshot()
    assert.equal((await plain.client.from('ai_settings').update({ access_mode: 'allowlist' }).eq('id', true)).error?.code, '42501')
    assert.equal((await plain.client.from('ai_allowlist').insert({ user_id: plain.id, granted_by: plain.id })).error?.code, '42501')
    assert.equal((await plain.client.from('ai_quota_resets').insert({ user_id: plain.id, reset_by: plain.id })).error?.code, '42501')
    assert.deepEqual(await snapshot(), before)
  })

  test('사용자는 남의 허용·초기화 행을 볼 수 없다 (보조 함수로 물어도)', async () => {
    await boss.client.rpc('admin_set_ai_allowed', { p_user_id: other.id, p_allowed: true })
    await boss.client.rpc('admin_reset_ai_quota', { p_user_id: other.id })
    assert.deepEqual((await plain.client.from('ai_allowlist').select('user_id').eq('user_id', other.id)).data, [])
    assert.deepEqual((await plain.client.from('ai_quota_resets').select('id').eq('user_id', other.id)).data, [])
    // INVOKER 보조 함수에 남의 ID를 넣어도 RLS 때문에 남의 초기화 시각은 알 수 없다(오늘 시작 시각이 나온다)
    const dayStart = (await one(`select (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as d`)).d
    const viaPlain = await plain.client.rpc('ai_user_quota_start', { p_user_id: other.id })
    assert.equal(new Date(viaPlain.data).getTime(), dayStart.getTime())
    await boss.client.rpc('admin_set_ai_allowed', { p_user_id: other.id, p_allowed: false })
  })

  test('관리자는 목록을 본다: 정해진 열만, 지원 건은 개수만', async () => {
    await plain.client.from('applications').insert([
      { company: '가상1', position: 'x', memo: '비밀 메모' },
      { company: '가상2', position: 'x' },
    ])
    const { data, error } = await boss.client.rpc('admin_list_users')
    assert.equal(error, null)
    const row = data.find((r) => r.user_id === plain.id)
    assert.deepEqual(Object.keys(row).sort(), [
      'ai_allowed',
      'ai_allowlisted',
      'ai_daily_limit',
      'ai_used_today',
      'application_count',
      'created_at',
      'email',
      'last_sign_in_at',
      'user_id',
    ])
    assert.equal(row.email, plain.email)
    assert.equal(row.application_count, 2)
    assert.equal(row.ai_daily_limit, 10)
    assert.equal(row.ai_allowed, true)
    assert.equal(row.ai_allowlisted, false, '전체 허용 모드라 허용되지만 허용 목록에는 없다')
    assert.ok(row.last_sign_in_at, '테스트 사용자는 로그인했으므로 마지막 로그인 시각이 있다')
    assert.ok(!JSON.stringify(data).includes('비밀 메모'), '지원 건 내용은 나오지 않는다')
  })

  test('존재하지 않는 사용자·잘못된 모드는 거부, 변경 없음', async () => {
    const before = await snapshot()
    const missing = '00000000-0000-0000-0000-000000000001'
    assert.equal((await boss.client.rpc('admin_set_ai_allowed', { p_user_id: missing, p_allowed: true })).error?.message, 'NOT_FOUND')
    assert.equal((await boss.client.rpc('admin_reset_ai_quota', { p_user_id: missing })).error?.message, 'NOT_FOUND')
    assert.equal((await boss.client.rpc('admin_set_ai_access_mode', { p_mode: 'everyone' })).error?.message, 'VALIDATION')
    assert.deepEqual(await snapshot(), before)
  })
})

// ── #25 초기화: 사용자 횟수만 복구, 전체 유지 ──────────────────────────────────

describe('#25 사용 횟수 초기화', () => {
  test('10회 다 쓴 사용자를 초기화 → 남은 횟수 10으로 복구, ai_usage는 그대로, 전체 횟수는 그대로', async () => {
    const u = await newUser('c1-reset')
    const v = await newUser('c1-reset-bystander')
    await insertUsage(u.id, 10)
    await insertUsage(v.id, 3)
    assert.equal((await remaining(u)).remaining, 0)
    assert.equal((await begin(u.id)).error?.message, 'AI_USER_LIMIT', '초기화 전에는 사용자 한도')

    const globalBefore = await globalToday()
    const { data: resetAt, error } = await boss.client.rpc('admin_reset_ai_quota', { p_user_id: u.id })
    assert.equal(error, null)
    assert.ok(resetAt)

    // 사용자 횟수만 복구 (표시와 판정이 같은 값)
    assert.deepEqual(await remaining(u), { remaining: 10, daily_limit: 10, allowed: true })
    const listed = (await boss.client.rpc('admin_list_users')).data.find((r) => r.user_id === u.id)
    assert.equal(listed.ai_used_today, 0)
    // 다른 사용자는 영향 없음
    assert.equal((await remaining(v)).remaining, 7)
    // 기록은 지우지 않았다
    assert.equal(Number((await one('select count(*) from public.ai_usage where user_id = $1', [u.id])).count), 10)
    // 전체 횟수는 초기화와 무관: 전체 한도를 지금 전체 건수로 두면 여전히 거부
    assert.equal(await globalToday(), globalBefore)
    assert.equal((await begin(u.id, null, globalBefore)).error?.message, 'AI_GLOBAL_LIMIT')
    // 전체 한도가 넉넉하면 초기화된 사용자는 다시 쓸 수 있고, 새 호출은 센다
    assert.equal((await begin(u.id)).error, null)
    assert.equal((await remaining(u)).remaining, 9)
    assert.equal((await boss.client.rpc('admin_list_users')).data.find((r) => r.user_id === u.id).ai_used_today, 1)
  })
})

// ── #26 허용 목록 모드 ────────────────────────────────────────────────────────

describe('#26 AI 사용 권한 (허용 목록 모드)', () => {
  after(resetMode)

  test('기본 모드는 "전체 허용"이고, 그때는 목록에 없어도 쓸 수 있다', async () => {
    assert.equal(await mode(), 'all')
    const u = await newUser('c1-mode-all')
    assert.equal((await remaining(u)).allowed, true)
    assert.equal((await begin(u.id)).error, null)
  })

  test('허용 목록 모드: 미허용 사용자는 AI 호출 전 AI_NOT_ALLOWED, 기록·횟수 증가 없음 → 허용하면 통과 → 해제하면 다시 거부', async () => {
    const u = await newUser('c1-allowlist')
    assert.equal((await boss.client.rpc('admin_set_ai_access_mode', { p_mode: 'allowlist' })).data, true)
    assert.equal(await mode(), 'allowlist')

    const countUsage = async () => Number((await one('select count(*) from public.ai_usage where user_id = $1', [u.id])).count)
    const globalBefore = await globalToday()
    const denied = await begin(u.id)
    assert.equal(denied.error?.message, 'AI_NOT_ALLOWED')
    assert.equal(await countUsage(), 0, '거부된 요청은 ai_usage에 남지 않는다 = AI 호출 전')
    assert.equal(await globalToday(), globalBefore, '전체 횟수도 늘지 않는다')
    assert.deepEqual(await remaining(u), { remaining: 10, daily_limit: 10, allowed: false })

    assert.equal((await boss.client.rpc('admin_set_ai_allowed', { p_user_id: u.id, p_allowed: true })).data, true)
    assert.equal((await remaining(u)).allowed, true)
    const listed = (await boss.client.rpc('admin_list_users')).data.find((r) => r.user_id === u.id)
    assert.deepEqual({ allowed: listed.ai_allowed, listed: listed.ai_allowlisted }, { allowed: true, listed: true })
    assert.equal((await begin(u.id)).error, null)
    assert.equal(await countUsage(), 1)

    assert.equal((await boss.client.rpc('admin_set_ai_allowed', { p_user_id: u.id, p_allowed: false })).data, true)
    assert.equal((await begin(u.id)).error?.message, 'AI_NOT_ALLOWED')
    assert.equal(await countUsage(), 1)
  })

  test('허용 판정이 한도보다 먼저: 미허용 + 한도 소진 사용자는 AI_NOT_ALLOWED', async () => {
    await boss.client.rpc('admin_set_ai_access_mode', { p_mode: 'allowlist' })
    const u = await newUser('c1-allowlist-full')
    await insertUsage(u.id, 10)
    assert.equal((await begin(u.id)).error?.message, 'AI_NOT_ALLOWED')
  })

  test('관리자도 허용 목록 모드에서 자동으로 허용되지 않는다', async () => {
    await boss.client.rpc('admin_set_ai_access_mode', { p_mode: 'allowlist' })
    assert.equal((await remaining(boss)).allowed, false)
    assert.equal((await begin(boss.id)).error?.message, 'AI_NOT_ALLOWED')
  })

  test('"전체 허용"으로 되돌리면 목록과 무관하게 다시 쓸 수 있다', async () => {
    await boss.client.rpc('admin_set_ai_access_mode', { p_mode: 'allowlist' })
    const u = await newUser('c1-back-to-all')
    assert.equal((await begin(u.id)).error?.message, 'AI_NOT_ALLOWED')
    assert.equal((await boss.client.rpc('admin_set_ai_access_mode', { p_mode: 'all' })).data, true)
    assert.equal((await begin(u.id)).error, null)
  })
})

// ── #27 관리자 동작 기록 ──────────────────────────────────────────────────────

describe('#27 관리자 동작 기록', () => {
  after(resetMode)

  test('허용·해제·초기화·모드 변경이 누가 언제 했는지 남고, 이메일은 남지 않는다. 바뀐 것이 없으면 기록하지 않는다', async () => {
    const t = await newUser('c1-audit-target')
    const since = (await one('select now() as t')).t
    const actions = () =>
      sql(
        `select actor_id, action, target_user_id, detail, created_at from public.admin_actions
          where created_at >= $1 and actor_id = $2 order by created_at, id`,
        [since, boss.id],
      )

    assert.equal((await boss.client.rpc('admin_set_ai_allowed', { p_user_id: t.id, p_allowed: true })).data, true)
    assert.equal((await boss.client.rpc('admin_set_ai_allowed', { p_user_id: t.id, p_allowed: true })).data, false, '이미 허용')
    assert.equal((await boss.client.rpc('admin_set_ai_allowed', { p_user_id: t.id, p_allowed: false })).data, true)
    assert.equal((await boss.client.rpc('admin_set_ai_allowed', { p_user_id: t.id, p_allowed: false })).data, false, '이미 해제')
    await boss.client.rpc('admin_reset_ai_quota', { p_user_id: t.id })
    assert.equal((await boss.client.rpc('admin_set_ai_access_mode', { p_mode: 'allowlist' })).data, true)
    assert.equal((await boss.client.rpc('admin_set_ai_access_mode', { p_mode: 'allowlist' })).data, false, '같은 모드')
    assert.equal((await boss.client.rpc('admin_set_ai_access_mode', { p_mode: 'all' })).data, true)

    const rows = await actions()
    assert.deepEqual(
      rows.map((r) => [r.action, r.target_user_id, r.detail]),
      [
        ['ai_allow', t.id, null],
        ['ai_disallow', t.id, null],
        ['quota_reset', t.id, null],
        ['mode_change', null, { from: 'all', to: 'allowlist' }],
        ['mode_change', null, { from: 'allowlist', to: 'all' }],
      ],
    )
    for (const r of rows) {
      assert.equal(r.actor_id, boss.id)
      assert.ok(r.created_at >= since)
    }
    assert.ok(!JSON.stringify(rows).includes('@'), '기록에 이메일이 없다')
    // 초기화 기록에도 관리자 ID가 남는다
    const reset = await one('select reset_by from public.ai_quota_resets where user_id = $1', [t.id])
    assert.equal(reset.reset_by, boss.id)
  })

  test('기록은 관리자·사용자 누구도 화면·API로 읽거나 고치거나 지울 수 없다', async () => {
    for (const u of [boss, plain]) {
      assert.equal((await u.client.from('admin_actions').select('id')).error?.code, '42501')
      assert.equal((await u.client.from('admin_actions').insert({ actor_id: u.id, action: 'quota_reset', target_user_id: u.id })).error?.code, '42501')
      assert.equal((await u.client.from('admin_actions').update({ action: 'ai_allow' }).eq('actor_id', boss.id)).error?.code, '42501')
      assert.equal((await u.client.from('admin_actions').delete().eq('actor_id', boss.id)).error?.code, '42501')
    }
    assert.equal((await anonClient().from('admin_actions').select('id')).error?.code, '42501')
  })
})

// ── 함수 설정 점검 (#20 예외 조건) ─────────────────────────────────────────────

describe('관리자 함수 설정 점검', () => {
  test('DEFINER 노출은 관리자 함수 4개뿐, is_admin과 보조 함수는 INVOKER', async () => {
    const rows = await sql(
      `select p.proname, p.prosecdef, p.proconfig, p.provolatile,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p where p.pronamespace = 'public'::regnamespace`,
    )
    const exposed = rows.filter((r) => r.prosecdef && (r.anon || r.authed)).map((r) => r.proname).sort()
    assert.deepEqual(exposed, ADMIN_FUNCS)
    const by = Object.fromEntries(rows.map((r) => [r.proname, r]))
    for (const name of [...ADMIN_FUNCS, 'is_admin', 'ai_user_allowed', 'ai_user_quota_start', 'my_ai_remaining', 'begin_ai_call']) {
      assert.deepEqual(by[name].proconfig, ['search_path=""'], name)
    }
    for (const name of ADMIN_FUNCS) {
      assert.deepEqual({ anon: by[name].anon, authed: by[name].authed, service: by[name].service }, { anon: false, authed: true, service: false }, name)
    }
    for (const name of ['is_admin', 'ai_user_allowed', 'ai_user_quota_start', 'my_ai_remaining']) {
      assert.equal(by[name].prosecdef, false, `${name}는 INVOKER`)
      assert.equal(by[name].anon, false, name)
    }
    assert.equal(by.admin_list_users.provolatile, 's')
    for (const name of ['admin_set_ai_access_mode', 'admin_set_ai_allowed', 'admin_reset_ai_quota']) {
      assert.equal(by[name].provolatile, 'v', `${name}는 잠금을 잡으므로 VOLATILE`)
    }
  })

  test('관리자 함수 4개는 본문 첫 문장이 관리자 확인이고, 그 전에 실행되는 선언 초기값이 없다', async () => {
    const rows = await sql(`select proname, prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [ADMIN_FUNCS])
    assert.equal(rows.length, 4)
    for (const { proname, prosrc } of rows) {
      const m = /^([\s\S]*?)\bbegin\b([\s\S]*)$/i.exec(prosrc)
      assert.ok(m, `${proname}: begin이 없다`)
      const [, head, body] = m
      assert.ok(!head.includes(':='), `${proname}: 선언부에 초기값이 있다`)
      assert.match(
        body,
        /^\s*if not public\.is_admin\(\) then\s+raise exception 'FORBIDDEN' using errcode = 'P0001';\s+end if;/,
        `${proname}: 첫 문장이 관리자 확인이 아니다`,
      )
    }
  })

  test('표: RLS 켜짐, 사용자 권한은 select만(admin_actions는 없음), anon·service_role 없음', async () => {
    const rls = await sql(
      `select relname, relrowsecurity from pg_class
        where oid = any(array['public.admins','public.ai_settings','public.ai_allowlist','public.ai_quota_resets','public.admin_actions']::regclass[])
        order by relname`,
    )
    assert.ok(rls.every((r) => r.relrowsecurity), JSON.stringify(rls))
    const grants = await sql(
      `select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('admins','ai_settings','ai_allowlist','ai_quota_resets','admin_actions')
          and grantee in ('anon','authenticated','service_role','PUBLIC')
        group by table_name, grantee order by table_name, grantee`,
    )
    assert.deepEqual(grants, [
      { table_name: 'admins', grantee: 'authenticated', privs: 'SELECT' },
      { table_name: 'ai_allowlist', grantee: 'authenticated', privs: 'SELECT' },
      { table_name: 'ai_quota_resets', grantee: 'authenticated', privs: 'SELECT' },
      { table_name: 'ai_settings', grantee: 'authenticated', privs: 'SELECT' },
    ])
  })
})
