// 로컬 화면 교차 검증: 실제 화면을 조작해 PRD #1·#2·#5·#6·#8과 S1(프로필 저장·격리·샘플 프로필)을 확인한다.
// 로컬 스택 전용. 임시 사용자 A·B·C를 만들어 세션을 주입하고, 끝나면 지운다.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { admin, createTestUser, deleteTestUsers } from '../helpers/local.mjs'

// 개발 서버(web/.env.local)도 로컬 스택을 보고 있어야 한다. 아니면 실행하지 않는다.
const webEnv = readFileSync(new URL('../../web/.env.local', import.meta.url), 'utf8')
const webApiUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(webEnv)?.[1]?.trim()
if (!webApiUrl || !['127.0.0.1', 'localhost'].includes(new URL(webApiUrl).hostname)) {
  throw new Error('web/.env.local의 VITE_SUPABASE_URL이 로컬 스택이 아니면 E2E를 실행하지 않는다')
}

// supabase-js가 세션을 저장하는 localStorage 키 (sb-<호스트 첫 마디>-auth-token)
const STORAGE_KEY = `sb-${new URL(webApiUrl).hostname.split('.')[0]}-auth-token`

test.describe.configure({ mode: 'serial' })

let userA, userB, userC
const company = `E2E-A-${randomUUID().slice(0, 8)}`
let appId

test.beforeAll(async () => {
  userA = await createTestUser('e2e-a')
  userB = await createTestUser('e2e-b')
  userC = await createTestUser('e2e-c')
})

test.afterAll(async () => {
  await deleteTestUsers([userA, userB, userC])
})

// 브라우저가 앱을 열기 전에 세션을 넣어 둔다
async function loginAs(page, user) {
  const { data } = await user.client.auth.getSession()
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(data.session)])
}

const row = (page, name) => page.locator('table.list tbody tr').filter({ hasText: name })

test('A: 추가 → 목록에 보임 → 새로고침 후 유지 → 상태 변경 유지 (#1, #2)', async ({ page }) => {
  await loginAs(page, userA)
  await page.goto('/')
  await expect(page.getByText('첫 지원 건을 추가해 보세요.')).toBeVisible()

  await page.getByRole('link', { name: '지원 건 추가' }).first().click()
  await page.getByRole('textbox', { name: /회사명/ }).fill(company)
  await page.getByRole('textbox', { name: /포지션/ }).fill('E2E 클라이언트 프로그래머')
  await page.getByRole('button', { name: '추가' }).click()

  await expect(page).toHaveURL('/')
  await expect(row(page, company)).toBeVisible()
  await page.reload()
  await expect(row(page, company)).toBeVisible()
  await expect(row(page, company)).toContainText('관심')

  // 상태를 앞으로(면접) → 뒤로(관심) 바꾸고, 각각 새로고침 후에도 유지되는지 본다
  await row(page, company).getByRole('link', { name: company }).click()
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/)
  appId = page.url().split('/').pop()

  const status = page.getByRole('combobox', { name: '상태' })
  for (const next of ['면접', '관심']) {
    await status.selectOption(next)
    await page.getByRole('button', { name: '저장' }).click()
    await expect(page.getByRole('status').filter({ hasText: '저장했습니다.' })).toBeVisible()
    await page.reload()
    await expect(status).toHaveValue(next)
  }

  await status.selectOption('면접')
  await page.getByRole('button', { name: '저장' }).click()
  await expect(page.getByRole('status').filter({ hasText: '저장했습니다.' })).toBeVisible()
  await page.getByRole('link', { name: '← 목록' }).click()
  await expect(row(page, company)).toContainText('면접')

  const { data } = await admin.from('applications').select('status, user_id').eq('id', appId).single()
  expect(data).toEqual({ status: '면접', user_id: userA.id })
})

test('B: A의 건이 목록에 없고, 상세 주소는 "찾을 수 없음", 수정·삭제 불가 (#5)', async ({ page }) => {
  expect(appId).toBeTruthy()
  await loginAs(page, userB)

  await page.goto('/')
  await expect(page.getByText('첫 지원 건을 추가해 보세요.')).toBeVisible()
  await expect(page.getByText(company)).toHaveCount(0)

  await page.goto(`/applications/${appId}`)
  await expect(page.getByRole('alert')).toHaveText('지원 건을 찾을 수 없습니다.')
  // 화면에 편집 폼·삭제 버튼이 나오지 않는다
  await expect(page.getByRole('button', { name: '삭제' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '저장' })).toHaveCount(0)
  await expect(page.getByText(company)).toHaveCount(0)

  // 화면을 거치지 않고 B의 토큰으로 직접 수정·삭제해도 0건
  const upd = await userB.client.from('applications').update({ memo: 'B가 바꿈' }).eq('id', appId).select()
  expect(upd.error).toBeNull()
  expect(upd.data).toEqual([])
  const del = await userB.client.from('applications').delete().eq('id', appId).select()
  expect(del.error).toBeNull()
  expect(del.data).toEqual([])

  const { data } = await admin.from('applications').select('company, memo, status').eq('id', appId).single()
  expect(data).toEqual({ company, memo: null, status: '면접' })
})

test('로그아웃 상태: 보호된 주소는 로그인 화면으로, 지원 데이터 요청 없음 (#6)', async ({ page }) => {
  const restCalls = []
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/')) restCalls.push(req.url())
  })

  for (const path of ['/', '/applications/new', `/applications/${appId}`, '/profile']) {
    await page.goto(path)
    await expect(page).toHaveURL('/login')
    await expect(page.getByRole('button', { name: '구글 계정으로 로그인' })).toBeVisible()
  }
  expect(restCalls).toEqual([])
})

test('빈 계정에서 샘플 채우기를 빠르게 여러 번 눌러도 6건만 (#8)', async ({ page }) => {
  const seedCalls = []
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/seed_sample_data')) seedCalls.push(req.url())
  })

  await loginAs(page, userC)
  await page.goto('/')
  const button = page.getByRole('button', { name: '샘플 데이터 채우기' })
  await expect(button).toBeEnabled()

  // 다시 그려지기 전에 5번 연달아 누른다(사람의 연타보다 빠름)
  await button.evaluate((el) => {
    for (let i = 0; i < 5; i++) el.click()
  })

  await expect(page.locator('table.list tbody tr')).toHaveCount(6)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('table.list tbody tr')).toHaveCount(6)

  expect(seedCalls).toHaveLength(1)
  const { count } = await admin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userC.id)
  expect(count).toBe(6)

  // 프로필이 비어 있던 계정이라 가상 프로필도 함께 채워진다 (S1)
  await page.getByRole('link', { name: '내 프로필' }).click()
  await expect(page.getByRole('textbox', { name: /경력 요약/ })).toHaveValue(/샘플 프로필/)
  await expect(page.getByRole('group', { name: '주력 엔진' }).getByRole('listitem')).not.toHaveCount(0)
})

const profileSummary = `E2E 프로필 ${randomUUID().slice(0, 8)}`

test('A: 프로필 저장 → 새로고침 후 유지, 태그 추가·삭제 (S1)', async ({ page }) => {
  await loginAs(page, userA)
  await page.goto('/profile')

  const summary = page.getByRole('textbox', { name: /경력 요약/ })
  await expect(summary).toHaveValue('')
  await summary.fill(profileSummary)

  const engines = page.getByRole('group', { name: '주력 엔진' })
  const skills = page.getByRole('group', { name: '기술 스택' })
  // 엔진은 Enter로, 기술은 [추가] 버튼으로 넣는다
  for (const name of ['Unity', 'Unreal Engine 5']) {
    await engines.getByRole('textbox', { name: '주력 엔진 추가' }).fill(name)
    await engines.getByRole('textbox', { name: '주력 엔진 추가' }).press('Enter')
  }
  await expect(page).toHaveURL('/profile') // Enter가 폼을 제출하지 않는다
  for (const name of ['C#', 'C++']) {
    await skills.getByRole('textbox', { name: '기술 스택 추가' }).fill(name)
    await skills.getByRole('button', { name: '추가' }).click()
  }
  // 같은 항목은 다시 들어가지 않는다
  await skills.getByRole('textbox', { name: '기술 스택 추가' }).fill('c#')
  await skills.getByRole('button', { name: '추가' }).click()
  await expect(skills.getByText('이미 있는 항목입니다.')).toBeVisible()
  await expect(skills.getByRole('listitem')).toHaveCount(2)

  await page.getByRole('textbox', { name: /강점/ }).fill('프로파일링으로 최적화')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '저장했습니다.' })).toBeVisible()

  await page.reload()
  await expect(summary).toHaveValue(profileSummary)
  await expect(engines.getByRole('listitem')).toHaveText(['Unity×', 'Unreal Engine 5×'])
  await expect(skills.getByRole('listitem')).toHaveText(['C#×', 'C++×'])
  await expect(page.getByRole('textbox', { name: /강점/ })).toHaveValue('프로파일링으로 최적화')

  // 태그 삭제도 저장 후 유지
  await engines.getByRole('button', { name: 'Unity 삭제' }).click()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '저장했습니다.' })).toBeVisible()
  await page.reload()
  await expect(engines.getByRole('listitem')).toHaveText(['Unreal Engine 5×'])

  const { data } = await admin.from('profiles').select('summary, engines, skills').eq('user_id', userA.id).single()
  expect(data).toEqual({ summary: profileSummary, engines: ['Unreal Engine 5'], skills: ['C#', 'C++'] })
})

test('B: A의 프로필이 보이지 않고, 직접 요청해도 0건 (S1 교차 검증)', async ({ page }) => {
  await loginAs(page, userB)
  await page.goto('/profile')

  await expect(page.getByRole('textbox', { name: /경력 요약/ })).toHaveValue('')
  await expect(page.getByRole('group', { name: '주력 엔진' }).getByRole('listitem')).toHaveCount(0)
  await expect(page.getByText(profileSummary)).toHaveCount(0)

  const sel = await userB.client.from('profiles').select('*').eq('user_id', userA.id)
  expect(sel.data).toEqual([])
  const upd = await userB.client.from('profiles').update({ summary: 'B가 바꿈' }).eq('user_id', userA.id).select()
  expect(upd.data).toEqual([])

  const { data } = await admin.from('profiles').select('summary').eq('user_id', userA.id).single()
  expect(data.summary).toBe(profileSummary)
})
