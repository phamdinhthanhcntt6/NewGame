import { defineConfig, devices } from '@playwright/test';

/** Must match vite.config.ts; set TCSS_PORT to test a worktree without reusing another checkout's server. */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const baseURL = `http://localhost:${env.TCSS_PORT ?? 5180}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
