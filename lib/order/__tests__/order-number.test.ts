import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextOrderNumber, type OrderSeqTxClient } from '../order-number';

function makeTx(existingOrderNos: string[] = []) {
  const sorted = [...existingOrderNos].sort().reverse();
  const queryRaw = vi.fn().mockResolvedValue(undefined);
  const findFirst = vi.fn(async (args: { where: { orderNo: { startsWith: string } } }) => {
    const prefix = args.where.orderNo.startsWith;
    const match = sorted.find((n) => n.startsWith(prefix));
    return match ? { orderNo: match } : null;
  });
  const tx: OrderSeqTxClient & {
    _queryRaw: typeof queryRaw;
    _findFirst: typeof findFirst;
  } = {
    $queryRaw: queryRaw as unknown as OrderSeqTxClient['$queryRaw'],
    order: { findFirst: findFirst as unknown as OrderSeqTxClient['order']['findFirst'] },
    _queryRaw: queryRaw,
    _findFirst: findFirst,
  };
  return tx;
}

// Anchored in the business timezone (+08:00) so calendar-day math is
// unambiguous across test envs.
const date = new Date('2026-04-23T09:00:00+08:00');

describe('nextOrderNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts at 0001 on a brand-new day', async () => {
    const tx = makeTx([]);
    expect(await nextOrderNumber(tx, date)).toBe('20260423-0001');
  });

  it('increments from the highest existing serial (not count)', async () => {
    // Hole in the middle — 0003 was cancelled but still has the orderNo.
    // Count would be 4 → 0005 collision; max → 0006 (safe).
    const tx = makeTx([
      '20260423-0001',
      '20260423-0002',
      '20260423-0004',
      '20260423-0005',
    ]);
    expect(await nextOrderNumber(tx, date)).toBe('20260423-0006');
  });

  it('zero-pads the serial to 4 digits', async () => {
    const tx = makeTx(['20260423-0099']);
    expect(await nextOrderNumber(tx, date)).toBe('20260423-0100');
  });

  it('acquires a per-day advisory lock before the lookup (concurrency guard)', async () => {
    const tx = makeTx([]);
    await nextOrderNumber(tx, date);

    expect(tx._queryRaw).toHaveBeenCalledOnce();
    const firstArg = tx._queryRaw.mock.calls[0][0] as TemplateStringsArray;
    expect(firstArg.join('?')).toMatch(/pg_advisory_xact_lock/);
    // The values baked into the tagged template should include the day
    // prefix so different days hash to different lock IDs.
    const values = tx._queryRaw.mock.calls[0].slice(1) as unknown[];
    expect(String(values[0])).toContain('20260423');
  });

  it('uses different lock keys on different days (no cross-day blocking)', async () => {
    const tx = makeTx([]);
    await nextOrderNumber(tx, new Date('2026-04-23T00:00:00'));
    await nextOrderNumber(tx, new Date('2026-04-24T00:00:00'));

    const key1 = (tx._queryRaw.mock.calls[0].slice(1) as unknown[])[0];
    const key2 = (tx._queryRaw.mock.calls[1].slice(1) as unknown[])[0];
    expect(String(key1)).toContain('20260423');
    expect(String(key2)).toContain('20260424');
    expect(key1).not.toBe(key2);
  });

  it('throws instead of producing a malformed 5-digit tail past 9999', async () => {
    const tx = makeTx(['20260423-9999']);
    await expect(nextOrderNumber(tx, date)).rejects.toThrow(/9999/);
  });

  it('throws on a malformed highest orderNo rather than colliding (Codex round 25 / P1)', async () => {
    // If the DB somehow holds '20260423-abc' as the highest row, falling
    // back to 0 would produce '0001' which already exists — a hard
    // unique-constraint collision. Fail loudly so ops can investigate.
    const tx = makeTx(['20260423-abc']);
    await expect(nextOrderNumber(tx, date)).rejects.toThrow(/无法解析工单号/);
  });

  it('distinguishes "5-digit tail" from the regular 9999 cap (Codex round 26 / P2)', async () => {
    // A 5-digit tail is data corruption (we pad to 4) — operators should
    // see the distinct "位数异常" message, not the soft "达到 9999" one.
    const tx = makeTx(['20260423-10000']);
    await expect(nextOrderNumber(tx, date)).rejects.toThrow(/位数异常/);
  });

  it('handles single-digit months/days with zero padding', async () => {
    const tx = makeTx([]);
    const jan5 = new Date('2026-01-05T10:00:00+08:00');
    expect(await nextOrderNumber(tx, jan5)).toBe('20260105-0001');
  });

  describe('business-timezone anchoring (Codex round 25 / P1)', () => {
    it('uses Asia/Shanghai calendar even when the Date points to a different UTC day', async () => {
      const tx = makeTx([]);
      // 2026-04-23 23:30 UTC = 2026-04-24 07:30 in Asia/Shanghai → day 24.
      const utcLateNight = new Date('2026-04-23T23:30:00Z');
      expect(await nextOrderNumber(tx, utcLateNight)).toBe('20260424-0001');
    });

    it('keeps same-business-day orders in the same prefix', async () => {
      const tx = makeTx([]);
      // 2026-04-23 00:30 CST (= 2026-04-22 16:30 UTC) → day 23.
      const earlyMorningCST = new Date('2026-04-22T16:30:00Z');
      // 2026-04-23 23:00 CST (= 2026-04-23 15:00 UTC) → day 23.
      const lateNightCST = new Date('2026-04-23T15:00:00Z');
      const first = await nextOrderNumber(tx, earlyMorningCST);
      const second = await nextOrderNumber(tx, lateNightCST);
      expect(first.startsWith('20260423-')).toBe(true);
      expect(second.startsWith('20260423-')).toBe(true);
    });
  });
});
