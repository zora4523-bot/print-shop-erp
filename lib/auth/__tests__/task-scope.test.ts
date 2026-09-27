import { describe, it, expect } from 'vitest';
import { OrderStatus, Role } from '../../../generated/prisma/enums';
import { getWorkerTaskScopeFilter } from '../task-scope';

// 这份片段同时喂给 lib/production.ts 的 getWorkerTaskDetail 和
// lib/page-title/refs.ts 的 getWorkerTaskTitleRef。它也是
// getWorkerTaskDetail 从「findUnique + 事后过滤」改成「findFirst + where」
// 之后唯一的等价性依据，所以逐角色钉住。

describe('getWorkerTaskScopeFilter', () => {
  it('ADMIN 无行级限制', () => {
    expect(getWorkerTaskScopeFilter({ id: 'admin-1', role: Role.ADMIN })).toEqual(
      {},
    );
  });

  it('WORKER 只看分配给自己、且工单已离开 SUBMITTED 草稿态的任务', () => {
    expect(
      getWorkerTaskScopeFilter({ id: 'worker-1', role: Role.WORKER }),
    ).toEqual({
      workerId: 'worker-1',
      orderItem: { order: { status: { not: OrderStatus.SUBMITTED } } },
    });
  });

  it('SALES 走同一条 workerId 过滤（等于一无所获）', () => {
    // 销售身上不会挂生产任务，workerId 过滤天然把他们挡在外面 ——
    // 与改造前「row.workerId !== actor.id → null」的事后过滤等价。
    for (const role of [Role.SALES] as const) {
      expect(getWorkerTaskScopeFilter({ id: 'u-1', role })).toEqual({
        workerId: 'u-1',
        orderItem: { order: { status: { not: OrderStatus.SUBMITTED } } },
      });
    }
  });
});
