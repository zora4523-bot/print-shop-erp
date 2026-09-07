import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalaryPeriodStatus } from '@/generated/prisma/enums';
import { CsPeriodForecast, type CsPeriodForecastProps } from '../CsPeriodForecast';

const { getActiveCsTiersMock } = vi.hoisted(() => ({ getActiveCsTiersMock: vi.fn() }));
vi.mock('@/lib/salary/rules', () => ({ getActiveCsTiers: getActiveCsTiersMock }));

const period: CsPeriodForecastProps = {
  status: SalaryPeriodStatus.IN_PROGRESS,
  totalSales: '999.99',
  initialSales: '0.01',
  monthlyBase: '200.01',
  durationMonths: 3,
};

beforeEach(() => {
  getActiveCsTiersMock.mockReset();
  getActiveCsTiersMock.mockResolvedValue({
    mode: 'FLAT',
    tiers: [{ minSales: '1000.00', rate: '0.10' }],
  });
});

describe('客服周期结算预测', () => {
  it('期初业绩参与达档，周期总收入包含所有月份底薪', async () => {
    const html = renderToStaticMarkup(await CsPeriodForecast(period));
    expect(html).toContain('业绩合计（含期初）');
    expect(html).toContain('¥ 1,000.00');
    expect(html).toContain('¥ 100.00');
    expect(html).toContain('¥ 700.03');
    expect(html).toContain('最终金额以结算为准');
    expect(html).not.toContain('未达到最低');
  });

  it('低于最低档位明确显示零提成，保留预测周期底薪', async () => {
    const html = renderToStaticMarkup(await CsPeriodForecast({ ...period, initialSales: '0.00' }));
    expect(html).toContain('¥ 999.99');
    expect(html).toContain('¥ 0.00');
    expect(html).toContain('¥ 600.03');
    expect(html).toContain('未达到最低提成档位');
  });

  it('没有生效规则时保留业绩，不能把未知提成和收入显示为零', async () => {
    getActiveCsTiersMock.mockResolvedValueOnce(null);
    const html = renderToStaticMarkup(await CsPeriodForecast(period));
    expect(html).toContain('¥ 1,000.00');
    expect(html.match(/暂无法预测/g)).toHaveLength(2);
    expect(html).toContain('未配置生效的客服提成规则');
    expect(html).not.toContain('¥ 0.00');
    expect(html).not.toContain('¥ 600.03');
  });

  it('保留与工作台预测相同的 Decimal 累加和金额舍入', async () => {
    getActiveCsTiersMock.mockResolvedValueOnce({ mode: 'FLAT', tiers: [{ minSales: '0.00', rate: '0.10' }] });
    const html = renderToStaticMarkup(await CsPeriodForecast({
      ...period, totalSales: '0.10', initialSales: '0.05', monthlyBase: '100.01', durationMonths: 1,
    }));
    expect(html).toContain('¥ 0.15');
    expect(html).toContain('¥ 0.02');
    expect(html).toContain('¥ 100.03');
  });

  it('已结算周期不查询当前规则或覆盖历史金额', async () => {
    expect(await CsPeriodForecast({ ...period, status: SalaryPeriodStatus.SETTLED })).toBeNull();
    expect(getActiveCsTiersMock).not.toHaveBeenCalled();
  });

  it('规则读取失败继续向区域错误边界抛出，不伪装成未配置或零金额', async () => {
    const failure = new Error('rules unavailable');
    getActiveCsTiersMock.mockRejectedValueOnce(failure);
    await expect(CsPeriodForecast(period)).rejects.toBe(failure);
  });
});
