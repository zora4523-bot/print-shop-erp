import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const config = require('../ecosystem.config.cjs') as {
  apps: Array<{ name: string; args?: string; node_args?: string }>;
};

describe('PM2 production binding', () => {
  it('binds Next to loopback so direct traffic cannot bypass Nginx limits', () => {
    const web = config.apps.find((app) => app.name === 'print-shop-erp');
    expect(web?.args).toMatch(/(?:^|\s)(?:-H|--hostname)\s+127\.0\.0\.1(?:\s|$)/);
    expect(web?.args).toMatch(/(?:^|\s)(?:-p|--port)\s+3000(?:\s|$)/);
  });

  it('uses the React server export condition only for the LIGHT worker', () => {
    const light = config.apps.find(
      (app) => app.name === 'print-shop-erp-worker-light',
    );
    const heavy = config.apps.find(
      (app) => app.name === 'print-shop-erp-worker-heavy',
    );
    expect(light?.node_args).toMatch(
      /(?:^|\s)--conditions=react-server(?:\s|$)/,
    );
    expect(heavy?.node_args).not.toMatch(
      /(?:^|\s)--conditions=react-server(?:\s|$)/,
    );
    expect(light?.node_args).toMatch(/(?:^|\s)--import\s+tsx(?:\s|$)/);
    expect(heavy?.node_args).toMatch(/(?:^|\s)--import\s+tsx(?:\s|$)/);
  });
});
