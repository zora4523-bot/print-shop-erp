import { describe, expect, it } from 'vitest';
import { OrderPricingStatus, OrderStatus } from '../../../generated/prisma/enums';
import {
  formatSalesOrderUpdatedAt,
  salesOrderAmountPresentation,
  salesOrderPrimaryAction,
  salesOrderStatusPresentation,
} from '../sales-list-presentation';

describe('sales order list presentation', () => {
  it('projects internal production states into sales-facing language', () => {
    expect(salesOrderStatusPresentation(OrderStatus.DRAFT).label).toBe('草稿');
    expect(
      salesOrderStatusPresentation(OrderStatus.PENDING_FACTORY).label,
    ).toBe('待工厂处理');
    expect(salesOrderStatusPresentation(OrderStatus.SUBMITTED).label).toBe(
      '待工厂处理',
    );
    for (const status of [
      OrderStatus.SCHEDULING,
      OrderStatus.IN_PRODUCTION,
    ]) {
      expect(salesOrderStatusPresentation(status).label).toBe('生产中');
    }
    expect(salesOrderStatusPresentation(OrderStatus.COMPLETED).label).toBe('待打包发货');
    expect(salesOrderStatusPresentation(OrderStatus.SHIPPED).label).toBe(
      '已发货',
    );
    expect(salesOrderStatusPresentation(OrderStatus.FINISHED).label).toBe(
      '已完成',
    );
  });

  it('销售端 tone 收敛到共享六档，不自带第二套色板', () => {
    // 白名单写成字面量而不是 import components/ui-business：那个 barrel 会把
    // 一堆 tsx 拉进 node 环境的 lib 测试。
    const TONES = ['primary', 'warning', 'info', 'success', 'danger', 'neutral'];
    for (const status of Object.values(OrderStatus)) {
      expect(TONES, status).toContain(salesOrderStatusPresentation(status).tone);
    }
    // 驳回 / 取消是非正常终态（规范 §6），danger 只留给它们
    expect(salesOrderStatusPresentation(OrderStatus.REJECTED).tone).toBe(
      'danger',
    );
    expect(salesOrderStatusPresentation(OrderStatus.CANCELLED).tone).toBe(
      'danger',
    );
    // 暂停可恢复，是提醒不是失败
    expect(salesOrderStatusPresentation(OrderStatus.ON_HOLD).tone).toBe(
      'warning',
    );
    // 三态合一的「生产中」不能提前变绿，否则等于对客户承诺已完工
    for (const status of [
      OrderStatus.SCHEDULING,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.COMPLETED,
    ]) {
      expect(salesOrderStatusPresentation(status).tone).toBe('info');
    }
    expect(salesOrderStatusPresentation(OrderStatus.SHIPPED).tone).toBe(
      'success',
    );
  });

  it('keeps draft, estimated, manual and confirmed amounts distinct', () => {
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.DRAFT,
        pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
        totalAmount: '123.00',
        feeLines: [],
      }),
    ).toEqual({ label: '—', estimated: false, pending: false });
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.PENDING_FACTORY,
        pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
        totalAmount: '404.30',
        feeLines: [],
      }),
    ).toEqual({
      label: '待工厂核价',
      estimated: false,
      pending: true,
    });
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.SUBMITTED,
        pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
        totalAmount: '0.00',
        feeLines: [],
      }),
    ).toEqual({
      label: '待工厂核价',
      estimated: false,
      pending: true,
    });
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.SCHEDULING,
        pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
        totalAmount: '1924.00',
        feeLines: [],
      }),
    ).toEqual({ label: '¥ 1,924.00', estimated: false, pending: false });
    expect(
      salesOrderAmountPresentation({
        status: OrderStatus.SCHEDULING,
        pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
        totalAmount: '1924.00',
        feeLines: [
          {
            id: 'shipping',
            label: '快递费',
            amount: '41.30',
            estimated: true,
          },
        ],
      }),
    ).toEqual({ label: '¥ 1,924.00', estimated: true, pending: false });
  });

  it('uses only real actions exposed by the current application', () => {
    expect(
      salesOrderPrimaryAction({ status: OrderStatus.DRAFT, needsAction: false }),
    ).toBe('查看草稿');
    expect(
      salesOrderPrimaryAction({
        status: OrderStatus.PENDING_FACTORY,
        needsAction: true,
      }),
    ).toBe('查看原因');
    expect(
      salesOrderPrimaryAction({
        status: OrderStatus.IN_PRODUCTION,
        needsAction: false,
      }),
    ).toBe('查看详情');
  });

  it('formats relative updates against the server-provided reference time', () => {
    const now = '2026-08-27T08:00:00.000Z';
    expect(formatSalesOrderUpdatedAt('2026-08-27T07:59:45.000Z', now)).toBe(
      '刚刚更新',
    );
    expect(formatSalesOrderUpdatedAt('2026-08-27T07:42:00.000Z', now)).toBe(
      '18 分钟前更新',
    );
    expect(formatSalesOrderUpdatedAt('2026-08-27T03:00:00.000Z', now)).toBe(
      '5 小时前更新',
    );
  });
});
