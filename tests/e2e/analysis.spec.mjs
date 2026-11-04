// S4 화면 검증: AI 분석 → 저장 → 새로고침 유지(#11), 원문 수정 시 버튼 비활성(#23), 오류 문구(#12 구분),
// 남은 횟수 갱신, 연타 방지, 텍스트로만 렌더링.
// 로컬 스택 + 함수 서버 AI_MOCK=ok(global-setup.mjs). 실제 AI는 부르지 않는다.
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { createTestUser, deleteTestUsers, withDb } from '../helpers/local.mjs'

const webEnv = readFileSync(new URL('../../web/.env.local', import.meta.url), 'utf8')
const webApiUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(webEnv)?.[1]?.trim()
if (!webApiUrl || !['127.0.0.1', 'localhost'].includes(new URL(webApiUrl).hostname)) {
  throw new Error('web/.env.local의 VITE_SUPABASE_URL이 로컬 스택이 아니면 E2E를 실행하지 않는다')
}
const STORAGE_KEY = `sb-${new URL(webApiUrl).hostname.split('.')[0]}-auth-token`

test.describe.configure({ mode: 'serial' })

const users = []
test.afterAll(async () => {
  await deleteTestUsers(users)
})

async function newUser(label, { profile = true } = {}) {
  const u = await createTestUser(label)
  users.push(u)
  if (profile) {
    await u.client.from('profiles').insert({ summary: '클라이언트 프로그래머 3년', engines: ['Unity'], skills: ['C#'] })
  }
  return u
}

async function newApp(u, posting = 'Unity 클라이언트 프로그래머. C# 필수, GAS 우대.') {
  const { data } = await u.client.from('applications').insert({ company: '가상게임즈', position: '클라이언트', posting_text: posting }).select('id').single()
  return data.id
}

async function openDetail(page, u, appId) {
  const { data } = await u.client.auth.getSession()
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(data.session)])
  await page.goto(`/applications/${appId}`)
  await expect(page.getByRole('heading', { name: 'AI 공고 분석' })).toBeVisible()
}

const analyzeButton = (page) => page.getByRole('button', { name: /^(AI 분석|분석 중…)$/ })

test('분석 → 결과 표시 → 저장 → 새로고침 후에도 저장된 결과 (#11), 남은 횟수 갱신, 연타는 1회', async ({ page }) => {
  const u = await newUser('e2e-ai-ok')
  const appId = await newApp(u)
  const calls = []
  page.on('request', (req) => {
    if (req.url().includes('/functions/v1/analyze-posting') && req.method() === 'POST') calls.push(req.url())
  })

  await openDetail(page, u, appId)
  await expect(page.getByText('오늘 남은 분석 10 / 10회')).toBeVisible()
  await expect(page.getByTestId('analysis-saved')).toHaveCount(0)

  // 다시 그려지기 전에 5번 연달아 누른다
  await analyzeButton(page).evaluate((el) => {
    for (let i = 0; i < 5; i++) el.click()
  })
  const fresh = page.getByTestId('analysis-new')
  await expect(fresh).toBeVisible()
  await expect(fresh).toContainText('적합도 72 / 100')
  await expect(fresh).toContainText('(로컬 흉내 결과) Unity와 C# 경험이')
  await expect(fresh.getByRole('listitem')).toHaveText(['C#', 'Unity', 'GAS'])
  await expect(page.getByText('오늘 남은 분석 9 / 10회')).toBeVisible()
  expect(calls).toHaveLength(1)

  // 저장 전에는 DB에 없다
  const count = () => withDb(async (db) => Number((await db.query('select count(*) from public.ai_analyses where application_id = $1', [appId])).rows[0].count))
  expect(await count()).toBe(0)

  await fresh.getByRole('button', { name: '결과 저장' }).click()
  await expect(page.getByText('분석 결과를 저장했습니다.')).toBeVisible()
  await expect(page.getByTestId('analysis-new')).toHaveCount(0)
  await expect(page.getByTestId('analysis-saved')).toContainText('적합도 72 / 100')
  expect(await count()).toBe(1)

  await page.reload()
  const savedBox = page.getByTestId('analysis-saved')
  await expect(savedBox).toContainText('적합도 72 / 100')
  await expect(savedBox).toContainText('(로컬 흉내 결과) Unity와 C# 경험이')
  await expect(page.getByText('오늘 남은 분석 9 / 10회')).toBeVisible()
})

test('공고 원문을 고치면 분석 버튼 비활성 + 안내, 저장하면 다시 활성 (#23)', async ({ page }) => {
  const u = await newUser('e2e-ai-dirty')
  const appId = await newApp(u)
  await openDetail(page, u, appId)

  await expect(analyzeButton(page)).toBeEnabled()
  const posting = page.getByRole('textbox', { name: /공고 원문/ })
  await posting.fill('수정한 공고 원문. Unreal 필수.')
  await expect(analyzeButton(page)).toBeDisabled()
  await expect(page.getByText('공고 원문을 고쳤습니다. 분석하려면 먼저 저장해 주세요.')).toBeVisible()

  // 원래대로 되돌리면 다시 활성
  await posting.fill('Unity 클라이언트 프로그래머. C# 필수, GAS 우대.')
  await expect(analyzeButton(page)).toBeEnabled()

  await posting.fill('수정한 공고 원문. Unreal 필수.')
  await expect(analyzeButton(page)).toBeDisabled()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '저장했습니다.' }).first()).toBeVisible()
  await expect(analyzeButton(page)).toBeEnabled()
  await expect(page.getByText('공고 원문을 고쳤습니다. 분석하려면 먼저 저장해 주세요.')).toHaveCount(0)
})

test('오류 문구: 프로필 없음 / 원문 없음 / 사용자 한도 (횟수는 서버 기준으로 표시)', async ({ page }) => {
  // 프로필 없음
  const noProfile = await newUser('e2e-ai-noprofile', { profile: false })
  await openDetail(page, noProfile, await newApp(noProfile))
  await analyzeButton(page).click()
  await expect(page.getByRole('alert')).toHaveText('먼저 경력 프로필을 입력해 주세요.')
  await expect(page.getByText('오늘 남은 분석 10 / 10회')).toBeVisible()

  // 원문 없음
  const noPosting = await newUser('e2e-ai-noposting')
  await page.goto('about:blank')
  await openDetail(page, noPosting, await newApp(noPosting, null))
  await analyzeButton(page).click()
  await expect(page.getByRole('alert')).toHaveText('공고 원문을 입력하고 저장한 뒤 분석해 주세요.')

  // 사용자 한도: 오늘 10회를 이미 쓴 상태
  const full = await newUser('e2e-ai-full')
  await withDb((db) => db.query(`insert into public.ai_usage (user_id, result) select $1, '성공' from generate_series(1, 10)`, [full.id]))
  await page.goto('about:blank')
  await openDetail(page, full, await newApp(full))
  await expect(page.getByText('오늘 남은 분석 0 / 10회')).toBeVisible()
  await analyzeButton(page).click()
  await expect(page.getByRole('alert')).toHaveText('오늘 분석 횟수를 모두 사용했습니다. 내일 다시 시도해 주세요.')
})

test('저장된 분석의 HTML·스크립트 문자열은 텍스트로만 보인다', async ({ page }) => {
  const u = await newUser('e2e-ai-text')
  const appId = await newApp(u)
  const evil = '<img src=x onerror="window.__xss=1"><b>굵게</b>'
  await withDb((db) =>
    db.query(
      `insert into public.ai_analyses (application_id, user_id, fit_score, matched_skills, missing_skills, comment) values ($1, $2, 50, $3, '{}', $4)`,
      [appId, u.id, ['<script>window.__xss=2</script>'], evil],
    ),
  )
  await openDetail(page, u, appId)
  const savedBox = page.getByTestId('analysis-saved')
  await expect(savedBox).toContainText(evil)
  await expect(savedBox).toContainText('<script>window.__xss=2</script>')
  await expect(savedBox.locator('img, b, script')).toHaveCount(0)
  expect(await page.evaluate(() => window.__xss)).toBeUndefined()
})
