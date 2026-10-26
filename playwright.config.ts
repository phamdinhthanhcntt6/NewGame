import { defineConfig, devices } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // no @types/node in this project

/** Must match vite.config.ts; set TCSS_PORT to test a worktree without reusing another checkout's server. */
const baseURL = `http://localhost:${process.env.TCSS_PORT ?? 5180}`;

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
