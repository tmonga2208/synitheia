import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one in-memory Mongo; parallel files would race on
    // the same collections and produce flakes that look like real dedupe failures.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
