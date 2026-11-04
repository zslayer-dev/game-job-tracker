// S1 검증: profiles 표·is_profile_empty()·샘플 채우기의 프로필 (PRD 8장 권한·입력, design.md 2장·3장·4.1)
// 실행: npm run test:db   (로컬 스택 전용)
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { anonClient, createTestUser, deleteTestUsers, withDb } from './helpers/local.mjs'

const users = []

async function newUser(label) {
  const u = await createTestUser(label)
  users.push(u)
  return u
}

after(async () => {
  await deleteTestUsers(users)
})

const FULL = {
  summary: '클라이언트 프로그래머 3년',
  engines: ['Unity', 'Unreal Engine 5'],
  skills: ['C#', 'C++'],
  strengths: '최적화',
  gaps: '콘솔 경험 없음',
}

async function profileRow(userId) {
  return withDb(async (db) => (await db.query('select * from public.profiles where user_id = $1', [userId])).rows[0] ?? null)
}

function assertConstraint(error, name) {
  assert.ok(error, `오류가 나야 하는데 저장됐다 (${name})`)
  assert.equal(error.code, '23514')
  assert.match(error.message, new RegExp(`"${name}"`))
}

describe('프로필 저장·다시 읽기 (S1 완료 조건: 저장·새로고침 유지)', () => {
  let u
  before(async () => {
    u = await newUser('s1-save')
  })

  test('처음에는 프로필이 없다', async () => {
    const { data, error } = await u.client.from('profiles').select('*').maybeSingle()
    assert.equal(error, null)
    assert.equal(data, null)
  })

  test('user_id 없이 upsert하면 내 프로필로 만들어지고, 다시 upsert하면 같은 행이 고쳐진다', async () => {
    const first = await u.client.from('profiles').upsert(FULL, { onConflict: 'user_id' }).select().single()
    assert.equal(first.error, null)
    assert.equal(first.data.user_id, u.id)

    const second = await u.client
      .from('profiles')
      .upsert({ ...FULL, skills: ['C#', 'C++', 'HLSL'] }, { onConflict: 'user_id' })
      .select()
      .single()
    assert.equal(second.error, null)
    assert.ok(new Date(second.data.updated_at) >= new Date(first.data.updated_at))

    // 새 연결(새로고침과 같음)로 다시 읽어도 남아 있다
    const row = await profileRow(u.id)
    assert.deepEqual(
      { summary: row.summary, engines: row.engines, skills: row.skills, strengths: row.strengths, gaps: row.gaps },
      { ...FULL, skills: ['C#', 'C++', 'HLSL'] },
    )
    const count = await withDb(async (db) => Number((await db.query('select count(*) from public.profiles where user_id = $1', [u.id])).rows[0].count))
    assert.equal(count, 1, '사용자당 1행')
  })
})

describe('다른 계정은 내 프로필을 보거나 바꿀 수 없다 (교차 검증, #5와 같은 방식)', () => {
  let a
  let b
  before(async () => {
    a = await newUser('s1-a')
    b = await newUser('s1-b')
    const { error } = await a.client.from('profiles').insert(FULL)
    assert.equal(error, null)
  })

  test('B가 조회하면 0건', async () => {
    const all = await b.client.from('profiles').select('*')
    assert.equal(all.error, null)
    assert.deepEqual(all.data, [])
    const byId = await b.client.from('profiles').select('*').eq('user_id', a.id)
    assert.deepEqual(byId.data, [])
  })

  test('B가 A의 프로필을 수정·삭제하면 0건이고 DB는 그대로', async () => {
    const upd = await b.client.from('profiles').update({ summary: 'B가 바꿈' }).eq('user_id', a.id).select()
    assert.equal(upd.error, null)
    assert.deepEqual(upd.data, [])
    const del = await b.client.from('profiles').delete().eq('user_id', a.id).select()
    assert.equal(del.error, null)
    assert.deepEqual(del.data, [])
    assert.equal((await profileRow(a.id)).summary, FULL.summary)
  })

  test('B가 user_id를 A로 지정해 추가하면 거부', async () => {
    const { error } = await b.client.from('profiles').insert({ user_id: a.id, summary: 'B가 넣음' })
    assert.equal(error?.code, '42501')
  })

  test('B가 user_id를 A로 지정해 upsert해도 A의 행은 바뀌지 않는다', async () => {
    const { error } = await b.client.from('profiles').upsert({ user_id: a.id, summary: 'B가 덮어씀' }, { onConflict: 'user_id' })
    assert.ok(error, 'upsert가 거부되어야 한다')
    assert.equal((await profileRow(a.id)).summary, FULL.summary)
  })

  test('A가 자기 프로필의 소유자를 B로 바꾸면 거부', async () => {
    const { error } = await a.client.from('profiles').update({ user_id: b.id }).eq('user_id', a.id)
    assert.equal(error?.code, '42501')
    assert.ok(await profileRow(a.id))
  })

  test('로그아웃 상태의 조회·추가는 권한 오류', async () => {
    const anon = anonClient()
    const sel = await anon.from('profiles').select('*')
    assert.equal(sel.error?.code, '42501')
    const ins = await anon.from('profiles').insert({ user_id: a.id, summary: 'x' })
    assert.equal(ins.error?.code, '42501')
  })
})

describe('상한 (DB 제약): 텍스트 2,000자, 엔진·기술 각 30개, 항목 1~50자', () => {
  let u
  before(async () => {
    u = await newUser('s1-limit')
  })

  const save = (values) => u.client.from('profiles').upsert(values, { onConflict: 'user_id' }).select().single()
  const tags = (n, len = 5) => Array.from({ length: n }, (_, i) => `t${i}`.padEnd(len, 'x'))

  test('경계값은 저장된다 (2,000자 ×3, 30개 ×2, 50자 항목)', async () => {
    const { error } = await save({
      summary: '가'.repeat(2000),
      strengths: '가'.repeat(2000),
      gaps: '가'.repeat(2000),
      engines: tags(30, 50),
      skills: tags(30, 50),
    })
    assert.equal(error, null)
  })

  for (const field of ['summary', 'strengths', 'gaps']) {
    test(`${field} 2,001자 거부`, async () => {
      const { error } = await save({ [field]: '가'.repeat(2001) })
      assertConstraint(error, `profiles_${field}_len`)
    })
  }

  for (const field of ['engines', 'skills']) {
    test(`${field} 31개 거부`, async () => {
      const { error } = await save({ [field]: tags(31) })
      assertConstraint(error, `profiles_${field}_count`)
    })
    test(`${field} 항목 51자 거부`, async () => {
      const { error } = await save({ [field]: ['a'.repeat(51)] })
      assertConstraint(error, `profiles_${field}_items`)
    })
    test(`${field} 빈 항목·공백(줄바꿈·탭 포함) 항목·null 항목 거부`, async () => {
      for (const bad of [[''], ['   '], ['\n\t'], [null]]) {
        const { error } = await save({ [field]: bad })
        assertConstraint(error, `profiles_${field}_items`)
      }
    })
  }

  test('거부된 저장은 DB를 바꾸지 않는다', async () => {
    const row = await profileRow(u.id)
    assert.equal(row.engines.length, 30)
    assert.equal([...row.summary].length, 2000)
  })
})

describe('is_profile_empty(): 호출한 본인 기준으로만 판정', () => {
  let a
  let b
  before(async () => {
    a = await newUser('s1-empty-a')
    b = await newUser('s1-empty-b')
  })

  const isEmpty = async (u) => {
    const { data, error } = await u.client.rpc('is_profile_empty')
    assert.equal(error, null)
    return data
  }

  test('행이 없으면 true', async () => {
    assert.equal(await isEmpty(a), true)
  })

  test('텍스트가 공백뿐이고 배열이 비어 있으면 true', async () => {
    await a.client.from('profiles').insert({ summary: '   ', strengths: '\n', gaps: null })
    assert.equal(await isEmpty(a), true)
  })

  test('하나라도 채워지면 false (텍스트 또는 배열)', async () => {
    await a.client.from('profiles').update({ skills: ['C#'] }).eq('user_id', a.id)
    assert.equal(await isEmpty(a), false)
    await a.client.from('profiles').update({ skills: [], gaps: '네트워크' }).eq('user_id', a.id)
    assert.equal(await isEmpty(a), false)
  })

  test('다른 사용자의 프로필 유무는 알 수 없다: A가 채워져 있어도 B가 부르면 B 기준(true)', async () => {
    assert.equal(await isEmpty(a), false)
    assert.equal(await isEmpty(b), true)
  })

  test('인자를 넘겨도 다른 사용자를 지정할 수 없다', async () => {
    const { error } = await b.client.rpc('is_profile_empty', { p_user_id: a.id })
    assert.ok(error, '인자를 받는 함수가 없어야 한다')
  })

  test('로그아웃 상태에서는 실행할 수 없다', async () => {
    const { error } = await anonClient().rpc('is_profile_empty')
    assert.equal(error?.code, '42501')
  })
})

describe('샘플 채우기: 프로필이 비어 있으면 가상 프로필도 채운다 (design.md 4.1 5단계)', () => {
  test('빈 계정 → 지원 건 6개 + 프로필 생성', async () => {
    const u = await newUser('s1-seed')
    const { data, error } = await u.client.rpc('seed_sample_data')
    assert.equal(error, null)
    assert.equal(data, 6)
    const row = await profileRow(u.id)
    assert.ok(row, '프로필이 만들어져야 한다')
    assert.match(row.summary, /샘플 프로필/)
    assert.ok(row.engines.length > 0 && row.skills.length > 0)
    const { data: empty } = await u.client.rpc('is_profile_empty')
    assert.equal(empty, false)
  })

  test('빈 프로필 행이 이미 있으면 그 행을 채운다', async () => {
    const u = await newUser('s1-seed-blank')
    await u.client.from('profiles').insert({ summary: ' ' })
    const { error } = await u.client.rpc('seed_sample_data')
    assert.equal(error, null)
    assert.match((await profileRow(u.id)).summary, /샘플 프로필/)
  })

  test('직접 쓴 프로필은 덮어쓰지 않는다', async () => {
    const u = await newUser('s1-seed-keep')
    await u.client.from('profiles').insert(FULL)
    const { error } = await u.client.rpc('seed_sample_data')
    assert.equal(error, null)
    const row = await profileRow(u.id)
    assert.equal(row.summary, FULL.summary)
    assert.deepEqual(row.skills, FULL.skills)
  })

  test('지원 건이 있어 거부되면 프로필도 만들지 않는다', async () => {
    const u = await newUser('s1-seed-reject')
    await u.client.from('applications').insert({ company: '가상게임즈', position: 'x' })
    const { error } = await u.client.rpc('seed_sample_data')
    assert.equal(error?.message, 'SAMPLE_NOT_EMPTY')
    assert.equal(await profileRow(u.id), null)
  })

  test('동시 10건이어도 프로필은 1행', async () => {
    const u = await newUser('s1-seed-race')
    const results = await Promise.all(Array.from({ length: 10 }, () => u.client.rpc('seed_sample_data')))
    assert.equal(results.filter((r) => r.error === null).length, 1)
    const count = await withDb(async (db) => Number((await db.query('select count(*) from public.profiles where user_id = $1', [u.id])).rows[0].count))
    assert.equal(count, 1)
  })

  test('샘플 프로필은 다른 계정에 보이지 않는다', async () => {
    const other = await newUser('s1-seed-other')
    const { data } = await other.client.from('profiles').select('*')
    assert.deepEqual(data, [])
  })
})

describe('권한 설정 점검 (profiles)', () => {
  test('authenticated는 select·insert·update·delete만, anon은 없음', async () => {
    const grants = await withDb(async (db) =>
      (
        await db.query(
          `select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
             from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'authenticated', 'PUBLIC')
            group by grantee`,
        )
      ).rows,
    )
    assert.deepEqual(grants, [{ grantee: 'authenticated', privs: 'DELETE,INSERT,SELECT,UPDATE' }])
  })

  test('RLS가 켜져 있고 정책 4개가 모두 authenticated 대상', async () => {
    const r = await withDb(async (db) => ({
      rls: (await db.query(`select relrowsecurity from pg_class where oid = 'public.profiles'::regclass`)).rows[0].relrowsecurity,
      policies: (
        await db.query(`select cmd, roles::text[] as roles from pg_policies where schemaname = 'public' and tablename = 'profiles' order by cmd`)
      ).rows,
    }))
    assert.equal(r.rls, true)
    assert.deepEqual(
      r.policies.map((p) => [p.cmd, p.roles]),
      [
        ['DELETE', ['authenticated']],
        ['INSERT', ['authenticated']],
        ['SELECT', ['authenticated']],
        ['UPDATE', ['authenticated']],
      ],
    )
  })

  test('함수: search_path 비어 있음, 실행 권한·변동성', async () => {
    const fns = await withDb(async (db) =>
      (
        await db.query(
          `select p.proname, p.proconfig, p.provolatile,
                  has_function_privilege('anon', p.oid, 'execute') as anon_exec,
                  has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('is_profile_empty', 'validate_profile_items', 'seed_sample_data')
            order by p.proname`,
        )
      ).rows,
    )
    const by = Object.fromEntries(fns.map((f) => [f.proname, f]))
    for (const f of fns) assert.deepEqual(f.proconfig, ['search_path=""'], f.proname)
    assert.deepEqual(
      { anon: by.is_profile_empty.anon_exec, auth: by.is_profile_empty.auth_exec, vol: by.is_profile_empty.provolatile },
      { anon: false, auth: true, vol: 's' },
    )
    assert.deepEqual({ anon: by.validate_profile_items.anon_exec, auth: by.validate_profile_items.auth_exec }, { anon: false, auth: false })
    assert.deepEqual(
      { anon: by.seed_sample_data.anon_exec, auth: by.seed_sample_data.auth_exec, vol: by.seed_sample_data.provolatile },
      { anon: false, auth: true, vol: 'v' },
    )
  })
})
