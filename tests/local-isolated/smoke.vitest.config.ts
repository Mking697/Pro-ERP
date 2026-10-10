import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: path.resolve(__dirname, '../..'),
  test: {
    environment: 'node', include: ['tests/local-isolated/smoke.test.ts'],
    setupFiles: [path.resolve(__dirname, 'setup.ts')],
    fileParallelism: false, testTimeout: 20000, hookTimeout: 20000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
});
