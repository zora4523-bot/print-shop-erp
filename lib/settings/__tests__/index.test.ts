import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, txMock, auditMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    setting: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  };
  return {
    txMock: tx,
    dbMock: { $transaction: vi.fn() },
    auditMock: { writeAuditLogInTx: vi.fn() },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/audit-log', () => ({
  writeAuditLogInTx: auditMock.writeAuditLogInTx,
}));

import { updateSettings } from '../index';
import { WORKER_SELF_CLAIM_SETTING_LOCK_KEY } from '../locks';

beforeEach(() => {
  txMock.$executeRaw.mockReset().mockResolvedValue(0);
  txMock.setting.findMany.mockReset().mockResolvedValue([
    {
      key: 'worker_self_claim_enabled',
      value: { enabled: false },
    },
  ]);
  txMock.setting.upsert.mockReset().mockResolvedValue({});
  auditMock.writeAuditLogInTx.mockReset().mockResolvedValue(undefined);
  dbMock.$transaction.mockReset().mockImplementation(async (fn) => fn(txMock));
});

describe('updateSettings worker self-claim lock', () => {
  it('修改抢单开关时在读写 Setting 前先取同 key 排他锁', async () => {
    await updateSettings({ worker_self_claim_enabled: { enabled: true } });

    const sqlCall = txMock.$executeRaw.mock.calls[0];
    expect((sqlCall[0] as TemplateStringsArray).join('?')).toContain(
      'pg_advisory_xact_lock(hashtext',
    );
    expect(sqlCall).toContain(WORKER_SELF_CLAIM_SETTING_LOCK_KEY);
    expect(txMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.setting.findMany.mock.invocationCallOrder[0],
    );
    expect(txMock.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'worker_self_claim_enabled' },
        update: expect.objectContaining({ value: { enabled: true } }),
      }),
    );
  });
});
