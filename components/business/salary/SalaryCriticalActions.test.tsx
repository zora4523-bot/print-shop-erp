import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { actionState, actionPending } = vi.hoisted(() => ({
  actionState: { current: null as unknown },
  actionPending: { current: false },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [
      actionState.current,
      vi.fn(),
      actionPending.current,
    ],
  };
});

vi.mock('@/actions/owner-salary', () => ({
  recordCsPayrollPaymentAction: vi.fn(),
  settleCsPeriodAction: vi.fn(),
  settleReadyCsPeriodsAction: vi.fn(),
}));

import {
  CsPayrollPaymentForm,
  csPayrollPaymentImpactItems,
} from './CsPayrollPaymentForm';
import {
  SettleCsPeriodButton,
  csPeriodSettlementImpactItems,
} from './SettleCsPeriodButton';
import {
  SettleReadyCsButton,
  readyCsSettlementImpactItems,
} from './SettleReadyCsButton';

const salarySources = [
  'CsPayrollPaymentForm.tsx',
  'SettleCsPeriodButton.tsx',
  'SettleReadyCsButton.tsx',
].map((file) =>
  readFileSync(
    path.join(process.cwd(), 'components', 'business', 'salary', file),
    'utf8',
  ),
);

const settlementContext = {
  csUserName: '陈客服',
  periodLabel: '2026-01-01 ~ 2026-04-30',
  tierSalesTotal: '200000.00',
  baseTotal: '12000.00',
  paidBase: '9000.00',
  paidCommission: '0.00',
  willStartNextPeriod: true,
};

const readyPreview = {
  duePeriodCount: 2,
  csUserCount: 2,
  tierSalesTotal: '350000.00',
  baseTotal: '24000.00',
  earliestPeriodEnd: '2026-04-30',
  latestPeriodEnd: '2026-05-31',
  samplePeriods: [
    {
      periodId: 'period-1',
      csUserName: '陈客服',
      periodLabel: '2026-01-01 ~ 2026-04-30',
      tierSalesTotal: '200000.00',
      baseTotal: '12000.00',
    },
  ],
};

beforeEach(() => {
  actionState.current = null;
  actionPending.current = false;
});

describe('salary critical-action confirmations', () => {
  it('previews the immutable CS payroll ledger with the same idempotent request', () => {
    const impact = csPayrollPaymentImpactItems({
      preview: {
        baseAmount: '3000',
        commissionAmount: '500.00',
        paidAt: '2026-08-24T09:30',
        paymentMethod: '银行',
        referenceNo: 'PAY-001',
      },
      csUserName: '陈客服',
      periodLabel: '2026-01-01 ~ 2026-04-30',
      remainingBase: '3000.00',
      remainingCommission: '500.00',
      commissionAvailable: true,
    }).join('\n');

    expect(impact).toContain('发放对象：陈客服');
    expect(impact).toContain('本次底薪 ¥ 3,000.00');
    expect(impact).toContain('底薪和提成将全部发放完成');
    expect(impact).toContain('不可覆盖的工资流水');
    expect(impact).toContain('提交后请等待处理结果，勿重复录入');
    expect(impact).not.toContain('请求标识');

    const html = renderToStaticMarkup(
      <CsPayrollPaymentForm
        periodId="period-1"
        csUserName="陈客服"
        periodLabel="2026-01-01 ~ 2026-04-30"
        remainingBase="3000.00"
        remainingCommission="500.00"
        commissionAvailable
        initialIdempotencyKey="b3fa3623-36cd-41c7-9b1f-0ef63970df33"
      />,
    );
    expect(html).toContain('data-risk-level="L2"');
    expect(html).toContain('pattern="[0-9]{1,10}([.][0-9]{1,2})?"');
    expect(html).toMatch(/type="datetime-local"[^>]*required=""/);
    expect(html).toContain('核对并记录工资发放');

    const source = salarySources[0]!;
    expect(source).toContain('form.reportValidity()');
    expect(source).toContain('onSubmit={handleSubmit}');
    expect(source).toContain('confirmedRef.current = true');
    expect(source).toContain('setIdempotencyKey(window.crypto.randomUUID())');
  });

  it('shows settlement amounts, terminal state and next-period behavior', () => {
    const impact = csPeriodSettlementImpactItems(settlementContext).join('\n');
    expect(impact).toContain('算档业绩（本期累计 + 期初）：¥ 200,000.00');
    expect(impact).toContain('生成提成记录，并锁定本周期');
    expect(impact).toContain('自动开始或沿用下一周期');
    expect(impact).toContain('本次结算不会生效');
    expect(impact).not.toContain('服务器');
    expect(impact).not.toContain('原子');

    const html = renderToStaticMarkup(
      <SettleCsPeriodButton
        periodId="period-1"
        context={settlementContext}
      />,
    );
    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain('核对并立即结算');
  });

  it('shows the batch candidate snapshot and renders per-period failures', () => {
    const impact = readyCsSettlementImpactItems(readyPreview).join('\n');
    expect(impact).toContain('2 个已到期周期，涉及 2 位客服');
    expect(impact).toContain('陈客服 · 2026-01-01 ~ 2026-04-30');
    expect(impact).toContain('可能大于当前初始预览数');
    expect(impact).toContain('逐周期处理');
    expect(impact).not.toContain('周期 ID');

    actionState.current = {
      status: 'success',
      settledCount: 1,
      errorCount: 1,
      errors: [{ periodId: 'period-2', message: '缺少提成档位' }],
    };
    const html = renderToStaticMarkup(
      <SettleReadyCsButton preview={readyPreview} />,
    );
    expect(html).toContain('data-status="partial"');
    expect(html).toContain('1 项成功，1 项失败');
    expect(html).toContain('未完成周期');
    expect(html).not.toContain('period-2');
    expect(html).toContain('缺少提成档位');
  });

  it('keeps every operation at L2 because no server contract persists an audit reason', () => {
    for (const source of salarySources) {
      expect(source).toContain('level="L2"');
      expect(source).not.toContain('level="L3"');
    }
  });

  it('hides stale results and exposes busy state while a request is pending', () => {
    actionState.current = {
      status: 'success',
      settledCount: 3,
      errorCount: 0,
      errors: [],
    };
    actionPending.current = true;
    const html = renderToStaticMarkup(
      <SettleReadyCsButton preview={readyPreview} />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('扫描结算中…');
    expect(html).not.toContain('客服工资周期批量结算结果');
  });
});
