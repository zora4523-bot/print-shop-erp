import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@next/env', () => ({ loadEnvConfig: vi.fn() }));
vi.mock('@playwright/test', () => ({ defineConfig: (value: unknown) => value, devices: { 'Desktop Chrome': {} } }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('E2E_APPEND_ONLY_DATABASE_ISOLATED', undefined);
  vi.stubEnv('E2E_APPEND_ONLY_DATABASE_REASON', undefined);
});
afterEach(() => vi.unstubAllEnvs());

it('worker 重新加载配置后仍使用隔离库与端口，不退回常规开发服务器', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:fixture@localhost:5432/regular');
  vi.stubEnv('E2E_DATABASE_URL', 'postgresql://test:fixture@localhost:5432/disposable');
  vi.stubEnv('E2E_ORIGINAL_DATABASE_TARGET', undefined);
  vi.stubEnv('E2E_BASE_URL', undefined);
  const first = (await import('../../playwright.config')).default;
  expect(first.use?.baseURL).toBe('http://localhost:3100');
  expect(process.env.DATABASE_URL).toContain('/disposable');
  vi.resetModules();
  const second = (await import('../../playwright.config')).default;
  expect(second.use?.baseURL).toBe('http://localhost:3100');
  expect(process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED).toBe('1');
});

it('常规库即使换用回环别名也不能冒充隔离库', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:fixture@localhost:5432/regular');
  vi.stubEnv('E2E_DATABASE_URL', 'postgresql://test:fixture@127.0.0.1:5432/regular');
  vi.stubEnv('E2E_ORIGINAL_DATABASE_TARGET', undefined);
  vi.stubEnv('E2E_BASE_URL', undefined);
  const config = (await import('../../playwright.config')).default;
  expect(config.use?.baseURL).toBe('http://localhost:3000');
  expect(process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED).toBe('0');
});
