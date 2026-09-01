import { describe, expect, it, vi } from 'vitest';
import {
  deriveProductionProgressAnomalies,
  deriveProductionStagnationCandidates,
  runProductionAlertNotificationTask,
  type ProductionAlertFactSource,
  type ProductionWorkOrderProgressFact,
} from '../production-alerts';

function progress(
  id: string,
  operationType: 'FOILING' | 'PACKING',
  completedQty: number,
  reportedAt: string,
): ProductionWorkOrderProgressFact {
  return {
    id,
    orderId: 'order-1',
    orderNo: 'GD-260902-001',
    operationType,
    completedQty,
    reportedAt: new Date(reportedAt),
  };
}

describe('deriveProductionProgressAnomalies', () => {
  it('emits only false-to-true edges and allows a later resolved anomaly to reappear', () => {
    const result = deriveProductionProgressAnomalies([
      progress('p-2', 'PACKING', 20, '2026-09-02T01:01:00.000Z'),
      progress('f-1', 'FOILING', 10, '2026-09-02T01:00:00.000Z'),
      progress('f-2', 'FOILING', 20, '2026-09-02T01:02:00.000Z'),
      progress('p-3', 'PACKING', 15, '2026-09-02T01:03:00.000Z'),
    ]);

    expect(result).toEqual([
      {
        orderId: 'order-1',
        orderNo: 'GD-260902-001',
        triggerProgressId: 'p-2',
        foilingProgress: '10',
        packingProgress: '20',
      },
      {
        orderId: 'order-1',
        orderNo: 'GD-260902-001',
        triggerProgressId: 'p-3',
        foilingProgress: '30',
        packingProgress: '35',
      },
    ]);
  });

  it('does not infer an anomaly from payroll/task facts because the API accepts only work-order progress', () => {
    expect(
      deriveProductionProgressAnomalies([
        progress('f-1', 'FOILING', 20, '2026-09-02T01:00:00.000Z'),
        progress('p-1', 'PACKING', 20, '2026-09-02T01:01:00.000Z'),
      ]),
    ).toEqual([]);
  });
});

describe('deriveProductionStagnationCandidates', () => {
  const releasedOrders = [
    {
      orderId: 'order-1',
      orderNo: 'GD-260902-001',
      releaseKey: 'release-v2',
      releasedAt: new Date('2026-08-31T00:00:00.000Z'),
    },
  ];

  it('becomes stagnant exactly at the configured threshold', () => {
    expect(
      deriveProductionStagnationCandidates({
        releasedOrders,
        claims: [],
        now: new Date('2026-09-02T00:00:00.000Z'),
        thresholdDays: 2,
      }),
    ).toEqual(releasedOrders);
  });

  it('requires a claim at or after this release generation', () => {
    const base = {
      id: 'claim-1',
      orderId: 'order-1',
      reporterId: 'worker-1',
      idempotencyKey: 'claim-idempotency-1',
    };
    expect(
      deriveProductionStagnationCandidates({
        releasedOrders,
        claims: [
          { ...base, claimedAt: new Date('2026-08-30T23:59:59.000Z') },
        ],
        now: new Date('2026-09-02T00:00:00.000Z'),
        thresholdDays: 2,
      }),
    ).toHaveLength(1);
    expect(
      deriveProductionStagnationCandidates({
        releasedOrders,
        claims: [
          { ...base, claimedAt: new Date('2026-08-31T00:00:00.000Z') },
        ],
        now: new Date('2026-09-02T00:00:00.000Z'),
        thresholdDays: 2,
      }),
    ).toEqual([]);
  });
});

describe('runProductionAlertNotificationTask', () => {
  it('uses fact ids/release keys for stable dedupe and sends no amount fields', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const source: ProductionAlertFactSource = {
      load: vi.fn().mockResolvedValue({
        progress: [
          progress('progress-edge-1', 'PACKING', 5, '2026-09-02T01:00:00.000Z'),
        ],
        releasedOrders: [
          {
            orderId: 'order-2',
            orderNo: 'GD-260831-002',
            releaseKey: 'release-order-2-v1',
            releasedAt: new Date('2026-08-30T00:00:00.000Z'),
          },
        ],
        claims: [],
      }),
    };

    await expect(
      runProductionAlertNotificationTask(
        '2026-09-02',
        source,
        undefined,
        {
          configuration: async () => ({
            anomalyEnabled: true,
            stagnationEnabled: true,
            stagnationDays: 2,
            scanBatchSize: 200,
          }),
          now: () => new Date('2026-09-02T00:00:00.000Z'),
          dispatch,
        },
      ),
    ).resolves.toEqual({
      status: 'ok',
      runDate: '2026-09-02',
      anomalyCount: 1,
      stagnationCount: 1,
    });

    expect(source.load).toHaveBeenCalledWith({ orderLimit: 200 });
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      'PRODUCTION_PROGRESS_ANOMALY',
      {
        orderId: 'order-1',
        orderNo: 'GD-260902-001',
        summary: '打包进度 5，烫金进度 0，请核对漏报',
        deepLink: '/orders#wo=GD-260902-001',
      },
      {
        dedupeKey:
          'notification:PRODUCTION_PROGRESS_ANOMALY:order-1:progress-edge-1',
        spreadIndex: 0,
      },
    );
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      'PRODUCTION_STAGNANT',
      {
        orderId: 'order-2',
        orderNo: 'GD-260831-002',
        summary: '下发后已满 2 天仍无有效扫码认领',
        deepLink: '/orders#wo=GD-260831-002',
      },
      {
        dedupeKey:
          'notification:PRODUCTION_STAGNANT:order-2:release-order-2-v1',
        spreadIndex: 1,
      },
    );
    for (const call of dispatch.mock.calls) {
      expect(call[1]).not.toHaveProperty('amount');
      expect(call[1]).not.toHaveProperty('totalAmount');
    }
  });

  it('does not load facts when both SystemSetting switches are off', async () => {
    const source: ProductionAlertFactSource = { load: vi.fn() };
    const dispatch = vi.fn();

    await runProductionAlertNotificationTask(
      '2026-09-02',
      source,
      undefined,
      {
        configuration: async () => ({
          anomalyEnabled: false,
          stagnationEnabled: false,
          stagnationDays: 2,
          scanBatchSize: 200,
        }),
        now: () => new Date('2026-09-02T00:00:00.000Z'),
        dispatch,
      },
    );

    expect(source.load).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('翻遍超过 batchSize 的键集页，后页活跃单不被最旧单永久挡住', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const firstCursor = {
      scheduledAt: new Date('2026-08-30T00:00:00.000Z'),
      orderId: 'order-1',
    };
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        progress: [],
        releasedOrders: [
          {
            orderId: 'order-1',
            orderNo: 'GD-260830-001',
            releaseKey: 'order-1:v1',
            releasedAt: firstCursor.scheduledAt,
          },
        ],
        claims: [],
        nextCursor: firstCursor,
      })
      .mockResolvedValueOnce({
        progress: [
          {
            ...progress(
              'later-page-edge',
              'PACKING',
              3,
              '2026-09-02T01:00:00.000Z',
            ),
            orderId: 'order-2',
            orderNo: 'GD-260902-002',
          },
        ],
        releasedOrders: [],
        claims: [],
        nextCursor: null,
      });
    const source: ProductionAlertFactSource = { load };

    await expect(
      runProductionAlertNotificationTask(
        '2026-09-02',
        source,
        undefined,
        {
          configuration: async () => ({
            anomalyEnabled: true,
            stagnationEnabled: false,
            stagnationDays: 2,
            scanBatchSize: 1,
          }),
          now: vi.fn(),
          dispatch,
        },
      ),
    ).resolves.toMatchObject({ anomalyCount: 1 });

    expect(load).toHaveBeenNthCalledWith(1, { orderLimit: 1 });
    expect(load).toHaveBeenNthCalledWith(2, {
      orderLimit: 1,
      cursor: firstCursor,
    });
    expect(dispatch).toHaveBeenCalledWith(
      'PRODUCTION_PROGRESS_ANOMALY',
      expect.objectContaining({ orderId: 'order-2' }),
      expect.objectContaining({
        dedupeKey:
          'notification:PRODUCTION_PROGRESS_ANOMALY:order-2:later-page-edge',
      }),
    );
  });
});
