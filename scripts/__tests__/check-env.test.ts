import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production APP_PUBLIC_URL transport guard', () => {
  it.each([
    'http://erp.example.com',
    'http://10.0.0.8:3000',
    'https://operator:password@erp.example.com',
    'https://erp.example.com/erp',
    'https://erp.example.com?tenant=print-shop',
    'https://erp.example.com/#cron',
    ' https://erp.example.com',
    'not a URL',
  ])('fail-closes an unsafe URL: %s', async (url) => {
    const result = await runCheckEnv({ APP_PUBLIC_URL: url });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('APP_PUBLIC_URL 必须是不带路径');
  });

  it.each([
    'https://erp.example.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('accepts TLS or an explicit loopback URL: %s', async (url) => {
    const result = await runCheckEnv({ APP_PUBLIC_URL: url });
    expect(result.code).toBe(0);
  });
});

describe('WeCom smart bot credential guard', () => {
  it.each([
    {
      configured: { WECOM_SMART_BOT_ID: 'bot-id-placeholder' },
      missing: 'WECOM_SMART_BOT_SECRET',
    },
    {
      configured: { WECOM_SMART_BOT_SECRET: 'rotated-secret-placeholder' },
      missing: 'WECOM_SMART_BOT_ID',
    },
  ])('rejects a partial credential pair missing $missing', async ({ configured, missing }) => {
    const result = await runCheckEnv(configured);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`缺 ${missing}`);
    expect(result.stdout).toContain('必须成对配置或成对留空');
  });

  it.each(['', 'inline'])('requires durable jobs in production when mode is %j', async (mode) => {
    const result = await runCheckEnv({
      BACKGROUND_JOBS_MODE: mode,
      WECOM_SMART_BOT_ID: 'bot-id-placeholder',
      WECOM_SMART_BOT_SECRET: 'rotated-secret-placeholder',
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('长连接只能由单个常驻 LIGHT worker 持有');
  });

  it('accepts a complete credential pair with durable jobs in production', async () => {
    const result = await runCheckEnv({
      WECOM_SMART_BOT_ID: 'bot-id-placeholder',
      WECOM_SMART_BOT_SECRET: 'rotated-secret-placeholder',
    });

    expect(result.code).toBe(0);
  });

  it('keeps the legacy webhook-only deployment valid when both values are empty', async () => {
    const result = await runCheckEnv();

    expect(result.code).toBe(0);
  });
});

function runCheckEnv(
  overrides: Record<string, string | undefined> = {},
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve('scripts/check-env.mjs')], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
        AUTH_SECRET: 'test-auth-secret-that-is-long-enough',
        CRON_SECRET: 'test-cron-secret-that-is-long-enough',
        AUTH_TRUST_HOST: 'true',
        BACKGROUND_JOBS_MODE: 'durable',
        NOTIFICATION_MOCK_MODE: 'false',
        WECOM_SMART_BOT_ID: '',
        WECOM_SMART_BOT_SECRET: '',
        APP_PUBLIC_URL: 'https://erp.example.com',
        APP_VERSION: 'test',
        PDF_CHROMIUM_VERSION: '152.0.7977.75',
        PDF_ORDER_MODE: 'direct',
        PDF_ARTIFACT_DIR: '/tmp/print-shop-erp-pdf-test',
        ORDER_EXPORT_ARTIFACT_DIR: '/tmp/print-shop-erp-export-test',
        ...overrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.once('error', rejectRun);
    child.once('close', (code) => resolveRun({ code, stdout }));
  });
}

describe('portable PDF deployment configuration', () => {
  it('rejects an unknown single-order execution mode', async () => {
    expect((await runCheckEnv({ PDF_ORDER_MODE: 'unknown' })).code).toBe(1);
  });
  it('rejects an unpinned production browser', async () => {
    expect((await runCheckEnv({ PDF_CHROMIUM_VERSION: '' })).code).toBe(1);
  });
  it('rejects implicit temporary PDF storage in production', async () => {
    expect((await runCheckEnv({ PDF_ARTIFACT_DIR: '' })).code).toBe(1);
  });
  it('rejects unknown storage backends', async () => {
    expect((await runCheckEnv({ PDF_ARTIFACT_STORAGE: 'unknown' })).code).toBe(1);
  });
});

it('requires an explicit PDF mode before production startup', async () => {
  const result = await runCheckEnv({ PDF_ORDER_MODE: '' });
  expect(result.code).toBe(1);
  expect(result.stdout).toContain('PDF_ORDER_MODE 必须显式配置');
});
