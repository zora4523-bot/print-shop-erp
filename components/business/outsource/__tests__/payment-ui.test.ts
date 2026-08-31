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
    expect(paymentForm).toContain('aria-busy={pending}');
    expect(paymentForm).toContain('<ActionNotice');
    expect(paymentForm).toContain('<FormErrorSummary');
  });

  it('routes payment through an L2 impact confirmation', () => {
    expect(detailPage).toContain('supplierName={row.supplierName}');
    expect(detailPage).toContain('orderNo={row.order?.orderNo ?? null}');
    expect(paymentForm).toContain('data-risk-level="L2"');
    expect(paymentForm).toContain('<ConfirmActionDialog');
    expect(paymentForm).toContain('level="L2"');
    expect(paymentForm).toContain('type="button"');
    expect(paymentForm).toContain('onClick={prepareConfirmation}');
    expect(paymentForm).toContain('onSubmit={handleSubmit}');
    expect(paymentForm).toContain('confirmedRef.current = true');
    expect(paymentForm).toContain('只记入外协加工付款');
    expect(paymentForm).toContain('防止重复记账');
  });
});
