import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    notificationLog: { findUnique: vi.fn() },
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  claimDurableDelivery,
  finalizeDurableDelivery,
  markDurableDeliveryUnknown,
  NotificationDeliveryClaimConflictError,
  NotificationDeliveryLedgerError,
} from '../delivery-ledger';

const claimInput = {
  deliveryKey: 'notification:ORDER_COMPLETED:order-1',
  jobAttempt: 2,
  eventType: 'ORDER_COMPLETED',
  channelId: 'channel-1',
  messageContent: '工单已完成',
  relatedOrderId: 'order-1',
};

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.notificationLog.findUnique.mockReset();
});

describe('claimDurableDelivery', () => {
  it('returns a fencing token only when the atomic reservation returned a row', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ id: 'log-1' }]);
    const claim = await claimDurableDelivery(claimInput);
    expect(claim).toMatchObject({ claimed: true });
    if (claim.claimed) expect(claim.attemptId).toMatch(/^[0-9a-f-]{36}$/);

    const sql = dbMock.$queryRaw.mock.calls[0]![0] as {
      strings: readonly string[];
    };
    const text = sql.strings.join('?');
    expect(text).toContain('ON CONFLICT ("deliveryKey", "channelId")');
    expect(text).toContain('"NotificationLog"."status" = \'RETRYING\'');
    expect(text).toContain("'SENDING'::\"NotificationStatus\"");
    expect(text).toContain('"deliveryJobAttempt"');
    expect(text).toContain(
      '"NotificationLog"."deliveryJobAttempt" <',
    );
    const fenceSql = dbMock.$executeRaw.mock.calls[0]![0] as {
      strings: readonly string[];
    };
    const fenceText = fenceSql.strings.join('?');
    expect(fenceText).toContain('"deliveryJobAttempt" <');
    expect(fenceText).not.toContain('IS DISTINCT FROM');
  });

  it('turns a prior job generation SENDING reservation into observable UNKNOWN before claiming', async () => {
    dbMock.$executeRaw.mockResolvedValueOnce(1);
    dbMock.$queryRaw.mockResolvedValue([]);
    dbMock.notificationLog.findUnique.mockResolvedValue({
      status: 'UNKNOWN',
      errorMessage: 'worker lease ended before delivery was finalized',
    });

    await expect(claimDurableDelivery(claimInput)).resolves.toEqual({
      claimed: false,
      status: 'UNKNOWN',
      errorMessage: 'worker lease ended before delivery was finalized',
    });
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('treats an existing SUCCESS as terminal and never grants a sender token', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    dbMock.notificationLog.findUnique.mockResolvedValue({
      status: 'SUCCESS',
      errorMessage: null,
    });
    await expect(claimDurableDelivery(claimInput)).resolves.toEqual({
      claimed: false,
      status: 'SUCCESS',
      errorMessage: null,
    });
  });

  it('fails loudly if the conflict row disappears instead of allowing HTTP', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    dbMock.notificationLog.findUnique.mockResolvedValue(null);
    await expect(claimDurableDelivery(claimInput)).rejects.toBeInstanceOf(
      NotificationDeliveryLedgerError,
    );
  });

  it('bounds the RETRYING contention loop and fails instead of recursing forever', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    dbMock.notificationLog.findUnique.mockResolvedValue({
      status: 'RETRYING',
      errorMessage: 'http 503',
    });

    await expect(claimDurableDelivery(claimInput)).rejects.toThrow(
      'delivery reservation remained contended',
    );
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('uses the shared upsert with a locked row guard and strict manual state version', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ id: 'log-1' }]);

    await expect(
      claimDurableDelivery({ ...claimInput, expectedStateVersion: 8 }),
    ).resolves.toMatchObject({ claimed: true });

    const sql = dbMock.$queryRaw.mock.calls[0]![0] as {
      strings: readonly string[];
    };
    const text = sql.strings.join('?');
    expect(text).toContain('WITH "manual_claim_guard" AS MATERIALIZED');
    expect(text).toContain('FOR UPDATE');
    expect(text).toContain('INSERT INTO "NotificationLog"');
    expect(text).toContain('ON CONFLICT ("deliveryKey", "channelId")');
    expect(text).toContain(
      '"NotificationLog"."deliveryStateVersion" = ?',
    );
    expect(text).toContain('"NotificationLog"."deliveryJobAttempt" <');
    expect(text).toContain('OR EXISTS (SELECT 1 FROM "manual_claim_guard")');
  });

  it('never inserts a missing manual replay row and reports a typed conflict', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    dbMock.notificationLog.findUnique.mockResolvedValue(null);

    await expect(
      claimDurableDelivery({ ...claimInput, expectedStateVersion: 8 }),
    ).rejects.toBeInstanceOf(NotificationDeliveryClaimConflictError);
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a paused old generation after UNKNOWN was manually reopened', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);
    dbMock.notificationLog.findUnique.mockResolvedValue({
      status: 'RETRYING',
      errorMessage: 'owner confirmed not delivered',
    });

    const claim = claimDurableDelivery({
      ...claimInput,
      jobAttempt: 5,
      expectedStateVersion: 8,
    });
    await expect(claim).rejects.toBeInstanceOf(
      NotificationDeliveryClaimConflictError,
    );
    await expect(claim).rejects.toThrow(
      'manual replay delivery state version or job generation changed',
    );
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('durable delivery finalization', () => {
  it('requires exactly one SENDING row owned by the fencing token', async () => {
    dbMock.$executeRaw.mockResolvedValue(1);
    await expect(
      finalizeDurableDelivery({
        deliveryKey: claimInput.deliveryKey,
        channelId: claimInput.channelId,
        attemptId: 'attempt-1',
        jobAttempt: claimInput.jobAttempt,
        status: 'SUCCESS',
        errorMessage: null,
        retryCount: 0,
        sent: true,
      }),
    ).resolves.toBeUndefined();
    const sql = dbMock.$executeRaw.mock.calls[0]![0] as {
      strings: readonly string[];
      values: readonly unknown[];
    };
    expect(sql.strings.join('?')).toContain(
      '"deliveryJobAttempt" = ?',
    );
    expect(sql.values).toContain(claimInput.jobAttempt);

    dbMock.$executeRaw.mockResolvedValue(0);
    await expect(
      finalizeDurableDelivery({
        deliveryKey: claimInput.deliveryKey,
        channelId: claimInput.channelId,
        attemptId: 'stale-attempt',
        jobAttempt: claimInput.jobAttempt,
        status: 'FAILED',
        errorMessage: 'stale',
        retryCount: 0,
        sent: false,
      }),
    ).rejects.toBeInstanceOf(NotificationDeliveryLedgerError);
  });

  it('can turn an owned SENDING reservation into an explicit UNKNOWN marker', async () => {
    dbMock.$executeRaw.mockResolvedValue(1);
    await expect(
      markDurableDeliveryUnknown({
        deliveryKey: claimInput.deliveryKey,
        channelId: claimInput.channelId,
        attemptId: 'attempt-1',
        errorMessage: 'response lost',
      }),
    ).resolves.toBeUndefined();
    const sql = dbMock.$executeRaw.mock.calls[0]![0] as {
      strings: readonly string[];
    };
    expect(sql.strings.join('?')).toContain("'UNKNOWN'::\"NotificationStatus\"");
  });
});
