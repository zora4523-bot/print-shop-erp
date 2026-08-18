import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueCronJobMock, modeState, runCleanupMock } = vi.hoisted(() => ({
  enqueueCronJobMock: vi.fn(),
  modeState: { value: 'inline' as 'inline' | 'durable' },
  runCleanupMock: vi.fn(),
}));

vi.mock('@/lib/background-jobs/cron', () => ({
  enqueueCronJob: enqueueCronJobMock,
}));
vi.mock('@/lib/background-jobs/mode', () => ({
  backgroundJobsMode: () => modeState.value,
}));
vi.mock('@/lib/cron/schedule', () => ({
  shanghaiCalendarDate: () => '2026-08-07',
}));
vi.mock('@/lib/cron/tasks', () => ({
  runOrderExportCleanupTask: runCleanupMock,
}));

import { POST } from '../order-export-cleanup/route';

const SECRET = 'test-cron-secret-12345';
const originalCronSecret = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  modeState.value = 'inline';
  enqueueCronJobMock.mockReset();
  runCleanupMock.mockReset().mockResolvedValue({
    status: 'ok',
    runDate: '2026-08-07',
    expiredCount: 3,
    scrubbedFilterCount: 2,
  });
});

afterAll(() => {
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
});

function request(authorization?: string): Request {
  return new Request('http://localhost/api/cron/order-export-cleanup', {
    method: 'POST',
    headers: authorization ? { authorization } : undefined,
  });
}

describe('POST /api/cron/order-export-cleanup', () => {
  it('fails closed when the cron secret is absent or incorrect', async () => {
    delete process.env.CRON_SECRET;
    const notConfigured = await POST(request());
    expect(notConfigured.status).toBe(503);

    process.env.CRON_SECRET = SECRET;
    const unauthorized = await POST(request('Bearer wrong-secret'));
    expect(unauthorized.status).toBe(401);
    expect(runCleanupMock).not.toHaveBeenCalled();
    expect(enqueueCronJobMock).not.toHaveBeenCalled();
  });

  it('runs inline cleanup and returns counts without row details', async () => {
    const response = await POST(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      runDate: '2026-08-07',
      expiredCount: 3,
      scrubbedFilterCount: 2,
    });
    expect(runCleanupMock).toHaveBeenCalledExactlyOnceWith('2026-08-07');
  });

  it('does not expose filesystem or database error details', async () => {
    runCleanupMock.mockRejectedValue(
      new Error('EACCES /private/order-exports customer=13800000000'),
    );

    const response = await POST(request(`Bearer ${SECRET}`));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('导出产物清理失败');
    expect(body).not.toContain('EACCES');
    expect(body).not.toContain('/private/order-exports');
    expect(body).not.toContain('13800000000');
  });
});
