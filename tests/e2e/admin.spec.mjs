// C2 화면 검증: 관리자 화면 동작(#24·#25·#26·#27 화면 쪽), 일반 사용자 접근 거부, 허용 목록 모드의 분석 버튼.
// 로컬 스택 + 함수 서버 AI_MOCK=ok(global-setup.mjs). 관리자 지정은 운영처럼 DB에 직접 넣는다.
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
let boss
let target

const sql = (text, params = []) => withDb(async (db) => (await db.query(text, params)).rows)
const setMode = (m) => sql('update public.ai_settings set access_mode = $1', [m])

test.beforeAll(async () => {
  await setMode('all')
  boss = await createTestUser('e2e-admin')
  target = await createTestUser('e2e-admin-target')
  users.push(boss, target)
  await sql('insert into public.admins (user_id) values ($1)', [boss.id])
})

test.afterAll(async () => {
  await setMode('all')
  await sql('delete from public.admin_actions where actor_id = any($1)', [users.map((u) => u.id)])
  await deleteTestUsers(users)
})

async function loginAs(page, user) {
  const { data } = await user.client.auth.getSession()
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(data.session)])
}

const row = (page, user) => page.locator(`tr[data-email="${user.email}"]`)

test('일반 사용자: 메뉴가 없고, /admin에 직접 들어와도 FORBIDDEN 안내만 보인다 (#24)', async ({ page }) => {
  const listCalls = []
  page.on('response', (res) => {
    if (res.url().includes('/rpc/admin_list_users')) listCalls.push(res.status())
  })
  await loginAs(page, target)
  await page.goto('/')
  await expect(page.getByRole('link', { name: '내 프로필' })).toBeVisible()
  await expect(page.getByRole('link', { name: '관리자' })).toHaveCount(0)

  await page.goto('/admin')
  await expect(page.getByRole('alert')).toHaveText('이 작업을 할 권한이 없습니다.')
  await expect(page.locator('table')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '허용 목록만' })).toHaveCount(0)
  await expect(page.getByText(boss.email)).toHaveCount(0)
  // 서버(DB 함수)가 거부했다
  expect(listCalls.length).toBeGreaterThan(0)
  expect(listCalls.every((s) => s >= 400)).toBe(true)
})

test('관리자: 메뉴 → 유저 목록(이메일·가입일·마지막 로그인·지원 건 수·오늘 AI·허용 여부)', async ({ page }) => {
  await target.client.from('applications').insert([
    { company: '가상1', position: 'x' },
    { company: '가상2', position: 'x' },
    { company: '가상3', position: 'x' },
  ])
  await sql(`insert into public.ai_usage (user_id, result) select $1, '성공' from generate_series(1, 4)`, [target.id])

  await loginAs(page, boss)
  await page.goto('/')
  await page.getByRole('link', { name: '관리자' }).click()
  await expect(page).toHaveURL('/admin')
  await expect(page.getByRole('heading', { name: '관리자' })).toBeVisible()

  const r = row(page, target)
  await expect(r).toBeVisible()
  const cells = r.locator('td')
  await expect(cells.nth(0)).toHaveText(target.email)
  await expect(cells.nth(1)).not.toHaveText('—') // 가입일
  await expect(cells.nth(2)).not.toHaveText('—') // 마지막 로그인
  await expect(cells.nth(3)).toHaveText('3')
  await expect(cells.nth(4)).toHaveText('4 / 10')
  await expect(cells.nth(5)).toContainText('허용')
  await expect(page.getByRole('button', { name: '전체 허용' })).toHaveAttribute('aria-pressed', 'true')
})

test('허용 목록이 비어 있으면 "허용 목록만" 전환 전에 경고하고, 취소하면 그대로 (#26 화면)', async ({ page }) => {
  await loginAs(page, boss)
  await page.goto('/admin')
  await expect(row(page, target)).toBeVisible()

  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    d.dismiss()
  })
  await page.getByRole('button', { name: '허용 목록만' }).click()
  expect(message).toContain('허용 목록이 비어 있습니다')
  await expect(page.getByRole('button', { name: '전체 허용' })).toHaveAttribute('aria-pressed', 'true')
  expect((await sql('select access_mode from public.ai_settings'))[0].access_mode).toBe('all')
})

test('허용 목록에 넣고 "허용 목록만"으로 바꾸면 경고 없이 바뀌고, 목록 밖 사용자는 차단으로 보인다. 기록이 남는다 (#26·#27)', async ({ page }) => {
  await loginAs(page, boss)
  await page.goto('/admin')
  const r = row(page, target)

  await r.getByRole('button', { name: '목록에 넣기' }).click()
  await expect(page.getByRole('status')).toContainText('허용 목록에 넣었습니다')
  await expect(r.getByRole('button', { name: '목록에서 빼기' })).toBeVisible()
  await expect(r.locator('td').nth(5)).toContainText('목록')

  let dialogs = 0
  page.on('dialog', (d) => {
    dialogs++
    d.dismiss()
  })
  await page.getByRole('button', { name: '허용 목록만' }).click()
  await expect(page.getByRole('button', { name: '허용 목록만' })).toHaveAttribute('aria-pressed', 'true')
  expect(dialogs).toBe(0)
  // 관리자 자신은 목록에 없으므로 차단으로 보인다(자동 허용 안 함)
  await expect(row(page, boss).locator('td').nth(5)).toContainText('차단')
  await expect(r.locator('td').nth(5)).toContainText('허용')

  const actions = await sql(
    `select action, target_user_id, detail from public.admin_actions where actor_id = $1 order by created_at, id`,
    [boss.id],
  )
  expect(actions.map((a) => a.action)).toEqual(['ai_allow', 'mode_change'])
  expect(actions[1].detail).toEqual({ from: 'all', to: 'allowlist' })
})

test('허용 목록 모드: 목록 밖 사용자는 상세 화면에서 분석 버튼이 꺼지고 권한 안내가 보인다 (#26)', async ({ page }) => {
  // 앞 테스트에서 모드 = allowlist, target만 목록에 있음
  const outsider = await createTestUser('e2e-admin-outsider')
  users.push(outsider)
  await outsider.client.from('profiles').insert({ summary: '요약', skills: ['C#'] })
  const { data: app } = await outsider.client.from('applications').insert({ company: '가상', position: 'x', posting_text: '공고' }).select('id').single()

  await loginAs(page, outsider)
  await page.goto(`/applications/${app.id}`)
  await expect(page.getByText('AI 분석 사용 권한이 없습니다. 관리자에게 문의해 주세요.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 분석' })).toBeDisabled()
})

test('오늘 사용 횟수 초기화: 확인 후 4 / 10 → 0 / 10, 호출 기록은 그대로 (#25)', async ({ page }) => {
  await loginAs(page, boss)
  await page.goto('/admin')
  const r = row(page, target)
  await expect(r.locator('td').nth(4)).toHaveText('4 / 10')

  // 취소하면 아무 일도 없다
  page.once('dialog', (d) => d.dismiss())
  await r.getByRole('button', { name: '횟수 초기화' }).click()
  await expect(r.locator('td').nth(4)).toHaveText('4 / 10')

  page.once('dialog', (d) => d.accept())
  await r.getByRole('button', { name: '횟수 초기화' }).click()
  await expect(page.getByRole('status')).toContainText('초기화했습니다')
  await expect(r.locator('td').nth(4)).toHaveText('0 / 10')

  const usage = await sql('select count(*)::int as n from public.ai_usage where user_id = $1', [target.id])
  expect(usage[0].n).toBe(4)
  const resets = await sql(`select count(*)::int as n from public.admin_actions where actor_id = $1 and action = 'quota_reset'`, [boss.id])
  expect(resets[0].n).toBe(1)
})

test('"전체 허용"으로 되돌리면 모두 허용으로 보인다', async ({ page }) => {
  await loginAs(page, boss)
  await page.goto('/admin')
  await page.getByRole('button', { name: '전체 허용' }).click()
  await expect(page.getByRole('button', { name: '전체 허용' })).toHaveAttribute('aria-pressed', 'true')
  await expect(row(page, boss).locator('td').nth(5)).toContainText('허용')
})
