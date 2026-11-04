// E2E 전역 준비: 로컬 함수 서버(analyze-posting)를 AI_MOCK=ok로 새로 띄운다.
// 실제 AI는 부르지 않는다. 이전에 떠 있던 함수 컨테이너의 env(다른 모드)가 섞이지 않게 매번 다시 띄운다.
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FN_URL = 'http://127.0.0.1:54321/functions/v1/analyze-posting'

export default async function globalSetup() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-fn-'))
  const file = join(dir, 'functions.env')
  writeFileSync(file, ['ALLOWED_ORIGINS=http://localhost:5173', 'AI_MOCK=ok', ''].join('\n'))

  // 셸 명령 한 줄로 넘긴다(경로는 tmpdir 아래 우리가 만든 것). 인자 배열 + shell은 Node가 경고한다(DEP0190).
  const server = spawn(`npx supabase functions serve --env-file "${file}"`, { shell: true, detached: process.platform !== 'win32' })
  let ready = false
  const onData = (chunk) => {
    if (chunk.toString().includes('Serving functions')) ready = true
  }
  server.stdout.on('data', onData)
  server.stderr.on('data', onData)

  const deadline = Date.now() + 120_000
  for (;;) {
    if (ready) {
      const r = await fetch(FN_URL, { method: 'OPTIONS' }).catch(() => null)
      if (r?.status === 204) break
    }
    if (Date.now() > deadline) throw new Error('함수 서버가 뜨지 않았다')
    await new Promise((res) => setTimeout(res, 500))
  }

  return async () => {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' })
      else process.kill(-server.pid, 'SIGTERM')
    } catch {
      // 이미 종료됨
    }
    rmSync(dir, { recursive: true, force: true })
  }
}
