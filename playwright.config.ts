import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// 이 환경은 Chromium이 /opt/pw-browsers에 미리 설치되어 있다(playwright install 금지).
// 버전이 맞지 않으면 그 안의 실행 파일을 직접 쓴다.
const local = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(local) ? local : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Pixel 5'],
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
    launchOptions: { executablePath, args: ['--no-sandbox'] },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
