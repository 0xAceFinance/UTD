import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setupEnv.ts'],
    // Every integration test hits the same shared in-memory MongoDB instance
    // (see test/globalSetup.ts) and several tests rely on real wall-clock
    // ordering (cancellation rate limits, duel timers) -- running test files
    // in parallel workers against one shared DB would make them interfere
    // with each other's data. Sequential is slower but deterministic, which
    // matters a lot more for money-handling logic than raw test speed.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': dirname,
    },
  },
});
