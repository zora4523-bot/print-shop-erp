import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BillMutationResult,
  RecordBillPaymentResult,
} from '@/actions/bill.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as BillMutationResult | RecordBillPaymentResult | null,
    pending: false,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [
      actionState.current,
      vi.fn(),
      actionState.pending,
    ],
    useTransition: () => [actionState.pending, vi.fn()],
  };
});

vi.mock('@/actions/bill', () => ({
  issueBillAction: vi.fn(),
  recordBillPaymentAction: vi.fn(),
}));

import { IssueBillButton } from '../IssueBillButton';
import {
  paymentImpactItems,
  RecordPaymentForm,
} from '../RecordPaymentForm';

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('bill mutation confirmations', () => {
  it('guards the one-way issue transition with an L2 dialog', () => {
    const html = renderToStaticMarkup(
      <IssueBillButton
        billId="bill-1"
        period="2026-08"
        recipientLabel="林客服（客服）"
        totalAmount="1280.00"
        orderCount={3}
      />,
    );

    expect(html).toContain('data-risk-level="L2"');
    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('发单给销售');
  });

  it('uses structured issue feedback and hides stale state while pending', () => {
    actionState.current = { status: 'error', message: '账单状态已变化' };
    let html = renderToStaticMarkup(
      <IssueBillButton
        billId="bill-1"
        period="2026-08"
        recipientLabel="林客服（客服）"
        totalAmount="1280.00"
        orderCount={3}
      />,
    );
    expect(html).toContain('data-tone="error"');
    expect(html).toContain('账单状态已变化');

    actionState.pending = true;
    html = renderToStaticMarkup(
      <IssueBillButton
        billId="bill-1"
        period="2026-08"
        recipientLabel="林客服（客服）"
        totalAmount="1280.00"
        orderCount={3}
      />,
    );
    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('正在发单…');
    expect(html).not.toContain('账单状态已变化');
  });

  it('keeps legacy success feedback out of the archived compatibility route', () => {
    actionState.current = { status: 'success' };
    const html = renderToStaticMarkup(
      <IssueBillButton
        billId="bill-1"
        period="2026-08"
        recipientLabel="林客服（客服）"
        totalAmount="1280.00"
        orderCount={3}
      />,
    );

    expect(html).not.toContain('账单已发布');
    const pageSource = readFileSync(
      path.join(
        process.cwd(),
        'app',
        '(billing)',
        'owner',
        'bills',
        '[id]',
        'page.tsx',
      ),
      'utf8',
    );
    expect(pageSource).toContain('redirect(`/owner/bills/archive/');
    expect(pageSource).not.toContain('title="账单已发布"');
  });

  it('builds an exact payment preview including the terminal transition', () => {
    expect(
      paymentImpactItems(
        {
          amount: '500.00',
          paidAt: '2026-08-24T10:30',
          paymentMethod: '银行',
          referenceNo: 'BANK-001',
        },
        '500.00',
      ),
    ).toEqual([
      '本次收款：¥ 500.00',
      '收款时间：2026-08-24 10:30',
      '收款方式：银行',
      '流水号：BANK-001',
      '本次收款后账单将进入已结清终态，不能直接回退。',
      '提交后请等待处理结果，勿重复录入。',
    ]);
  });

  it('keeps payment inputs reachable and reports invalid server fields', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { amount: ['付款金额不能超过剩余应收'] },
    };
    const html = renderToStaticMarkup(
      <RecordPaymentForm
        billId="bill-1"
        remainingAmount="500.00"
        initialIdempotencyKey="00000000-0000-4000-8000-000000000001"
      />,
    );

    expect(html).toContain('data-risk-level="L2"');
    expect(html).toContain('核对并录入付款');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('data-slot="form-error-summary"');
    expect(html).toContain('本次收款金额：付款金额不能超过剩余应收');
  });

  it('does not let Enter bypass the payment confirmation', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'bill',
        'RecordPaymentForm.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('onSubmit={handleSubmit}');
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('confirmedRef.current = true');
  });

  it('announces successful payment and disables the form while pending', () => {
    actionState.current = {
      status: 'success',
      newPaidAmount: '500.00',
      totalAmount: '1000.00',
      billStatus: 'PARTIAL_PAID',
    };
    let html = renderToStaticMarkup(
      <RecordPaymentForm
        billId="bill-1"
        remainingAmount="500.00"
        initialIdempotencyKey="00000000-0000-4000-8000-000000000001"
      />,
    );
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('付款流水已录入');

    actionState.pending = true;
    html = renderToStaticMarkup(
      <RecordPaymentForm
        billId="bill-1"
        remainingAmount="500.00"
        initialIdempotencyKey="00000000-0000-4000-8000-000000000001"
      />,
    );
    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('正在录入…');
    expect(html).not.toContain('付款流水已录入');
  });
});
