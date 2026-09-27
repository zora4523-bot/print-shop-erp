import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, txMock } = vi.hoisted(() => {
  const tx = {
    notificationLog: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    backgroundJob: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    businessAuditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  const mock = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  return { dbMock: mock, txMock: tx };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { BackgroundJobStatus, Role } from '../../../generated/prisma/enums';
import { resolveUnknownNotification } from '../resolve';

beforeEach(() => {
  dbMock.$transaction.mockClear();
  txMock.notificationLog.findUnique.mockReset();
  txMock.notificationLog.updateMany
    .mockReset()
    .mockResolvedValue({ count: 1 });
  txMock.notificationLog.count.mockReset().mockResolvedValue(0);
  txMock.notificationLog.findMany.mockReset().mockResolvedValue([]);
  txMock.backgroundJob.findUnique.mockReset();
  txMock.backgroundJob.updateMany
    .mockReset()
    .mockResolvedValue({ count: 1 });
  txMock.businessAuditLog.create
    .mockReset()
    .mockResolvedValue({ id: 'audit-1' });
  txMock.$queryRaw
    .mockReset()
    .mockResolvedValue([{ now: new Date('2026-08-22T08:00:00Z') }]);
});

describe('resolveUnknownNotification', () => {
  const actor = {
    id: 'owner-1',
    role: Role.ADMIN,
    username: 'owner',
    displayName: '管理员',
  };
  const attemptedAt = new Date('2026-08-22T07:55:00Z');
  const log = {
    id: 'log-1',
    eventType: 'ORDER_SUBMITTED',
    status: 'UNKNOWN',
    errorMessage: 'HTTP 500',
    deliveryKey: 'notification:ORDER_SUBMITTED:order-1',
    deliveryStateVersion: 7,
    sentAt: null,
    lastAttemptAt: attemptedAt,
  };
  const job = {
    id: 'job-1',
    type: 'NOTIFICATION',
    status: BackgroundJobStatus.DEAD as BackgroundJobStatus,
    payload: {
      event: 'ORDER_SUBMITTED',
      payload: { orderId: 'order-1', orderNo: 'GD-1' },
    } as Record<string, unknown>,
    result: { event: 'ORDER_SUBMITTED', unknown: 1 },
    attempts: 5,
    maxAttempts: 5,
    lastErrorCode: 'NotificationDeliveryUnknownError',
  };

  function lockDurableJob(jobValue = job) {
    txMock.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: jobValue.id }])
      .mockResolvedValue([{ now: new Date('2026-08-22T08:00:00Z') }]);
    txMock.backgroundJob.findUnique.mockResolvedValue(jobValue);
  }

  it('atomically confirms an inline delivery with a version CAS and an audit row', async () => {
    txMock.notificationLog.findUnique.mockResolvedValue({
      ...log,
      deliveryKey: null,
    });

    await expect(
      resolveUnknownNotification('log-1', 'DELIVERED', actor, 7),
    ).resolves.toEqual({
      backgroundJobId: null,
      pendingUnknownCount: 0,
      rearmed: false,
      completed: true,
      retiredClosedCount: 0,
    });

    expect(txMock.notificationLog.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'log-1',
        status: 'UNKNOWN',
        deliveryStateVersion: 7,
      },
      data: expect.objectContaining({
        status: 'SUCCESS',
        errorMessage: '人工核对：已送达',
        sentAt: attemptedAt,
        deliveryStateVersion: { increment: 1 },
      }),
    });
    expect(txMock.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(txMock.businessAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'owner-1',
        action: 'CONFIRM_NOTIFICATION_DELIVERED',
        entityType: 'NotificationLog',
        entityId: 'log-1',
      }),
      select: expect.any(Object),
    });
  });

  it('ignores an inline UNKNOWN as terminal FAILED and audits actor, time, and trimmed reason', async () => {
    txMock.notificationLog.findUnique.mockResolvedValue({
      ...log,
      deliveryKey: null,
    });

    await expect(
      resolveUnknownNotification(
        'log-1',
        'IGNORED',
        actor,
        7,
        '  业务已电话确认，无需补发  ',
      ),
    ).resolves.toEqual({
      backgroundJobId: null,
      pendingUnknownCount: 0,
      rearmed: false,
      completed: true,
      retiredClosedCount: 0,
    });

    expect(txMock.notificationLog.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'log-1',
        status: 'UNKNOWN',
        deliveryStateVersion: 7,
      },
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: '人工忽略：业务已电话确认，无需补发',
        sentAt: null,
        deliveryJobAttempt: null,
        deliveryStateVersion: { increment: 1 },
      }),
    });
    expect(txMock.businessAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'owner-1',
        actorUsername: 'owner',
        action: 'IGNORE_NOTIFICATION_DELIVERY',
        entityType: 'NotificationLog',
        entityId: 'log-1',
        after: expect.objectContaining({
          status: 'FAILED',
          resolvedAt: '2026-08-22T08:00:00.000Z',
        }),
        requestMetadata: expect.objectContaining({
          resolution: 'IGNORED',
          reason: '业务已电话确认，无需补发',
        }),
      }),
      select: expect.any(Object),
    });
  });

  it('rejects IGNORE without a non-empty audit reason before opening a transaction', async () => {
    await expect(
      resolveUnknownNotification('log-1', 'IGNORED', actor, 7, '   '),
    ).rejects.toMatchObject({ code: 'INVALID_REASON' });

    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.notificationLog.updateMany).not.toHaveBeenCalled();
    expect(txMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('closes the original DEAD job when its final UNKNOWN is confirmed delivered', async () => {
    txMock.notificationLog.findUnique.mockResolvedValue(log);
    lockDurableJob();

    await expect(
      resolveUnknownNotification('log-1', 'DELIVERED', actor, 7),
    ).resolves.toEqual({
      backgroundJobId: 'job-1',
      pendingUnknownCount: 0,
      rearmed: false,
      completed: true,
      retiredClosedCount: 0,
    });

    expect(txMock.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        type: 'NOTIFICATION',
        status: BackgroundJobStatus.DEAD,
        attempts: 5,
        maxAttempts: 5,
        lastErrorCode: 'NotificationDeliveryUnknownError',
      },
      data: expect.objectContaining({
        status: BackgroundJobStatus.SUCCEEDED,
        result: expect.objectContaining({
          event: 'ORDER_SUBMITTED',
          unknown: 0,
          manuallyResolved: true,
        }),
        lastErrorCode: null,
      }),
    });
  });

  it('keeps transport and workflow outcomes distinct when the final durable UNKNOWN is ignored', async () => {
    txMock.notificationLog.findUnique.mockResolvedValue(log);
    lockDurableJob();

    await expect(
      resolveUnknownNotification(
        'log-1',
        'IGNORED',
        actor,
        7,
        '业务不需要再补发',
      ),
    ).resolves.toEqual({
      backgroundJobId: 'job-1',
      pendingUnknownCount: 0,
      rearmed: false,
      completed: true,
      retiredClosedCount: 0,
    });

    expect(txMock.notificationLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: '人工忽略：业务不需要再补发',
        }),
      }),
    );
    expect(txMock.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'job-1',
        status: BackgroundJobStatus.DEAD,
      }),
      data: expect.objectContaining({
        status: BackgroundJobStatus.SUCCEEDED,
        result: expect.objectContaining({
          unknown: 0,
          manuallyResolved: true,
        }),
      }),
    });
  });

  describe('retired events (客服周期通知已于 2026-09-24 删除)', () => {
    const retiredLog = {
      ...log,
      eventType: 'CS_PERIOD_ENDING',
      deliveryKey: 'notification:CS_PERIOD_ENDING:period-1',
    };
    const retiredJob = {
      ...job,
      payload: { event: 'CS_PERIOD_ENDING', payload: { periodId: 'period-1' } },
      result: { event: 'CS_PERIOD_ENDING', unknown: 1 },
    };

    it('refuses to re-arm a resend that the current handler can only reject', async () => {
      txMock.notificationLog.findUnique.mockResolvedValue(retiredLog);
      lockDurableJob(retiredJob);

      await expect(
        resolveUnknownNotification('log-1', 'NOT_DELIVERED_RETRY', actor, 7),
      ).rejects.toMatchObject({ code: 'RETIRED_EVENT' });

      expect(txMock.notificationLog.updateMany).not.toHaveBeenCalled();
      expect(txMock.backgroundJob.updateMany).not.toHaveBeenCalled();
      expect(txMock.businessAuditLog.create).not.toHaveBeenCalled();
    });

    it('still lets the owner ignore it and closes the dead job', async () => {
      txMock.notificationLog.findUnique.mockResolvedValue(retiredLog);
      lockDurableJob(retiredJob);

      await expect(
        resolveUnknownNotification('log-1', 'IGNORED', actor, 7, '客服已删除'),
      ).resolves.toMatchObject({ completed: true, rearmed: false });
      expect(txMock.backgroundJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BackgroundJobStatus.SUCCEEDED }),
        }),
      );
    });

    it('still lets the owner confirm it as delivered', async () => {
      txMock.notificationLog.findUnique.mockResolvedValue({
        ...retiredLog,
        eventType: 'CS_PERIOD_SETTLED',
      });
      lockDurableJob({
        ...retiredJob,
        payload: { event: 'CS_PERIOD_SETTLED', payload: {} },
      });

      await expect(
        resolveUnknownNotification('log-1', 'DELIVERED', actor, 7),
      ).resolves.toMatchObject({ completed: true });
    });

    // Pre-upgrade state: one sibling was already confirmed not delivered
    // (RETRYING, job still DEAD); the owner now closes the last UNKNOWN row.
    describe.each([
      {
        resolution: 'DELIVERED' as const,
        reason: undefined,
        siblingMessage: '人工核对：未送达；事件已停用，不再重发',
      },
      {
        resolution: 'IGNORED' as const,
        reason: '客服已删除',
        siblingMessage: '人工忽略：客服已删除',
      },
    ])('RETRYING + UNKNOWN mix closed with $resolution', ({ resolution, reason, siblingMessage }) => {
      const retrying = [
        { id: 'log-r1', deliveryStateVersion: 3 },
        { id: 'log-r2', deliveryStateVersion: 9 },
      ];

      beforeEach(() => {
        txMock.notificationLog.findUnique.mockResolvedValue(retiredLog);
        lockDurableJob(retiredJob);
        txMock.notificationLog.findMany.mockResolvedValue(retrying);
      });

      it('never re-arms the job, closes the RETRYING siblings and keeps the DEAD job as history', async () => {
        await expect(
          resolveUnknownNotification('log-1', resolution, actor, 7, reason),
        ).resolves.toEqual({
          backgroundJobId: 'job-1',
          pendingUnknownCount: 0,
          rearmed: false,
          completed: false,
          retiredClosedCount: 2,
        });

        for (const row of retrying) {
          expect(txMock.notificationLog.updateMany).toHaveBeenCalledWith({
            where: {
              id: row.id,
              deliveryKey: retiredLog.deliveryKey,
              status: 'RETRYING',
              deliveryStateVersion: row.deliveryStateVersion,
            },
            data: expect.objectContaining({
              status: 'FAILED',
              errorMessage: siblingMessage,
              sentAt: null,
              deliveryAttemptId: null,
              deliveryJobAttempt: null,
              deliveryStateVersion: { increment: 1 },
            }),
          });
        }
        // The job stays DEAD but no longer asks for owner resolution.
        expect(txMock.backgroundJob.updateMany).toHaveBeenCalledTimes(1);
        const jobUpdate = txMock.backgroundJob.updateMany.mock.calls[0]![0];
        expect(jobUpdate.where).toMatchObject({
          id: 'job-1',
          status: BackgroundJobStatus.DEAD,
          lastErrorCode: 'NotificationDeliveryUnknownError',
        });
        expect(jobUpdate.data).not.toHaveProperty('status');
        expect(jobUpdate.data).not.toHaveProperty('payload');
        expect(jobUpdate.data).toMatchObject({
          lastErrorCode: 'NotificationReplayTerminalError',
          result: expect.objectContaining({ unknown: 0, manuallyResolved: true }),
        });
        expect(txMock.businessAuditLog.create).toHaveBeenCalledTimes(1);
        expect(txMock.businessAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
            entityId: 'log-1',
            after: expect.objectContaining({
              backgroundJob: expect.objectContaining({ status: BackgroundJobStatus.DEAD }),
              retiredEventClosedLogs: [
                { id: 'log-r1', stateVersionBefore: 3, status: 'FAILED', errorMessage: siblingMessage },
                { id: 'log-r2', stateVersionBefore: 9, status: 'FAILED', errorMessage: siblingMessage },
              ],
            }),
          }),
        }));
      });

      it('rolls back as a conflict when a sibling moved concurrently', async () => {
        txMock.notificationLog.updateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 });
        await expect(
          resolveUnknownNotification('log-1', resolution, actor, 7, reason),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(txMock.backgroundJob.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  it('waits for every channel decision, then re-arms once with only original ledger targets', async () => {
    const secondLog = {
      ...log,
      id: 'log-2',
      channelId: 'channel-2',
      deliveryStateVersion: 11,
    };
    txMock.notificationLog.findUnique
      .mockResolvedValueOnce(log)
      .mockResolvedValueOnce(secondLog);
    txMock.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: job.id }])
      .mockResolvedValueOnce([{ now: new Date('2026-08-22T08:00:00Z') }])
      .mockResolvedValueOnce([{ id: job.id }])
      .mockResolvedValue([{ now: new Date('2026-08-22T08:00:00Z') }]);
    txMock.backgroundJob.findUnique.mockResolvedValue(job);
    txMock.notificationLog.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    txMock.notificationLog.findMany.mockResolvedValue([
      { id: 'log-1', deliveryStateVersion: 8 },
    ]);

    await expect(
      resolveUnknownNotification(
        'log-1',
        'NOT_DELIVERED_RETRY',
        actor,
        7,
      ),
    ).resolves.toEqual({
      backgroundJobId: 'job-1',
      pendingUnknownCount: 1,
      rearmed: false,
      completed: false,
      retiredClosedCount: 0,
    });
    expect(txMock.notificationLog.updateMany.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RETRYING',
          deliveryJobAttempt: 5,
          deliveryStateVersion: { increment: 1 },
        }),
      }),
    );
    expect(txMock.backgroundJob.updateMany).not.toHaveBeenCalled();

    await expect(
      resolveUnknownNotification('log-2', 'DELIVERED', actor, 11),
    ).resolves.toEqual({
      backgroundJobId: 'job-1',
      pendingUnknownCount: 0,
      rearmed: true,
      completed: false,
      retiredClosedCount: 0,
    });

    expect(txMock.backgroundJob.updateMany).toHaveBeenCalledTimes(1);
    const rearm = txMock.backgroundJob.updateMany.mock.calls[0]![0];
    expect(rearm.where).toEqual({
      id: 'job-1',
      type: 'NOTIFICATION',
      status: BackgroundJobStatus.DEAD,
      attempts: 5,
      maxAttempts: 5,
      lastErrorCode: 'NotificationDeliveryUnknownError',
    });
    expect(rearm.data).toMatchObject({
      status: BackgroundJobStatus.PENDING,
      maxAttempts: 8,
      availableAt: new Date('2026-08-22T08:00:00Z'),
      payload: {
        event: 'ORDER_SUBMITTED',
        payload: { orderId: 'order-1', orderNo: 'GD-1' },
        manualReplay: {
          targets: [{ logId: 'log-1', stateVersion: 8 }],
        },
      },
      lastErrorCode: null,
    });
    expect(rearm.data).not.toHaveProperty('dedupeKey');
    expect(txMock.businessAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CONFIRM_NOTIFICATION_DELIVERED',
        entityId: 'log-2',
      }),
      select: expect.any(Object),
    });
  });

  it('rejects a stale form version before acquiring the job or writing an audit row', async () => {
    txMock.notificationLog.findUnique.mockResolvedValue(log);

    await expect(
      resolveUnknownNotification('log-1', 'DELIVERED', actor, 6),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(txMock.backgroundJob.findUnique).not.toHaveBeenCalled();
    expect(txMock.notificationLog.updateMany).not.toHaveBeenCalled();
    expect(txMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects when the version-CAS loses after the job lock', async () => {
    txMock.notificationLog.findUnique.mockResolvedValue(log);
    txMock.notificationLog.updateMany.mockResolvedValue({ count: 0 });
    lockDurableJob();

    await expect(
      resolveUnknownNotification('log-1', 'DELIVERED', actor, 7),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(txMock.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(txMock.businessAuditLog.create).not.toHaveBeenCalled();
  });

  it('fails closed when the original job payload event does not match the ledger', async () => {
    txMock.notificationLog.findUnique.mockResolvedValue(log);
    lockDurableJob({
      ...job,
      payload: { event: 'URGENT_ORDER', payload: { orderId: 'order-1' } },
    });

    await expect(
      resolveUnknownNotification(
        'log-1',
        'NOT_DELIVERED_RETRY',
        actor,
        7,
      ),
    ).rejects.toMatchObject({
      code: 'PAYLOAD_MISMATCH',
    });
    expect(txMock.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(txMock.notificationLog.updateMany).not.toHaveBeenCalled();
  });

  it('does not open RETRYING unless the original UNKNOWN job is safely DEAD', async () => {
    txMock.notificationLog.findUnique.mockResolvedValue(log);
    lockDurableJob({
      ...job,
      status: BackgroundJobStatus.RUNNING,
    });

    await expect(
      resolveUnknownNotification(
        'log-1',
        'NOT_DELIVERED_RETRY',
        actor,
        7,
      ),
    ).rejects.toMatchObject({
      code: 'JOB_NOT_READY',
    });
    expect(txMock.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(txMock.notificationLog.updateMany).not.toHaveBeenCalled();
  });

  it('propagates an audit failure so the enclosing state transition rolls back', async () => {
    txMock.notificationLog.findUnique.mockResolvedValue({
      ...log,
      deliveryKey: null,
    });
    txMock.businessAuditLog.create.mockRejectedValue(
      new Error('audit unavailable'),
    );

    await expect(
      resolveUnknownNotification('log-1', 'DELIVERED', actor, 7),
    ).rejects.toThrow('audit unavailable');
  });
});
