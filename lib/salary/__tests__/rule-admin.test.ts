import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, SalaryRuleType } from '../../../generated/prisma/enums';

const { dbMock, txMock, auditMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    salaryRule: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    businessAuditLog: { create: vi.fn() },
  };
  return {
    dbMock: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      salaryRule: { findMany: vi.fn() },
    },
    txMock: tx,
    auditMock: { writeAuditLogInTx: vi.fn() },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/audit-log', () => ({ writeAuditLogInTx: auditMock.writeAuditLogInTx }));

import {
  createSalaryRuleVersion,
  listSalaryRuleSettings,
  parseSalaryRuleVersionFormData,
  salaryRuleLockKey,
} from '../rule-admin';

const actor = { id: 'admin-1', role: Role.ADMIN, username: 'admin', displayName: '管理员' };

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

beforeEach(() => {
  dbMock.$transaction.mockClear();
  dbMock.salaryRule.findMany.mockReset();
  for (const method of Object.values(txMock.salaryRule)) method.mockReset();
  txMock.$executeRaw.mockReset();
  auditMock.writeAuditLogInTx.mockReset();
});

describe('salary rule editor validation', () => {
  it('normalizes a well-formed CS FLAT tier schedule without using floats', () => {
    const result = parseSalaryRuleVersionFormData(form({
      ruleKey: 'CS_TIERS', effectiveFrom: '2026-08-07T09:30', remark: '新周期',
      tierMinSales: ['100000', '200000'], tierRate: ['0.01', '0.025'],
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ruleValue).toEqual({
        mode: 'FLAT', tiers: [{ minSales: 100000, rate: 0.01 }, { minSales: 200000, rate: 0.025 }],
      });
      expect(result.data.effectiveFrom.toISOString()).toBe('2026-08-07T01:30:00.000Z');
    }
  });

  it('rejects descending or duplicate tier thresholds', () => {
    const result = parseSalaryRuleVersionFormData(form({
      ruleKey: 'CS_TIERS', effectiveFrom: '2026-08-07T09:30',
      tierMinSales: ['200000', '200000'], tierRate: ['0.01', '0.02'],
    }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('从低到高'))).toBe(true);
  });

  it('rejects invalid Shanghai calendar dates and negative money', () => {
    const result = parseSalaryRuleVersionFormData(form({
      ruleKey: 'CLEANER_HOURLY', effectiveFrom: '2026-02-31T09:30', hourlyRate: '-1',
    }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a work schedule whose OT begins before the afternoon shift ends', () => {
    const result = parseSalaryRuleVersionFormData(form({
      ruleKey: 'WORK_HOURS', effectiveFrom: '2026-08-07T09:30',
      morningStart: '08:00', morningEnd: '12:00', afternoonStart: '13:30', afternoonEnd: '17:30', otStart: '17:00',
    }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.join('.') === 'otStart')).toBe(true);
  });

  it('accepts a 1.5 overtime multiplier and rejects zero or database overflow', () => {
    const accepted = parseSalaryRuleVersionFormData(form({
      ruleKey: 'OT_MULTIPLIER',
      effectiveFrom: '2026-08-07T09:30',
      multiplier: '1.5',
    }));
    expect(accepted.success).toBe(true);
    if (accepted.success) {
      expect(accepted.data.ruleValue).toEqual({ multiplier: 1.5 });
    }

    for (const multiplier of ['0', '100']) {
      expect(
        parseSalaryRuleVersionFormData(form({
          ruleKey: 'OT_MULTIPLIER',
          effectiveFrom: '2026-08-07T09:30',
          multiplier,
        })).success,
        multiplier,
      ).toBe(false);
    }
  });

  it('closes hourly rule input to HourlyWorkerPayroll Decimal(6,2)', () => {
    for (const [hourlyRate, accepted] of [
      ['9999.99', true],
      ['10000', false],
      ['99999999.99', false],
    ] as const) {
      const result = parseSalaryRuleVersionFormData(
        form({
          ruleKey: 'CLEANER_HOURLY',
          effectiveFrom: '2026-08-07T09:30',
          hourlyRate,
        }),
      );
      expect(result.success, hourlyRate).toBe(accepted);
    }
  });
});

describe('createSalaryRuleVersion', () => {
  it('serializes writers, closes an overlapping prior version, writes the next boundary and audit record', async () => {
    txMock.salaryRule.findUnique.mockResolvedValue(null);
    txMock.salaryRule.findFirst.mockResolvedValue({ effectiveFrom: new Date('2026-10-01T00:00:00.000Z') });
    txMock.salaryRule.findMany.mockResolvedValue([{ id: 'old', ruleValue: { hourlyRate: 11 }, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null, remark: null }]);
    txMock.salaryRule.create.mockResolvedValue({
      id: 'new', ruleType: SalaryRuleType.WORKER_HOURLY, ruleKey: 'CLEANER_HOURLY', ruleValue: { hourlyRate: 12 },
      effectiveFrom: new Date('2026-08-07T01:30:00.000Z'), effectiveTo: new Date('2026-10-01T00:00:00.000Z'), remark: '调薪',
    });
    const parsed = parseSalaryRuleVersionFormData(form({ ruleKey: 'CLEANER_HOURLY', effectiveFrom: '2026-08-07T09:30', hourlyRate: '12', remark: '调薪' }));
    if (!parsed.success) throw parsed.error;

    await createSalaryRuleVersion(parsed.data, actor);

    expect(txMock.$executeRaw).toHaveBeenCalledTimes(2);
    const snapshotSql = (
      txMock.$executeRaw.mock.calls[0]![0] as TemplateStringsArray
    ).join('?');
    expect(snapshotSql).toContain('pg_advisory_xact_lock');
    expect(txMock.$executeRaw.mock.calls[0]![1]).toBe(
      'print-shop-erp:salary-rules:snapshot',
    );
    expect(txMock.salaryRule.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['old'] } }, data: { effectiveTo: parsed.data.effectiveFrom },
    });
    expect(txMock.salaryRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ effectiveTo: new Date('2026-10-01T00:00:00.000Z') }),
    }));
    expect(auditMock.writeAuditLogInTx).toHaveBeenCalledWith(txMock, expect.objectContaining({
      actor, entityType: 'SalaryRule', entityId: 'new', action: 'CREATE_VERSION',
    }));
  });

  it('rejects duplicate version timestamps before changing an old row', async () => {
    txMock.salaryRule.findUnique.mockResolvedValue({ id: 'existing' });
    const parsed = parseSalaryRuleVersionFormData(form({ ruleKey: 'CLEANER_HOURLY', effectiveFrom: '2026-08-07T09:30', hourlyRate: '12' }));
    if (!parsed.success) throw parsed.error;
    await expect(createSalaryRuleVersion(parsed.data, actor)).rejects.toThrow('同一生效时间');
    expect(txMock.salaryRule.updateMany).not.toHaveBeenCalled();
  });

  it('uses a stable per-rule lock key so unrelated salary rules do not share a lock', () => {
    expect(salaryRuleLockKey(SalaryRuleType.WORKER_HOURLY, 'CLEANER_HOURLY')).not.toBe(
      salaryRuleLockKey(SalaryRuleType.WORKER_HOURLY, 'COOK_SPARE_HOURLY'),
    );
  });
});

describe('listSalaryRuleSettings', () => {
  it('selects only the newest currently-effective version for each known key', async () => {
    const now = new Date('2026-08-07T00:00:00.000Z');
    dbMock.salaryRule.findMany.mockResolvedValue([
      { id: 'new', ruleType: SalaryRuleType.WORKER_HOURLY, ruleKey: 'CLEANER_HOURLY', ruleValue: { hourlyRate: 12 }, effectiveFrom: now, effectiveTo: null, remark: 'new' },
      { id: 'old', ruleType: SalaryRuleType.WORKER_HOURLY, ruleKey: 'CLEANER_HOURLY', ruleValue: { hourlyRate: 11 }, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null, remark: 'old' },
    ]);
    const settings = await listSalaryRuleSettings(now);
    expect(settings.CLEANER_HOURLY?.id).toBe('new');
    expect(settings.COOK_MONTHLY).toBeNull();
    expect(dbMock.salaryRule.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { effectiveFrom: 'desc' } }));
  });
});
