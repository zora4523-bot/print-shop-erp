import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, Role } from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => {
  const mock: {
    order: { findFirst: ReturnType<typeof vi.fn> };
    productionTask: { findFirst: ReturnType<typeof vi.fn> };
    bill: { findUnique: ReturnType<typeof vi.fn> };
    agentMonthlyBill: { findUnique: ReturnType<typeof vi.fn> };
    salaryPeriod: { findUnique: ReturnType<typeof vi.fn> };
    outsourceOrder: { findUnique: ReturnType<typeof vi.fn> };
  } = {
    order: { findFirst: vi.fn() },
    productionTask: { findFirst: vi.fn() },
    bill: { findUnique: vi.fn() },
    agentMonthlyBill: { findUnique: vi.fn() },
    salaryPeriod: { findUnique: vi.fn() },
    outsourceOrder: { findUnique: vi.fn() },
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getAdminBillTitleRef,
  getCsPeriodTitleRef,
  getOrderTitleRef,
  getOutsourceTitleRef,
  getSalesBillTitleRef,
  getWorkerTaskTitleRef,
} from '../refs';

// 断言的是「标题查询带了和页面同一把闸口」，不是返回值 —— 标题也是数据，
// 换掉 id.slice() 不能顺手开一个越权读的口子。
//
// 注意不要写「同一请求内只查了一次」这类断言：node 环境下 react 解析到
// 客户端构建，cache() 是纯透传（见 ../refs.ts 文件头注释）。

function whereOf(call: ReturnType<typeof vi.fn>) {
  return (call.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
}

function selectOf(call: ReturnType<typeof vi.fn>) {
  return (call.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
}

beforeEach(() => {
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  dbMock.productionTask.findFirst.mockReset().mockResolvedValue(null);
  dbMock.bill.findUnique.mockReset().mockResolvedValue(null);
  dbMock.salaryPeriod.findUnique.mockReset().mockResolvedValue(null);
  dbMock.outsourceOrder.findUnique.mockReset().mockResolvedValue(null);
});

describe('getOrderTitleRef', () => {
  it('SALES 只能拿到自己提交的工单号', () => {
    getOrderTitleRef('order-1', 'sales-1', Role.SALES);

    expect(whereOf(dbMock.order.findFirst)).toEqual({
      id: 'order-1',
      submitterId: 'sales-1',
    });
  });

  it('WORKER 拿不到 SUBMITTED 排产草稿的工单号', () => {
    getOrderTitleRef('order-1', 'worker-1', Role.WORKER);

    expect(whereOf(dbMock.order.findFirst)).toEqual({
      id: 'order-1',
      status: { not: OrderStatus.SUBMITTED },
      items: { some: { tasks: { some: { workerId: 'worker-1' } } } },
    });
  });

  it('ADMIN 无行级限制，where 只有主键', () => {
    getOrderTitleRef('order-1', 'admin-1', Role.ADMIN);

    expect(whereOf(dbMock.order.findFirst)).toEqual({ id: 'order-1' });
  });

  it('只取标题要用的字段', () => {
    getOrderTitleRef('order-1', 'admin-1', Role.ADMIN);

    expect(selectOf(dbMock.order.findFirst)).toEqual({ orderNo: true });
  });
});

describe('getWorkerTaskTitleRef', () => {
  it('非 ADMIN 带 workerId 与「工单已离开 SUBMITTED」两个条件', () => {
    getWorkerTaskTitleRef('task-1', 'worker-1', Role.WORKER);

    expect(whereOf(dbMock.productionTask.findFirst)).toEqual({
      id: 'task-1',
      workerId: 'worker-1',
      orderItem: { order: { status: { not: OrderStatus.SUBMITTED } } },
    });
  });

  it('ADMIN 无行级限制', () => {
    getWorkerTaskTitleRef('task-1', 'admin-1', Role.ADMIN);

    expect(whereOf(dbMock.productionTask.findFirst)).toEqual({ id: 'task-1' });
  });

  it('只取工单号与款式序号，不带计件金额等敏感列', () => {
    getWorkerTaskTitleRef('task-1', 'admin-1', Role.ADMIN);

    expect(selectOf(dbMock.productionTask.findFirst)).toEqual({
      orderItem: {
        select: { sequence: true, order: { select: { orderNo: true } } },
      },
    });
  });
});

describe('getSalesBillTitleRef', () => {
  it('所有权写进 where，别人的账期查不出来', () => {
    getSalesBillTitleRef('bill-1', 'sales-1');

    expect(whereOf(dbMock.agentMonthlyBill.findUnique)).toEqual({
      id: 'bill-1',
      agentUserId: 'sales-1',
    });
  });

  it('只取账期，不带任何金额', () => {
    getSalesBillTitleRef('bill-1', 'sales-1');

    expect(selectOf(dbMock.agentMonthlyBill.findUnique)).toEqual({ period: true });
  });
});

describe('getAdminBillTitleRef', () => {
  // 这张表没有行级 scope，闸口在调用方的 hasPermission('bill:view:all')。
  // 这里守住的是投影：标题只要账期 + 销售姓名，不许把金额撑进来。
  it('只取账期与销售姓名', () => {
    getAdminBillTitleRef('bill-1');

    expect(whereOf(dbMock.bill.findUnique)).toEqual({ id: 'bill-1' });
    expect(selectOf(dbMock.bill.findUnique)).toEqual({
      period: true,
      salesUser: { select: { displayName: true } },
    });
  });
});

describe('getCsPeriodTitleRef', () => {
  it('只取周期起始日与客服姓名，不带业绩/提成', () => {
    getCsPeriodTitleRef('period-1');

    expect(whereOf(dbMock.salaryPeriod.findUnique)).toEqual({ id: 'period-1' });
    expect(selectOf(dbMock.salaryPeriod.findUnique)).toEqual({
      periodStart: true,
      csUser: { select: { displayName: true } },
    });
  });
});

describe('getOutsourceTitleRef', () => {
  it('只取供应商与关联工单号，不带外协金额', () => {
    getOutsourceTitleRef('outsource-1');

    expect(whereOf(dbMock.outsourceOrder.findUnique)).toEqual({
      id: 'outsource-1',
    });
    expect(selectOf(dbMock.outsourceOrder.findUnique)).toEqual({
      supplierName: true,
      order: { select: { orderNo: true } },
    });
  });
});
