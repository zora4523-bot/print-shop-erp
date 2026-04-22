import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      '.next/**',
      '_reference/**',
      'generated/**',
      'tests/e2e/**',
      'tests/visual/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/__tests__/**', 'lib/utils.ts'],
    },
  },
});
