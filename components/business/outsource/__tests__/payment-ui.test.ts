import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const detailPage = readFileSync(
  path.join(
    process.cwd(),
    'app',
    '(admin)',
    'foreman',
    'outsource',
    '[id]',
    'page.tsx',
  ),
  'utf8',
);
const paymentForm = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'outsource',
    'OutsourcePaymentForm.tsx',
  ),
  'utf8',
);

describe('outsource payment detail UI contract', () => {
  it('shows an unambiguous payable summary and an append-only payment history', () => {
    for (const label of [
      '外协加工应付',
      '已付',
      '未付',
      '付款明细',
      '不进入销售账单或员工工资',
    ]) {
      expect(detailPage).toContain(label);
    }
    expect(detailPage).toContain('row.payments.map');
    expect(detailPage).toContain('payment.recordedBy.displayName');
    expect(detailPage).toContain('admin-wrap-anywhere');
  });

  it('gates payment by receipt, confirmed amount, remaining balance, and ledger integrity', () => {
    expect(detailPage).toContain(
      'row.status !== OutsourceStatus.RECEIVED',
    );
    expect(detailPage).toContain('payableAmount === null');
    expect(detailPage).toContain('remainingAmount?.isZero()');
    expect(detailPage).toContain('paymentLedgerInvalid');
    expect(detailPage).toContain('<OutsourcePaymentForm');
    expect(detailPage).toContain('外协单回货后才能记录付款');
    expect(detailPage).toContain('该外协单已结清');
  });

  it('keeps form labels, status feedback, and validation feedback accessible', () => {
    for (const control of ['amount', 'paid-at', 'method', 'reference', 'remark']) {
      expect(paymentForm).toContain(
        `htmlFor="outsource-payment-${control}"`,
      );
      expect(paymentForm).toContain(`id="outsource-payment-${control}"`);
    }
    expect(paymentForm).toContain('role="status"');
    expect(paymentForm).toContain('aria-live="polite"');
    expect(paymentForm).toContain('role="alert"');
  });
});
