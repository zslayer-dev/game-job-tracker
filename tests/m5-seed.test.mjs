// M5 검증: 샘플 데이터 채우기 seed_sample_data() (PRD 10장 #7, #8)
// 실행: npm run test:db   (로컬 스택 전용)
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { anonClient, createTestUser, deleteTestUsers, withDb } from './helpers/local.mjs'

const users = []

after(async () => {
  await deleteTestUsers(users)
})

async function newUser(label) {
  const u = await createTestUser(label)
  users.push(u)
  return u
}

async function countOf(userId) {
  return withDb(async (db) => Number((await db.query('select count(*) from public.applications where user_id = $1', [userId])).rows[0].count))
}

describe('#8 빈 계정에서 동시에 여러 번 요청해도 한 세트만 들어간다', () => {
  test('같은 계정 동시 10건 → 1건 성공, 9건 SAMPLE_NOT_EMPTY, 지원 건 6개', async () => {
    const u = await newUser('m5-race')
    const results = await Promise.all(Array.from({ length: 10 }, () => u.client.rpc('seed_sample_data')))

    const ok = results.filter((r) => r.error === null)
    const rejected = results.filter((r) => r.error?.message === 'SAMPLE_NOT_EMPTY')
    const other = results.filter((r) => r.error && r.error.message !== 'SAMPLE_NOT_EMPTY')
    assert.deepEqual(
      { ok: ok.length, rejected: rejected.length, other: other.map((r) => r.error.message) },
      { ok: 1, rejected: 9, other: [] },
    )
    assert.equal(ok[0].data, 6, '성공한 호출은 넣은 건수 6을 돌려준다')
    assert.equal(await countOf(u.id), 6)
  })
})

describe('#7 샘플 채우기·다른 계정 격리·재요청 거부', () => {
  let a
  let b

  test('처음 로그인한 계정 A에서 채우면 6건이 들어온다', async () => {
    a = await newUser('m5-a')
    const { data, error } = await a.client.rpc('seed_sample_data')
    assert.equal(error, null)
    assert.equal(data, 6)
    const { data: list } = await a.client.from('applications').select('id')
    assert.equal(list.length, 6)
  })

  test('다른 계정 B에는 A의 샘플이 보이지 않는다', async () => {
    b = await newUser('m5-b')
    const { data, error } = await b.client.from('applications').select('id, user_id')
    assert.equal(error, null)
    assert.deepEqual(data, [])
  })

  test('B도 자기 계정에 따로 채울 수 있고, A의 건 수는 그대로다', async () => {
    const { data, error } = await b.client.rpc('seed_sample_data')
    assert.equal(error, null)
    assert.equal(data, 6)
    assert.equal(await countOf(b.id), 6)
    assert.equal(await countOf(a.id), 6)
    const { data: bList } = await b.client.from('applications').select('user_id')
    assert.ok(bList.every((r) => r.user_id === b.id))
  })

  test('지원 건이 있는 상태에서 다시 요청하면 거부되고 건수는 그대로다', async () => {
    const { data, error } = await a.client.rpc('seed_sample_data')
    assert.equal(data, null)
    assert.equal(error?.message, 'SAMPLE_NOT_EMPTY')
    assert.equal(await countOf(a.id), 6)
  })

  test('직접 1건만 추가한 계정도 거부된다', async () => {
    const c = await newUser('m5-manual')
    await c.client.from('applications').insert({ company: '내가 넣은 회사', position: '클라이언트' })
    const { error } = await c.client.rpc('seed_sample_data')
    assert.equal(error?.message, 'SAMPLE_NOT_EMPTY')
    assert.equal(await countOf(c.id), 1)
  })

  test('로그아웃 상태에서는 실행 권한이 없다', async () => {
    const { error } = await anonClient().rpc('seed_sample_data')
    assert.equal(error?.code, '42501')
  })
})

describe('샘플 내용 (PRD 8장: 가상 회사, 공고 원문 포함, 수정·삭제 가능)', () => {
  let rows
  let u

  test('6건 모두 공고 원문이 있고 8,000자 이하', async () => {
    u = await newUser('m5-content')
    await u.client.rpc('seed_sample_data')
    const { data } = await u.client.from('applications').select('*')
    rows = data
    assert.equal(rows.length, 6)
    for (const r of rows) {
      assert.ok(r.posting_text && r.posting_text.length > 100, `${r.company} 공고 원문`)
      assert.ok([...r.posting_text].length <= 8000)
      assert.match(r.memo, /샘플 데이터/)
    }
  })

  test('지원일 빈 건과 있는 건이 섞여 있고 상태가 다양하다', () => {
    const empty = rows.filter((r) => r.applied_at === null).length
    assert.ok(empty >= 1, '지원일 빈 건 1개 이상')
    assert.ok(rows.length - empty >= 2, '지원일 있는 건 2개 이상')
    assert.ok(new Set(rows.map((r) => r.status)).size >= 4, '상태 4종 이상')
  })

  test('샘플도 일반 지원 건처럼 수정·삭제된다', async () => {
    const target = rows[0]
    const upd = await u.client.from('applications').update({ status: '최종 합격' }).eq('id', target.id).select().single()
    assert.equal(upd.error, null)
    assert.equal(upd.data.status, '최종 합격')
    const del = await u.client.from('applications').delete().eq('id', target.id).select('id')
    assert.equal(del.data.length, 1)
    assert.equal(await countOf(u.id), 5)
  })
})

describe('함수 설정 점검', () => {
  test('SECURITY INVOKER, search_path 빈 값, VOLATILE, authenticated만 실행', async () => {
    const fn = await withDb(async (db) =>
      (
        await db.query(
          `select p.prosecdef, p.proconfig, p.provolatile,
                  has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
                  has_function_privilege('anon', p.oid, 'execute') as anon_exec
             from pg_proc p
            where p.oid = 'public.seed_sample_data()'::regprocedure`,
        )
      ).rows[0],
    )
    assert.deepEqual(fn, {
      prosecdef: false,
      proconfig: ['search_path=""'],
      provolatile: 'v',
      auth_exec: true,
      anon_exec: false,
    })
  })
})
