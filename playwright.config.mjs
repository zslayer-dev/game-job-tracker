// 로컬 화면 교차 검증(npm run test:e2e). 로컬 스택 + 로컬 개발 서버 전용, CI에서는 돌리지 않는다.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  // 함수 서버(analyze-posting)를 AI_MOCK=ok로 띄우고 끝나면 내린다
  globalSetup: './tests/e2e/global-setup.mjs',
  // 테스트 사용자를 공유하므로 한 줄로 실행한다
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    // 브라우저를 따로 받지 않고 Windows 기본 Edge를 쓴다
    channel: 'msedge',
    trace: 'off',
  },
  webServer: {
    command: 'npm run dev --prefix web',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
