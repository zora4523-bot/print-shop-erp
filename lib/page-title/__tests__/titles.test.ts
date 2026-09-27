import { describe, it, expect } from 'vitest';
import {
  adminBillTitle,
  orderDetailTitle,
  orderEditTitle,
  orderPrintTitle,
  outsourceTitle,
  salesBillTitle,
  workerTaskTitle,
} from '../titles';

// 纯函数，零 mock。这里钉住两件事：
//   1. 业务编号必须排在最前 —— 这正是本次修复的诉求（标签宽度只够
//      显示开头十来个字符，模块名放前面所有标签长得一样）。
//   2. 取不到实体时的回落分两档：notFound 页说「X不存在」，
//      redirect / 打印视图只回落到模块名，不透露实体是否存在。

describe('详情页标题：业务编号在前', () => {
  it('工单详情', () => {
    expect(orderDetailTitle('GD-260821-001')).toBe('GD-260821-001 · 工单');
    expect(orderDetailTitle('GD-260821-001').startsWith('GD-')).toBe(true);
  });

  it('编辑工单', () => {
    expect(orderEditTitle('GD-260821-001')).toBe('GD-260821-001 · 编辑工单');
  });

  it('工单打印', () => {
    expect(orderPrintTitle('GD-260821-001')).toBe('GD-260821-001 · 工单打印');
  });

  it('老板账单：账期 + 销售姓名', () => {
    expect(
      adminBillTitle({ period: '2026-08', salesUserName: '销售小王' }),
    ).toBe('2026-08 销售小王 · 账单');
  });

  it('外部销售账单只留账期（自己的账单，姓名是冗余信息）', () => {
    expect(salesBillTitle('2026-08')).toBe('2026-08 · 账单');
  });

  it('师傅任务：工单号 + 款式序号', () => {
    expect(workerTaskTitle({ orderNo: 'GD-260821-001', sequence: 2 })).toBe(
      'GD-260821-001 #2 · 任务',
    );
  });
});

describe('outsourceTitle', () => {
  it('有关联工单时工单号排在最前', () => {
    expect(
      outsourceTitle({ supplierName: '佛山某烫金厂', orderNo: 'GD-260821-001' }),
    ).toBe('GD-260821-001 佛山某烫金厂 · 外协单');
  });

  it('没有关联工单时退化成「供应商 · 外协单」', () => {
    // OutsourceOrder.orderId 是可空外键，独立外协单确实没有工单号。
    expect(
      outsourceTitle({ supplierName: '佛山某烫金厂', orderNo: null }),
    ).toBe('佛山某烫金厂 · 外协单');
  });
});

describe('取不到实体时的回落', () => {
  it('notFound() 的页面说「X不存在」', () => {
    expect(orderDetailTitle(null)).toBe('工单不存在');
    expect(orderEditTitle(null)).toBe('工单不存在');
    expect(adminBillTitle(null)).toBe('账单不存在');
    expect(salesBillTitle(null)).toBe('账单不存在');
    expect(outsourceTitle(null)).toBe('外协单不存在');
    expect(workerTaskTitle(null)).toBe('任务不存在');
  });

  it('打印视图只回落到模块名，不说「不存在」', () => {
    // 打印视图的标题还会当作另存 PDF 的默认文件名。
    expect(orderPrintTitle(null)).toBe('工单打印');
  });
});
