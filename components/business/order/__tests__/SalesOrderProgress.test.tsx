import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderStatus } from '@/generated/prisma/enums';
import { SalesOrderProgress } from '../SalesOrderProgress';

describe('SalesOrderProgress', () => {
  const cases = [
    [OrderStatus.DRAFT, null, '草稿尚未提交'],
    [OrderStatus.PENDING_FACTORY, '已提交'],
    [OrderStatus.SUBMITTED, '已提交'],
    [OrderStatus.CONFIRMED, '工厂处理'],
    [OrderStatus.SCHEDULING, '工厂处理'],
    [OrderStatus.RELEASED, '生产'],
    [OrderStatus.FOILING, '生产'],
    [OrderStatus.PACKING, '生产'],
    [OrderStatus.IN_PRODUCTION, '生产'],
    [OrderStatus.COMPLETED, '生产'],
    [OrderStatus.SHIPPED, '发货'],
    [OrderStatus.SETTLED, '完成'],
    [OrderStatus.FINISHED, '完成'],
    [OrderStatus.REJECTED, null, '工单已驳回，待修改后重新提交'],
    [OrderStatus.ON_HOLD, null, '工单已暂停'],
    [OrderStatus.CANCELLED, null, '工单已取消'],
  ] as const;

  it('covers every current and historical workflow status', () => {
    expect(cases.map(([status]) => status).sort()).toEqual(Object.values(OrderStatus).sort());
  });

  it.each(cases)('%s shows only its actual stage', (status, current, message?: string) => {
    const html = renderToStaticMarkup(<SalesOrderProgress status={status} />);
    const activeSteps = [...html.matchAll(/<li aria-current="step"[^>]*>(.*?)<\/li>/g)].map((match) => match[1]);
    expect(activeSteps).toEqual(current === null ? [] : [current]);
    if (message) {
      expect(html).toContain(message);
      expect(html).not.toContain('工单进度');
      expect(html).not.toContain('完成');
    }
  });

  it('does not infer completion for an unrecognized runtime status', () => {
    const html = renderToStaticMarkup(<SalesOrderProgress status={'FUTURE_STATUS' as OrderStatus} />);
    expect(html).toContain('工单进度暂不可用');
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain('完成');
  });
});
