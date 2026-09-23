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

// L-15 follow-up：PM2 用 ecosystem 文件 startOrReload 时，应用环境取自文件里
// 的 env 块，不会带上调用 shell 的 APP_VERSION（2026-09-17 发布记录已实测）。
// update.sh 导出的发布 SHA 必须经由 ecosystem env 交给三个进程，否则新旧进程
// 版本相同，旧 worker 残留心跳仍能满足 jobs 门禁。
describe('PM2 release version', () => {
  const configPath = require.resolve('../ecosystem.config.cjs');

  function loadWithAppVersion(value: string | undefined) {
    const previous = process.env.APP_VERSION;
    if (value === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = value;
    delete require.cache[configPath];
    try {
      return require(configPath) as {
        apps: Array<{ name: string; env: Record<string, string | undefined> }>;
      };
    } finally {
      if (previous === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = previous;
      delete require.cache[configPath];
    }
  }

  it('passes the exported APP_VERSION to the web and both workers', () => {
    const loaded = loadWithAppVersion('0123456789abcdef0123456789abcdef01234567');
    expect(loaded.apps.map((app) => app.name).sort()).toEqual([
      'print-shop-erp',
      'print-shop-erp-worker-heavy',
      'print-shop-erp-worker-light',
    ]);
    for (const app of loaded.apps) {
      expect(app.env.APP_VERSION).toBe('0123456789abcdef0123456789abcdef01234567');
    }
  });

  it.each([undefined, '', '   '])(
    'omits APP_VERSION when the shell has no usable value (%j) so .env still applies',
    (value) => {
      const loaded = loadWithAppVersion(value);
      for (const app of loaded.apps) {
        expect(app.env).not.toHaveProperty('APP_VERSION');
      }
    },
  );
});
