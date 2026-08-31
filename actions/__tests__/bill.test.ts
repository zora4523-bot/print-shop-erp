import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillStatus, Role } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  billMock,
  revalidatePathMock,
  redirectMock,
  MockBillError,
  MockInvalidBillTransitionError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  billMock: {
    generateBillsForPeriod: vi.fn(),
    issueBill: vi.fn(),
    recordPayment: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockBillError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'BillError';
    }
  },
  MockInvalidBillTransitionError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'InvalidBillTransitionError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/bill', () => ({
  generateBillsForPeriod: billMock.generateBillsForPeriod,
  issueBill: billMock.issueBill,
  recordPayment: billMock.recordPayment,
  BillError: MockBillError,
  InvalidBillTransitionError: MockInvalidBillTransitionError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  generateBillsAction,
  issueBillAction,
  recordBillPaymentAction,
} from '../bill';

const ownerActor = {
  id: 'owner-1',
  username: 'o',
  displayName: '管理员',
  role: Role.ADMIN,
  workerType: null,
  machineType: null,
};

const fd = (data: Record<string, string>): FormData => {
  const f = new FormData();
  f.set('idempotencyKey', '00000000-0000-4000-8000-000000000001');
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  billMock.generateBillsForPeriod.mockReset();
  billMock.issueBill.mockReset();
  billMock.recordPayment.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockClear();
});

describe('generateBillsAction', () => {
  it("first-line requirePermission('bill:view:all')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      generateBillsAction(null, { period: '2026-05' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'bill:view:all',
    );
  });

  it('rejects bad period format', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await generateBillsAction(null, { period: '2026/05' });
    expect(r.status).toBe('invalid');
  });

  it('rejects month 13', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await generateBillsAction(null, { period: '2026-13' });
    expect(r.status).toBe('invalid');
  });

  it('forwards to lib and surfaces counts + errors', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    billMock.generateBillsForPeriod.mockResolvedValue({
      period: '2026-05',
      generated: [{ billId: 'b1' }, { billId: 'b2' }],
      errors: [{ salesUserId: 'sales-3', message: '2026-05 账单已 ISSUED' }],
    });
    const r = await generateBillsAction(null, { period: '2026-05' });
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.generatedCount).toBe(2);
      expect(r.errorCount).toBe(1);
      expect(r.errors[0].salesUserId).toBe('sales-3');
    }
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/bills');
  });

  it('maps BillError to error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    billMock.generateBillsForPeriod.mockRejectedValueOnce(
      new MockBillError('月份格式非法'),
    );
    const r = await generateBillsAction(null, { period: '2026-05' });
    expect(r.status).toBe('error');
  });
});

describe('issueBillAction', () => {
  it("requirePermission('bill:view:all')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(issueBillAction('b1')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps InvalidBillTransitionError to error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    billMock.issueBill.mockRejectedValueOnce(
      new MockInvalidBillTransitionError('ISSUED → ISSUED'),
    );
    const r = await issueBillAction('b1');
    expect(r.status).toBe('error');
  });

  it('revalidates both paths and redirects to a page-level receipt on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    billMock.issueBill.mockResolvedValue({ id: 'b1', status: BillStatus.ISSUED });
    await expect(issueBillAction('b1')).rejects.toThrow(
      'NEXT_REDIRECT:/owner/bills/b1?issued=1',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/bills');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/bills/b1');
  });
});

describe('recordBillPaymentAction', () => {
  it("requirePermission('bill:mark-paid') [ADMIN-only]", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      recordBillPaymentAction('b1', null, fd({ amount: '100' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith(
      'bill:mark-paid',
    );
  });

  it('rejects 0 / negative amount at the schema boundary', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r1 = await recordBillPaymentAction(
      'b1',
      null,
      fd({ amount: '0' }),
    );
    expect(r1.status).toBe('invalid');
    const r2 = await recordBillPaymentAction(
      'b1',
      null,
      fd({ amount: '-100' }),
    );
    expect(r2.status).toBe('invalid');
  });

  it('rejects non-numeric amount', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recordBillPaymentAction(
      'b1',
      null,
      fd({ amount: 'abc' }),
    );
    expect(r.status).toBe('invalid');
  });

  it('rejects decimal with >2 places', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const r = await recordBillPaymentAction(
      'b1',
      null,
      fd({ amount: '100.123' }),
    );
    expect(r.status).toBe('invalid');
  });

  it('success: returns bill status + cs accumulation flag', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    billMock.recordPayment.mockResolvedValue({
      billId: 'b1',
      previousPaidAmount: '0.00',
      newPaidAmount: '1000.00',
      totalAmount: '1000.00',
      status: BillStatus.FULLY_PAID,
      csAccumulated: true,
    });
    const r = await recordBillPaymentAction(
      'b1',
      null,
      fd({ amount: '1000' }),
    );
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.newPaidAmount).toBe('1000.00');
      expect(r.billStatus).toBe(BillStatus.FULLY_PAID);
      expect(r.csAccumulated).toBe(true);
    }
    expect(billMock.recordPayment).toHaveBeenCalledWith(
      'b1',
      '1000',
      expect.objectContaining({ id: 'owner-1', role: Role.ADMIN }),
      expect.any(Date),
      expect.objectContaining({
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
      }),
    );
  });

  it('maps BillError → error (overpayment)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    billMock.recordPayment.mockRejectedValueOnce(
      new MockBillError('付款金额超出未结清余额'),
    );
    const r = await recordBillPaymentAction(
      'b1',
      null,
      fd({ amount: '5000' }),
    );
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/超出/);
  });
});
