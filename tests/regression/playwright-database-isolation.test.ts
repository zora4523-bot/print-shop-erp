import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@next/env', () => ({ loadEnvConfig: vi.fn() }));
vi.mock('@playwright/test', () => ({ defineConfig: (value: unknown) => value, devices: { 'Desktop Chrome': {} } }));

beforeEach(() => {
  vi.resetModules();
  for (const key of ['NODE_ENV', 'E2E_RELEASE_MODE', 'NOTIFICATION_MOCK_MODE', 'CDR_BUNDLE_MOCK_MODE',
    'BACKGROUND_JOBS_MODE', 'AUTH_SECRET', 'AUTH_TRUST_HOST', 'CRON_SECRET', 'APP_PUBLIC_URL',
    'AUTH_URL', 'NEXTAUTH_URL', 'WECOM_SMART_BOT_ID', 'WECOM_SMART_BOT_SECRET']) vi.stubEnv(key, process.env[key]);
  vi.stubEnv('E2E_APPEND_ONLY_DATABASE_ISOLATED', undefined);
  vi.stubEnv('E2E_APPEND_ONLY_DATABASE_REASON', undefined);
  vi.stubEnv('E2E_DATABASE_CONFIRM_DATABASE', 'erp_e2e_disposable');
});
afterEach(() => vi.unstubAllEnvs());

it('worker 重新加载配置后仍使用隔离库与端口，不退回常规开发服务器', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:fixture@localhost:5432/regular');
  vi.stubEnv('E2E_DATABASE_URL', 'postgresql://test:fixture@localhost:5432/erp_e2e_disposable');
  vi.stubEnv('E2E_ORIGINAL_DATABASE_TARGET', undefined);
  vi.stubEnv('E2E_BASE_URL', undefined);
  const first = (await import('../../playwright.config')).default;
  expect(first.use?.baseURL).toBe('http://127.0.0.1:3100');
  expect(first.webServer).toMatchObject({ command: expect.stringContaining('pnpm run dev'), reuseExistingServer: false });
  expect(process.env.DATABASE_URL).toContain('/erp_e2e_disposable');
  vi.resetModules();
  const second = (await import('../../playwright.config')).default;
  expect(second.use?.baseURL).toBe('http://127.0.0.1:3100');
  expect(process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED).toBe('1');
});

it('常规库即使换用回环别名也不能冒充隔离库', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:fixture@localhost:5432/regular');
  vi.stubEnv('E2E_DATABASE_URL', 'postgresql://test:fixture@127.0.0.1:5432/regular');
  vi.stubEnv('E2E_ORIGINAL_DATABASE_TARGET', undefined);
  vi.stubEnv('E2E_BASE_URL', undefined);
  const config = (await import('../../playwright.config')).default;
  expect(config.use?.baseURL).toBe('http://127.0.0.1:3100');
  expect(config.webServer).toMatchObject({ reuseExistingServer: false });
  expect(process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED).toBe('0');
});


it('release builds and starts a controlled production server with safe mocks', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:fixture@localhost:5432/regular');
  vi.stubEnv('E2E_DATABASE_URL', 'postgresql://test:fixture@localhost:5432/erp_e2e_disposable');
  vi.stubEnv('E2E_ORIGINAL_DATABASE_TARGET', undefined);
  vi.stubEnv('E2E_BASE_URL', undefined);
  const config = (await import('../../playwright.release.config')).default;
  expect(config.use?.baseURL).toBe('http://127.0.0.1:3200');
  expect(config.webServer).toMatchObject({ reuseExistingServer: false, env: {
    NODE_ENV: 'production', E2E_RELEASE_MODE: '1',
    NOTIFICATION_MOCK_MODE: 'true', CDR_BUNDLE_MOCK_MODE: 'true',
    WECOM_SMART_BOT_ID: 'e2e-only-smart-bot', WECOM_SMART_BOT_SECRET: 'e2e-only-smart-bot-secret',
  } });
  expect(config.webServer).toMatchObject({ command: expect.stringMatching(/next build.*next start/) });
  expect(config.grepInvert).toEqual(/deterministic external sales price tier fixture/);
});


it('keeps dev-only fixture tests in their own admin viewport configuration', async () => {
  vi.stubEnv('E2E_BASE_URL', undefined);
  const config = (await import('../../playwright.dev-fixtures.config')).default;
  expect(config.grep).toEqual(/deterministic external sales price tier fixture/);
  expect(config.projects?.map((project) => project.use?.viewport)).toEqual([
    { width: 320, height: 568 }, { width: 375, height: 667 },
    { width: 390, height: 844 }, { width: 393, height: 852 },
    { width: 430, height: 932 }, { width: 768, height: 1024 },
    { width: 1024, height: 768 }, { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]);
  expect(config.projects?.every((project) => project.name?.startsWith('admin-'))).toBe(true);
});
