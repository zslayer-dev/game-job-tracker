// M2 검증: applications 표의 제약·권한·상한 (PRD 10장 #4 DB 쪽, #5, #6, #22 memo·500건)
// 실행: npm run test:db   (로컬 스택 전용)
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { anonClient, createTestUser, deleteTestUsers, withDb } from './helpers/local.mjs'

const users = []
let a
let b

before(async () => {
  a = await createTestUser('m2-a')
  b = await createTestUser('m2-b')
  users.push(a, b)
})

after(async () => {
  await deleteTestUsers(users)
})

function row(overrides = {}) {
  return { company: '가상게임즈', position: '클라이언트 프로그래머', ...overrides }
}

function assertConstraint(error, name) {
  assert.ok(error, `오류가 나야 하는데 저장됐다 (${name})`)
  assert.equal(error.code, '23514')
  assert.match(error.message, new RegExp(name))
}

describe('#4 회사명·포지션이 비어 있으면 저장되지 않는다 (DB)', () => {
  test('빈 회사명 거부', async () => {
    const { error } = await a.client.from('applications').insert(row({ company: '' }))
    assertConstraint(error, 'applications_company_not_blank')
  })

  test('공백만 있는 회사명 거부', async () => {
    const { error } = await a.client.from('applications').insert(row({ company: '   ' }))
    assertConstraint(error, 'applications_company_not_blank')
  })

  test('빈 포지션 거부', async () => {
    const { error } = await a.client.from('applications').insert(row({ position: ' ' }))
    assertConstraint(error, 'applications_position_not_blank')
  })

  test('회사명 누락(null) 거부', async () => {
    const { error } = await a.client.from('applications').insert({ position: '클라이언트' })
    assert.equal(error?.code, '23502')
  })

  test('정상 값은 저장되고 기본 상태는 "관심"', async () => {
    const { data, error } = await a.client.from('applications').insert(row()).select().single()
    assert.equal(error, null)
    assert.equal(data.status, '관심')
    assert.equal(data.user_id, a.id)
  })
})

describe('입력 규칙: 선택지 밖의 status·channel 거부 (PRD 8장)', () => {
  test('잘못된 status 거부', async () => {
    const { error } = await a.client.from('applications').insert(row({ status: '합격' }))
    assertConstraint(error, 'applications_status_valid')
  })

  test('잘못된 channel 거부', async () => {
    const { error } = await a.client.from('applications').insert(row({ channel: '링크드인' }))
    assertConstraint(error, 'applications_channel_valid')
  })

  test('상태는 순서와 무관하게 바뀐다 (면접 → 관심)', async () => {
    const { data } = await a.client.from('applications').insert(row({ status: '면접' })).select().single()
    const { data: updated, error } = await a.client
      .from('applications')
      .update({ status: '관심' })
      .eq('id', data.id)
      .select()
      .single()
    assert.equal(error, null)
    assert.equal(updated.status, '관심')
    assert.ok(new Date(updated.updated_at) > new Date(data.updated_at), 'updated_at이 갱신돼야 한다')
  })
})

describe('#5 계정 B는 계정 A의 지원 건을 보거나 바꿀 수 없다', () => {
  let target

  before(async () => {
    const { data, error } = await a.client
      .from('applications')
      .insert(row({ company: 'A만의 회사', memo: '원래 메모' }))
      .select()
      .single()
    assert.equal(error, null)
    target = data
  })

  async function dbRow() {
    return withDb(async (db) => (await db.query('select * from public.applications where id = $1', [target.id])).rows[0])
  }

  test('B 목록에 A의 건이 없다', async () => {
    const { data, error } = await b.client.from('applications').select('id')
    assert.equal(error, null)
    assert.ok(!data.some((r) => r.id === target.id))
  })

  test('B가 A의 ID로 조회하면 0건', async () => {
    const { data, error } = await b.client.from('applications').select().eq('id', target.id)
    assert.equal(error, null)
    assert.deepEqual(data, [])
  })

  test('B가 A의 ID로 수정하면 0건이고 DB는 그대로', async () => {
    const { data, error } = await b.client.from('applications').update({ memo: '바뀜' }).eq('id', target.id).select()
    assert.equal(error, null)
    assert.deepEqual(data, [])
    const r = await dbRow()
    assert.equal(r.memo, '원래 메모')
    assert.equal(r.updated_at.toISOString(), new Date(target.updated_at).toISOString())
  })

  test('B가 A의 ID로 삭제하면 0건이고 DB에 남아 있다', async () => {
    const { data, error } = await b.client.from('applications').delete().eq('id', target.id).select()
    assert.equal(error, null)
    assert.deepEqual(data, [])
    assert.ok(await dbRow())
  })

  test('B가 user_id를 A로 지정해 추가하면 거부', async () => {
    const { error } = await b.client.from('applications').insert(row({ user_id: a.id }))
    assert.equal(error?.code, '42501')
  })

  test('B가 자기 건의 소유자를 A로 바꾸면 거부', async () => {
    const { data: mine } = await b.client.from('applications').insert(row()).select().single()
    const { error } = await b.client.from('applications').update({ user_id: a.id }).eq('id', mine.id)
    assert.equal(error?.code, '42501')
    const owner = await withDb(async (db) => (await db.query('select user_id from public.applications where id = $1', [mine.id])).rows[0].user_id)
    assert.equal(owner, b.id)
  })

  test('A는 자기 건을 조회할 수 있다', async () => {
    const { data } = await a.client.from('applications').select().eq('id', target.id)
    assert.equal(data.length, 1)
  })
})

describe('#6 로그아웃 상태의 조회·추가는 거부된다', () => {
  const anon = anonClient()

  test('조회는 권한 오류', async () => {
    const { data, error, status } = await anon.from('applications').select('id')
    assert.equal(error?.code, '42501', `status ${status}`)
    assert.equal(data, null)
  })

  test('추가는 권한 오류이고 DB에 들어가지 않는다', async () => {
    const before = await withDb(async (db) => Number((await db.query('select count(*) from public.applications')).rows[0].count))
    const { error } = await anon.from('applications').insert(row({ user_id: a.id }))
    assert.equal(error?.code, '42501')
    const afterCount = await withDb(async (db) => Number((await db.query('select count(*) from public.applications')).rows[0].count))
    assert.equal(afterCount, before)
  })
})

describe('#22 memo 5,000자 상한 (DB)', () => {
  test('5,000자는 저장된다', async () => {
    const { error } = await a.client.from('applications').insert(row({ memo: '가'.repeat(5000) }))
    assert.equal(error, null)
  })

  test('5,001자는 거부', async () => {
    const { error } = await a.client.from('applications').insert(row({ memo: '가'.repeat(5001) }))
    assertConstraint(error, 'applications_memo_len')
  })

  test('공고 원문 8,001자도 거부', async () => {
    const { error } = await a.client.from('applications').insert(row({ posting_text: 'a'.repeat(8001) }))
    assertConstraint(error, 'applications_posting_text_len')
  })
})

describe('#22 사용자당 지원 건 500건 상한 (DB)', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => row({ company: `회사 ${i + 1}` }))

  async function countOf(userId) {
    return withDb(async (db) => Number((await db.query('select count(*) from public.applications where user_id = $1', [userId])).rows[0].count))
  }

  test('500건까지 저장되고 501번째는 APP_LIMIT', async () => {
    const c = await createTestUser('m2-limit')
    users.push(c)
    const { error } = await c.client.from('applications').insert(many(500))
    assert.equal(error, null)
    assert.equal(await countOf(c.id), 500)

    const over = await c.client.from('applications').insert(row())
    assert.equal(over.error?.message, 'APP_LIMIT')
    assert.equal(await countOf(c.id), 500)
  })

  test('한 번에 501건을 넣으면 전부 거부(0건)', async () => {
    const c = await createTestUser('m2-bulk')
    users.push(c)
    const { error } = await c.client.from('applications').insert(many(501))
    assert.equal(error?.message, 'APP_LIMIT')
    assert.equal(await countOf(c.id), 0)
  })

  test('499건에서 동시에 2건 추가하면 1건만 통과', async () => {
    const c = await createTestUser('m2-race')
    users.push(c)
    await c.client.from('applications').insert(many(499))
    const results = await Promise.all([
      c.client.from('applications').insert(row({ company: '동시 1' })),
      c.client.from('applications').insert(row({ company: '동시 2' })),
    ])
    const ok = results.filter((r) => r.error === null).length
    const limited = results.filter((r) => r.error?.message === 'APP_LIMIT').length
    assert.deepEqual({ ok, limited }, { ok: 1, limited: 1 })
    assert.equal(await countOf(c.id), 500)
  })

  test('다른 사용자는 영향 없음 (A는 계속 추가 가능)', async () => {
    const { error } = await a.client.from('applications').insert(row())
    assert.equal(error, null)
  })
})

describe('권한 설정 점검 (운영 "새 표 자동 노출 끔"과 같은 결과인지)', () => {
  test('authenticated는 select·insert·update·delete만, anon은 없음', async () => {
    const grants = await withDb(async (db) =>
      (
        await db.query(
          `select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
             from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'applications' and grantee in ('anon', 'authenticated')
            group by grantee`,
        )
      ).rows,
    )
    assert.deepEqual(grants, [{ grantee: 'authenticated', privs: 'DELETE,INSERT,SELECT,UPDATE' }])
  })

  test('RLS가 켜져 있다', async () => {
    const rls = await withDb(async (db) => (await db.query(`select relrowsecurity from pg_class where oid = 'public.applications'::regclass`)).rows[0].relrowsecurity)
    assert.equal(rls, true)
  })

  test('트리거 함수는 아무도 직접 실행할 수 없고 search_path가 비어 있다', async () => {
    const fns = await withDb(async (db) =>
      (
        await db.query(
          `select p.proname,
                  p.proconfig,
                  has_function_privilege('anon', p.oid, 'execute') as anon_exec,
                  has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
                  p.provolatile
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('set_updated_at', 'enforce_application_limit')
            order by p.proname`,
        )
      ).rows,
    )
    assert.equal(fns.length, 2)
    for (const f of fns) {
      assert.deepEqual(f.proconfig, ['search_path=""'], f.proname)
      assert.equal(f.anon_exec, false, f.proname)
      assert.equal(f.auth_exec, false, f.proname)
      assert.equal(f.provolatile, 'v', `${f.proname}는 VOLATILE이어야 한다`)
    }
  })
})
