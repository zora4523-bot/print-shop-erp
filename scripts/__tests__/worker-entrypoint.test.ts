import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('background worker package entrypoints', () => {
  it('starts the LIGHT worker with the React Server condition', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['worker:light']).toBe(
      'node --conditions=react-server --import tsx scripts/background-worker.ts --queue=LIGHT',
    );
  });

  it('keeps the production LIGHT worker on one forked process', () => {
    const ecosystem = require('../../deploy/ecosystem.config.cjs') as {
      apps: Array<{
        name: string;
        instances?: number;
        exec_mode?: string;
        node_args?: string;
      }>;
    };
    const light = ecosystem.apps.find(
      (app) => app.name === 'print-shop-erp-worker-light',
    );

    expect(light).toMatchObject({ instances: 1, exec_mode: 'fork' });
    expect(light?.node_args).toContain('--conditions=react-server');
  });
});
