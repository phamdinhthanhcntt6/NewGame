import { defineConfig } from 'vitest/config';

/** TCSS_PORT lets parallel worktrees run their own dev server (default 5180). No @types/node here, hence globalThis. */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const port = Number(env.TCSS_PORT ?? 5180);

export default defineConfig({
  server: { port, strictPort: true },
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
