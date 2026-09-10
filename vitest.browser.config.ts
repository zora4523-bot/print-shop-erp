import path from 'node:path';
import { createRequire } from 'node:module';
import type AxeBuilder from '@axe-core/playwright';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js', {
  paths: [path.dirname(require.resolve('@axe-core/playwright'))],
});

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;

declare module 'vitest/browser' {
  interface BrowserCommands {
    checkShellAccessibility(selector?: string): Promise<AxeResults['violations']>;
  }
}

export default defineConfig({
  // Prebundle chart and select dependencies before mounting React browser fixtures.
  // Discovering it mid-test can reload the module graph with another React instance.
  optimizeDeps: { include: ['recharts', '@base-ui/react/select'] },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    include: ['**/*.browser.spec.tsx'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      commands: {
        async checkShellAccessibility({ frame }, selector = '[data-testid="admin-shell-fixture"], [data-slot="sheet-content"]') {
          const testFrame = await frame();
          await testFrame.addScriptTag({ path: axePath });
          return testFrame.evaluate(async (scope) => {
            const { axe } = window as unknown as {
              axe: { run: (selector: string) => Promise<AxeResults> };
            };
            const result = await axe.run(scope);
            return result.violations;
          }, selector);
        },
      },
    },
  },
});
