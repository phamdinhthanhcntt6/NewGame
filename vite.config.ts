import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5180, strictPort: true },
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
