import { describe, expect, it, vi } from 'vitest';
import { runPendingFactoryBacklogTask } from '../pending-factory-backlog';

describe('runPendingFactoryBacklogTask', () => {
  it('reads the configured threshold and uses a day-stable aggregate dedupe key', async () => {
    const scan = vi.fn().mockResolvedValue({
      count: 7,
      threshold: 5,
      representativeOrder: {
        id: 'order-oldest',
        orderNo: 'GD-260902-001',
      },
    });
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await expect(
      runPendingFactoryBacklogTask('2026-09-02', undefined, {
        configuration: async () => ({ enabled: true, threshold: 5 }),
        scan,
        dispatch,
      }),
    ).resolves.toEqual({
      status: 'ok',
      runDate: '2026-09-02',
      enabled: true,
      pendingCount: 7,
      notified: true,
    });

    expect(scan).toHaveBeenCalledExactlyOnceWith(5);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      'PENDING_FACTORY_BACKLOG',
      {
        orderId: 'order-oldest',
        orderNo: 'GD-260902-001',
        summary: '当前待工厂确认 7 单，已达到提醒阈值 5 单',
        deepLink: '/orders#wo=GD-260902-001',
      },
      {
        dedupeKey: 'notification:PENDING_FACTORY_BACKLOG:2026-09-02',
      },
    );
    expect(dispatch.mock.calls[0]?.[1]).not.toHaveProperty('totalAmount');
  });

  it('does not touch the database scanner when the setting switch is off', async () => {
    const scan = vi.fn();
    const dispatch = vi.fn();

    await expect(
      runPendingFactoryBacklogTask('2026-09-02', undefined, {
        configuration: async () => ({ enabled: false, threshold: 5 }),
        scan,
        dispatch,
      }),
    ).resolves.toMatchObject({ enabled: false, notified: false });
    expect(scan).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch below threshold', async () => {
    const dispatch = vi.fn();

    await expect(
      runPendingFactoryBacklogTask('2026-09-02', undefined, {
        configuration: async () => ({ enabled: true, threshold: 5 }),
        scan: vi.fn().mockResolvedValue(null),
        dispatch,
      }),
    ).resolves.toMatchObject({ enabled: true, notified: false });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
