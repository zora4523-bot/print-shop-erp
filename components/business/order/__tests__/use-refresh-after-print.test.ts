import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// 业主 2026-10-02 点打印即记已打印：回到本页时先刷新了一次（记录尚未完成），随后到达的「已记录」
// 通知不能被合并吞掉，须安排一次尾随刷新。
describe('refreshPageAfterPrint', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T00:00:10Z')); vi.resetModules(); });
  afterEach(() => { vi.useRealTimers(); });

  it('refreshes at once, merges requests within a second into one trailing refresh', async () => {
    const { refreshPageAfterPrint } = await import('../use-refresh-after-print');
    const router = { refresh: vi.fn() };
    refreshPageAfterPrint(router);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    refreshPageAfterPrint(router);
    refreshPageAfterPrint(router);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(499);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(router.refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(router.refresh).toHaveBeenCalledTimes(2);
    refreshPageAfterPrint(router);
    expect(router.refresh).toHaveBeenCalledTimes(3);
  });
});
