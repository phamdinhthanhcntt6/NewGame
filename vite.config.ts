import { defineConfig } from 'vitest/config';

declare const process: { env: Record<string, string | undefined> }; // no @types/node in this project

/** TCSS_PORT lets parallel worktrees run their own dev server (default 5180). */
const port = Number(process.env.TCSS_PORT ?? 5180);

export default defineConfig({
  server: { port, strictPort: true },
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
