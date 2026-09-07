import Decimal from 'decimal.js';
import { Children, isValidElement, Suspense, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SalaryPeriodStatus } from '@/generated/prisma/enums';
import { ContentSkeleton, ErrorBoundary } from '@/components/ui-business';
import { CsPeriodForecast } from '../CsPeriodForecast';
import { CsPeriodSummary } from '../CsPeriodSummary';

vi.mock('@/lib/salary/rules', () => ({ getActiveCsTiers: vi.fn() }));

const props = {
  period: {
    status: SalaryPeriodStatus.IN_PROGRESS,
    monthlyBase: new Decimal('5000.25'),
    initialSales: new Decimal('20000.05'),
    totalSales: new Decimal('100000.02'),
    durationMonths: 4,
    settledAt: null,
  },
  attendanceSummary: { workUnits: '21.5', leaveUnits: '0.5' },
  baseTotal: '20001.00',
  tierSalesTotal: '120000.07',
};

describe('客服周期概览', () => {
  it('展示服务端已计算的金额和考勤值，不按请假天数改写底薪', () => {
    const sections = Children.toArray(CsPeriodSummary(props).props.children);
    const html = renderToStaticMarkup(sections[0]);
    expect(html).toContain('20001.00');
    expect(html).toContain('120000.07');
    expect(html).toContain('21.5 天');
    expect(html).toContain('0.5 天');
    expect(html).toContain('按当前工资制度不自动扣减客服周期底薪');
  });

  it('进行中周期的预测独立加载和失败，保持原始金额输入', () => {
    const sections = Children.toArray(CsPeriodSummary(props).props.children);
    const boundary = sections[1];
    expect(isValidElement(boundary)).toBe(true);
    if (!isValidElement<ComponentProps<typeof ErrorBoundary>>(boundary)) {
      throw new Error('预测错误边界缺失');
    }
    expect(boundary.type).toBe(ErrorBoundary);
    expect(boundary.props.scope).toBe('section');
    const suspense = boundary.props.children;
    if (!isValidElement<ComponentProps<typeof Suspense>>(suspense)) {
      throw new Error('预测加载边界缺失');
    }
    expect(suspense.type).toBe(Suspense);
    expect(isValidElement(suspense.props.fallback) && suspense.props.fallback.type)
      .toBe(ContentSkeleton);
    const forecast = suspense.props.children;
    if (!isValidElement<ComponentProps<typeof CsPeriodForecast>>(forecast)) {
      throw new Error('预测组件缺失');
    }
    expect(forecast.type).toBe(CsPeriodForecast);
    expect(forecast.props).toEqual({
      status: SalaryPeriodStatus.IN_PROGRESS,
      monthlyBase: '5000.25',
      initialSales: '20000.05',
      totalSales: '100000.02',
      durationMonths: 4,
    });
  });

  it('已结算周期只展示参数与结算时间，不重新展示预测', () => {
    const summary = CsPeriodSummary({
      ...props,
      period: {
        ...props.period,
        status: SalaryPeriodStatus.SETTLED,
        settledAt: new Date('2026-09-07T01:30:00Z'),
      },
    });
    expect(Children.toArray(summary.props.children)).toHaveLength(1);
    const html = renderToStaticMarkup(summary);
    expect(html).toContain('2026/09/07 09:30');
    expect(html).not.toContain('结算预测');
  });
});
