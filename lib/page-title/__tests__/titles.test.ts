import { describe, it, expect } from 'vitest';
import {
  adminBillTitle,
  csPeriodTitle,
  orderDetailTitle,
  orderEditTitle,
  orderPrintTitle,
  outsourceTitle,
  salesBillTitle,
  schedulingTitle,
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

  it('排产', () => {
    expect(schedulingTitle('GD-260821-001')).toBe('GD-260821-001 · 排产');
  });

  it('师傅任务：工单号 + 款式序号', () => {
    expect(workerTaskTitle({ orderNo: 'GD-260821-001', sequence: 2 })).toBe(
      'GD-260821-001 #2 · 任务',
    );
  });
});

describe('csPeriodTitle', () => {
  it('起始月份按 Asia/Shanghai 算，不按 UTC', () => {
    // periodStart 是 @db.Date（UTC 午夜口径）。2026-04-30T16:00Z 在
    // 上海已经是 2026-05-01，走服务器本地/UTC 会算成 2026-04。
    expect(
      csPeriodTitle({
        csUserName: '客服小李',
        periodStart: new Date('2026-04-30T16:00:00Z'),
      }),
    ).toBe('客服小李 2026-05起 · 客服周期');
  });

  it('取不到周期时说不存在', () => {
    expect(csPeriodTitle(null)).toBe('客服周期不存在');
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

  it('redirect / 打印视图只回落到模块名，不说「不存在」', () => {
    // 排产页在工单已离开 SUBMITTED 时 redirect 回列表，不是 notFound；
    // 打印视图的标题还会当作另存 PDF 的默认文件名。
    expect(schedulingTitle(null)).toBe('排产');
    expect(orderPrintTitle(null)).toBe('工单打印');
  });
});
