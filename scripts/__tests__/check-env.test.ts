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
    const result = await runCheckEnv(url);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('APP_PUBLIC_URL 必须是不带路径');
  });

  it.each([
    'https://erp.example.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('accepts TLS or an explicit loopback URL: %s', async (url) => {
    const result = await runCheckEnv(url);
    expect(result.code).toBe(0);
  });
});

function runCheckEnv(url: string): Promise<{ code: number | null; stdout: string }> {
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
        APP_PUBLIC_URL: url,
        APP_VERSION: 'test',
        PDF_ARTIFACT_DIR: '/tmp/print-shop-erp-pdf-test',
        ORDER_EXPORT_ARTIFACT_DIR: '/tmp/print-shop-erp-export-test',
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
