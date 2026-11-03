// 로컬 Supabase 스택 전용 테스트 도우미. 운영 프로젝트에는 절대 연결하지 않는다.
import { execSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))

for (const url of [status.API_URL, status.DB_URL]) {
  const host = new URL(url).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`로컬 스택이 아닌 곳(${host})에는 테스트를 실행하지 않는다`)
  }
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

export const env = { apiUrl: status.API_URL, dbUrl: status.DB_URL }

// 테스트 준비·정리용. 이 키는 테스트 코드 밖으로 나가지 않는다.
export const admin = createClient(status.API_URL, status.SECRET_KEY, noPersist)

// 로그인하지 않은 브라우저와 같은 상태
export function anonClient() {
  return createClient(status.API_URL, status.PUBLISHABLE_KEY, noPersist)
}

export async function createTestUser(label) {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`
  const password = randomBytes(18).toString('base64url')
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const client = anonClient()
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  return { id: data.user.id, email, client }
}

export async function deleteTestUsers(users) {
  for (const u of users) {
    if (u) await admin.auth.admin.deleteUser(u.id)
  }
}

// DB를 직접 확인할 때 쓴다(RLS를 거치지 않는 관리자 연결)
export async function withDb(fn) {
  const db = new pg.Client({ connectionString: status.DB_URL })
  await db.connect()
  try {
    return await fn(db)
  } finally {
    await db.end()
  }
}
