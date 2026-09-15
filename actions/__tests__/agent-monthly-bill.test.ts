import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';

const {
  requirePermissionMock,
  createCreditMock,
  confirmMock,
  generateMock,
  markPaidMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  createCreditMock: vi.fn(),
  confirmMock: vi.fn(),
  generateMock: vi.fn(),
  markPaidMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/agent-monthly-billing/commands', () => ({
  confirmAgentMonthlyBill: confirmMock,
  createAgentMonthlyBillCredit: createCreditMock,
  markAgentMonthlyBillPaid: markPaidMock,
}));
vi.mock('@/lib/agent-monthly-billing/generation', () => ({
  generateAgentMonthlyBillsForPeriod: generateMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  createAgentMonthlyBillCreditAction,
  confirmAgentMonthlyBillAction,
  generateAgentMonthlyBillsAction,
  markAgentMonthlyBillPaidAction,
} from '../agent-monthly-bill';

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({ id: 'admin-1', role: Role.ADMIN });
  confirmMock.mockResolvedValue({ status: 'CONFIRMED' });
  generateMock.mockResolvedValue({ period: '2026-08', generated: [{ id: 'bill-1' }] });
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
  const cases: Array<{
    name: string;
    submit: typeof generateAgentMonthlyBillsAction;
    values: Record<string, string>;
    command: typeof generateMock;
    permission: string;
  }> = [
    {
      name: 'generate',
      submit: generateAgentMonthlyBillsAction,
      values: { period: '2026-08' },
      command: generateMock,
      permission: 'bill:manage',
    },
    {
      name: 'confirm',
      submit: confirmAgentMonthlyBillAction.bind(null, 'bill-1'),
      values: { idempotencyKey: 'confirm-1' },
      command: confirmMock,
      permission: 'bill:manage',
    },
    {
      name: 'receive payment',
      submit: markAgentMonthlyBillPaidAction.bind(null, 'bill-1'),
      values: { idempotencyKey: 'receipt-1' },
      command: markPaidMock,
      permission: 'bill:mark-paid',
    },
    {
      name: 'record credit',
      submit: createAgentMonthlyBillCreditAction.bind(null, 'bill-1'),
      values: { idempotencyKey: 'credit-1', sourceItemId: 'item-1', amount: '10.00', reason: '质量调整' },
      command: createCreditMock,
      permission: 'bill:manage',
    },
  ];

  function form(values: Record<string, string>): FormData {
    const result = new FormData();
    for (const [key, value] of Object.entries(values)) result.set(key, value);
    result.set('$ACTION_REF_1', '');
    result.set('$ACTION_1:0', '{"id":"framework-reference","bound":"$@1"}');
    result.set('$ACTION_1:1', '[null]');
    result.set('$ACTION_KEY', 'framework-form-state-key');
    return result;
  }

  it.each(cases)('accepts React protocol fields when $name uses a strict business schema', async ({ submit, values, command, permission }) => {
    await expect(submit(null, form(values))).resolves.toMatchObject({ status: 'success' });
    expect(requirePermissionMock).toHaveBeenCalledWith(permission);
    expect(command).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(command.mock.calls)).not.toContain('$ACTION_');
  });

  it.each(cases)('rejects unknown business keys with Chinese feedback when attempting to $name', async ({ submit, values, command }) => {
    const input = form(values);
    input.set('unknownBusinessKey', 'untrusted');
    await expect(submit(null, input)).resolves.toEqual({
      status: 'invalid',
      fieldErrors: { _: ['提交内容包含页面不支持的字段，请刷新后重试'] },
    });
    expect(command).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each(cases)('requires permission before parsing or writing when attempting to $name', async ({ submit, values, command }) => {
    requirePermissionMock.mockRejectedValueOnce(new Error('无权操作'));
    await expect(submit(null, form(values))).rejects.toThrow('无权操作');
    expect(command).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('does not silently discard non-string unknown business fields', async () => {
    const input = new FormData();
    input.set('idempotencyKey', 'receipt-1');
    input.set('amount', new Blob(['0.01']), 'amount.txt');
    await expect(markAgentMonthlyBillPaidAction('bill-1', null, input)).resolves.toMatchObject({ status: 'invalid' });
    expect(markPaidMock).not.toHaveBeenCalled();
  });

  it.each([
    ['idempotencyKey', ''],
    ['paymentMethod', 'x'.repeat(101)],
    ['referenceNo', 'x'.repeat(101)],
  ])('keeps invalid %s feedback in business language', async (key, value) => {
    const input = new FormData();
    input.set('idempotencyKey', 'receipt-1');
    input.set(key, value);
    const result = await markAgentMonthlyBillPaidAction('bill-1', null, input);
    expect(result.status).toBe('invalid');
    expect(JSON.stringify(result)).not.toMatch(/Too small|Too big|Invalid|Unrecognized/);
    expect(markPaidMock).not.toHaveBeenCalled();
  });

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
