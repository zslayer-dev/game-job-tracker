// M4 검증: 회사명 검색어가 정규식 메타문자·%·_·한글·대소문자 섞인 경우에도 글자 그대로 일치하는지 (#3 검색)
// 화면과 같은 이스케이프 함수(web/src/lib/search.ts)로 실제 로컬 DB(PostgREST imatch)에 질의한다.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { companySearchPattern, escapeRegex } from '../web/src/lib/search.ts'
import { createTestUser, deleteTestUsers } from './helpers/local.mjs'

const SPECIALS = ['\\', '.', '^', '$', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '%', '_']

// 각 특수문자마다: 글자 그대로 들어간 회사(정답)와, 그 문자가 와일드카드·정규식으로 해석되면 걸리는 회사(미끼)
const targets = SPECIALS.map((c) => `가${c}나 게임즈`)
const decoys = ['가X나 게임즈', '가나 게임즈', '가XX나 게임즈', '가가나나 게임즈', '나 게임즈', '가 게임즈', '\\가나']
const others = ['NeXon Korea', 'nexon 스튜디오', 'Nex0n 랩', '넥슨코리아', '넥스트 게임즈']
const companies = [...targets, ...decoys, ...others]

let user

before(async () => {
  user = await createTestUser('m4-search')
  const { error } = await user.client.from('applications').insert(companies.map((company) => ({ company, position: '클라이언트' })))
  assert.equal(error, null)
})

after(async () => {
  await deleteTestUsers([user])
})

async function search(query) {
  const pattern = companySearchPattern(query)
  let req = user.client.from('applications').select('company')
  if (pattern !== null) req = req.filter('company', 'imatch', pattern)
  const { data, error } = await req
  assert.equal(error, null, `검색어 ${JSON.stringify(query)}에서 DB 오류: ${error?.message}`)
  return data.map((r) => r.company).sort()
}

// 기대값: 글자 그대로 포함(대소문자 무시)하는 회사
function expected(query) {
  const q = query.trim().toLowerCase()
  return companies.filter((c) => c.toLowerCase().includes(q)).sort()
}

describe('escapeRegex', () => {
  test('메타문자 앞에만 \\ 를 붙이고 %·_·한글은 그대로 둔다', () => {
    assert.equal(escapeRegex('a.b*c'), 'a\\.b\\*c')
    assert.equal(escapeRegex('100%_게임'), '100%_게임')
    assert.equal(escapeRegex('\\'), '\\\\')
  })

  test('빈 검색어·공백은 필터 없음, 앞뒤 공백은 지운다', () => {
    assert.equal(companySearchPattern(''), null)
    assert.equal(companySearchPattern('   '), null)
    assert.equal(companySearchPattern('  넥슨 '), '넥슨')
  })
})

describe('#3 회사명 검색: 특수문자는 글자 그대로 일치', () => {
  for (const c of SPECIALS) {
    test(`'${c}' 포함 검색어 가${c}나`, async () => {
      const got = await search(`가${c}나`)
      assert.deepEqual(got, expected(`가${c}나`))
      assert.deepEqual(got, [`가${c}나 게임즈`], '정답 1건만 나와야 한다')
    })

    test(`'${c}' 한 글자만 검색`, async () => {
      assert.deepEqual(await search(c), expected(c))
    })
  }
})

describe('#3 회사명 검색: 한글·대소문자', () => {
  test('한글 부분 검색', async () => {
    assert.deepEqual(await search('넥슨'), ['넥슨코리아'])
    assert.deepEqual(await search('게임즈'), expected('게임즈'))
  })

  test('대소문자 섞인 검색어는 대소문자를 무시하고 일치', async () => {
    assert.deepEqual(await search('nExOn'), ['NeXon Korea', 'nexon 스튜디오'])
  })

  test('비슷하지만 다른 글자는 제외 (0 ≠ o)', async () => {
    assert.deepEqual(await search('Nex0n'), ['Nex0n 랩'])
  })

  test('한글과 영문·특수문자 혼합', async () => {
    assert.deepEqual(await search('XX나 게임'), ['가XX나 게임즈'])
  })

  test('없는 회사는 0건', async () => {
    assert.deepEqual(await search('존재하지않는회사'), [])
  })
})
