import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { BackgroundJobQueue, Prisma } from '../../../generated/prisma/client';
import { reconcileExpiredBackgroundJobLeases } from '../lease-reaper';

type Sql = {
  strings: readonly string[];
  values: readonly unknown[];
};

const terminalJobs = [
  {
    id: 'job-notification',
    type: 'NOTIFICATION',
    dedupeKey: 'notification:ORDER_SUBMITTED:order-1',
    attempts: 5,
    lastErrorCode: 'WorkerLeaseExpired',
  },
  {
    id: 'job-cdr',
    type: 'CDR_BUNDLE',
    dedupeKey: 'cdr-bundle:bundle-1',
    attempts: 3,
    lastErrorCode: 'WorkerLeaseExpired',
  },
  {
    id: 'job-export',
    type: 'ORDER_EXPORT',
    dedupeKey: 'order-export:export-1',
    attempts: 3,
    lastErrorCode: 'WorkerLeaseExpired',
  },
  {
    id: 'job-agent-bill-export',
    type: 'AGENT_MONTHLY_BILL_EXPORT',
    dedupeKey: 'agent-monthly-bill-export:export-1',
    attempts: 3,
    lastErrorCode: 'WorkerLeaseExpired',
  },
];

beforeEach(() => {
  dbMock.$queryRaw.mockReset().mockResolvedValue([]);
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.$transaction.mockReset().mockImplementation(async (callback) =>
    callback(dbMock),
  );
});

describe('reconcileExpiredBackgroundJobLeases', () => {
  it('does only the queue-local terminal query when there is nothing to reap', async () => {
    await expect(
      reconcileExpiredBackgroundJobLeases({
        queue: BackgroundJobQueue.LIGHT,
        leaseMs: 300_000,
      }),
    ).resolves.toBe(0);

    expect(dbMock.$queryRaw).toHaveBeenCalledOnce();
    expect(dbMock.$executeRaw).not.toHaveBeenCalled();
    const statement = dbMock.$queryRaw.mock.calls[0]![0] as Sql;
    const sql = statement.strings.join('?');
    expect(sql).toContain('job."queue" = ?::"BackgroundJobQueue"');
    expect(sql).toContain('job."attempts" >= job."maxAttempts"');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('UPDATE "BackgroundJob" AS job');
    expect(statement.values).toContain(BackgroundJobQueue.LIGHT);
    expect(statement.values).toContain(300_000);
    expect(statement.values.some((value) => value instanceof Date)).toBe(false);
  });

  it('drives every dependent ledger from the exact returned terminal jobs', async () => {
    dbMock.$queryRaw
      .mockResolvedValueOnce(terminalJobs)
      .mockResolvedValueOnce([
        { dedupeKey: 'notification:ORDER_SUBMITTED:order-1' },
      ]);

    await expect(
      reconcileExpiredBackgroundJobLeases({
        queue: BackgroundJobQueue.LIGHT,
        leaseMs: 300_000,
      }),
    ).resolves.toBe(4);

    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(5);

    const notificationFence = dbMock.$queryRaw.mock.calls[1]![0] as Sql;
    const notificationSql = notificationFence.strings.join('?');
    expect(notificationSql).toContain('WITH');
    expect(notificationSql).toContain('"terminal_jobs"');
    expect(notificationSql).toContain('UPDATE "NotificationLog" AS log');
    expect(notificationSql).toContain(
      'log."deliveryJobAttempt" <= job."attempts"',
    );
    expect(notificationSql).toContain(
      'RETURNING log."deliveryKey" AS "dedupeKey"',
    );

    const [diagnosis, attempts, cdr, orderExport, agentBillExport] =
      dbMock.$executeRaw.mock.calls.map((call) => call[0] as Sql);
    const diagnosisSql = diagnosis!.strings.join('?');
    expect(diagnosisSql).toContain('UPDATE "BackgroundJob" AS job');
    expect(diagnosisSql).toContain(
      'WorkerLeaseExpiredAfterNotificationSend',
    );
    expect(diagnosisSql).not.toContain('errorMessage');
    expect(diagnosis!.values).toContain('NotificationDeliveryUnknownError');

    expect(attempts!.strings.join('?')).toContain(
      'UPDATE "BackgroundJobAttempt" AS attempt',
    );
    expect(cdr!.strings.join('?')).toContain('UPDATE "DesignBundle" AS bundle');
    const exportSql = orderExport!.strings.join('?');
    expect(exportSql).toContain('UPDATE "OrderExport" AS order_export');
    expect(exportSql).toContain('"filters" = jsonb_build_object(');
    const agentBillExportSql = agentBillExport!.strings.join('?');
    expect(agentBillExportSql).toContain(
      'UPDATE "AgentMonthlyBillExport" AS bill_export',
    );
    expect(agentBillExportSql).toContain('"filters" = \'{}\'::jsonb');

    for (const statement of [
      notificationFence,
      diagnosis!,
      attempts!,
      cdr!,
      orderExport!,
      agentBillExport!,
    ]) {
      expect(statement.strings.join('?')).toContain('"terminal_jobs"');
      expect(statement.values).toContain('job-notification');
      expect(statement.strings.join('?')).not.toContain('RETRYING');
    }
    expect(cdr!.values).toContain('job-cdr');
    expect(orderExport!.values).toContain('job-export');
    expect(agentBillExport!.values).toContain('job-agent-bill-export');
  });

  it('does not diagnose UNKNOWN unless the log update returned a fenced row', async () => {
    dbMock.$queryRaw
      .mockResolvedValueOnce([terminalJobs[0]])
      .mockResolvedValueOnce([]);

    await expect(
      reconcileExpiredBackgroundJobLeases({
        queue: BackgroundJobQueue.LIGHT,
        leaseMs: 300_000,
      }),
    ).resolves.toBe(1);

    // attempt/CDR/export reconciliations still run, but the job-facing UNKNOWN
    // diagnosis is absent because a concurrent finalizer won the ledger row.
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(4);
    for (const [statement] of dbMock.$executeRaw.mock.calls) {
      expect((statement as Prisma.Sql).strings.join('?')).not.toContain(
        'NotificationDeliveryUnknownError',
      );
    }
  });
});
