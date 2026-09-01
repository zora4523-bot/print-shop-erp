import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';

const {
  requirePermissionMock,
  createCreditMock,
  markPaidMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  createCreditMock: vi.fn(),
  markPaidMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/agent-monthly-billing/commands', () => ({
  confirmAgentMonthlyBill: vi.fn(),
  createAgentMonthlyBillCredit: createCreditMock,
  markAgentMonthlyBillPaid: markPaidMock,
}));
vi.mock('@/lib/agent-monthly-billing/generation', () => ({
  generateAgentMonthlyBillsForPeriod: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  createAgentMonthlyBillCreditAction,
  markAgentMonthlyBillPaidAction,
} from '../agent-monthly-bill';

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
  markPaidMock.mockResolvedValue({
    billId: 'bill-1',
    status: 'PAID',
    amount: '88.00',
    receivedAt: new Date('2026-06-01T00:00:00.000Z'),
  });
  createCreditMock.mockResolvedValue({
    creditId: 'credit-1',
    requestedAmount: '-10.00',
    allocatedBillIds: [],
  });
});

describe('agent monthly bill actions', () => {
  it('rejects any client-supplied payment amount', async () => {
    const form = new FormData();
    form.set('idempotencyKey', 'receipt-1');
    form.set('amount', '0.01');

    await expect(
      markAgentMonthlyBillPaidAction('bill-1', null, form),
    ).resolves.toMatchObject({ status: 'invalid' });
    expect(requirePermissionMock).toHaveBeenCalledWith('bill:mark-paid');
    expect(markPaidMock).not.toHaveBeenCalled();
  });

  it('refreshes only v2 owner routes after a successful receipt', async () => {
    const form = new FormData();
    form.set('idempotencyKey', 'receipt-1');

    await expect(
      markAgentMonthlyBillPaidAction('bill-1', null, form),
    ).resolves.toMatchObject({ status: 'success', billStatus: 'PAID' });
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/agent-bills');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/agent-bills/bill-1',
    );
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/owner/bills');
  });

  it('binds a credit source to the bill selected by the route', async () => {
    const form = new FormData();
    form.set('idempotencyKey', 'credit-1');
    form.set('sourceItemId', 'item-1');
    form.set('amount', '10.00');
    form.set('reason', '质量调整');

    await expect(
      createAgentMonthlyBillCreditAction('bound-bill', null, form),
    ).resolves.toMatchObject({ status: 'success' });
    expect(createCreditMock).toHaveBeenCalledWith(
      {
        expectedBillId: 'bound-bill',
        idempotencyKey: 'credit-1',
        sourceItemId: 'item-1',
        amount: '10.00',
        reason: '质量调整',
      },
      { id: 'admin-1', role: Role.ADMIN },
    );
  });
});
