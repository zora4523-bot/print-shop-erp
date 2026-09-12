import { cache } from 'react';
import { Role } from '../../generated/prisma/enums';
import { db } from '../db';
import { getOrderScopeFilter } from '../auth/order-scope';
import { getWorkerTaskScopeFilter } from '../auth/task-scope';

// generateMetadata 与页面组件是同一次请求里两次独立执行。Next 只自动
// memo fetch()，Prisma 查询不在其中 —— node_modules/next/dist/docs/01-app/
// 01-getting-started/14-metadata-and-og-images.md 的「Memoizing data
// requests」一节明确要求非 fetch 场景用 React cache() 去重。所以这里每个
// 取数都包一层 cache()，同一请求内重复调用只打一次库。
//
// ⚠️ cache() 的 key 是逐参数比对：primitive 走 Map、对象/函数走 WeakMap
// 引用相等（见 react/cjs/react.react-server.production.js 的 exports.cache）。
// 所以这里一律只收 primitive。如果签名收 { id, role } 而两个调用点各写一个
// 对象字面量，缓存永远 miss、库照打两次，且不会有任何报错。
//
// 另：node 环境（vitest）下 react 解析到客户端构建，cache() 是纯透传
// （react/cjs/react.production.js 的 exports.cache），单测里等同于没包，
// 因此不要写「断言只查了一次」这种测试。
//
// 每个查询都带上和页面同一把 scope 闸口：标题也是数据，不能为了好看
// 开一个越权读的口子。

export const getOrderTitleRef = cache(
  async (id: string, viewerId: string, viewerRole: Role) =>
    db.order.findFirst({
      where: { id, ...getOrderScopeFilter({ id: viewerId, role: viewerRole }) },
      select: { orderNo: true },
    }),
);

export const getWorkerTaskTitleRef = cache(
  async (taskId: string, actorId: string, actorRole: Role) =>
    db.productionTask.findFirst({
      where: {
        id: taskId,
        ...getWorkerTaskScopeFilter({ id: actorId, role: actorRole }),
      },
      select: {
        orderItem: {
          select: { sequence: true, order: { select: { orderNo: true } } },
        },
      },
    }),
);

export const getAdminBillTitleRef = cache(async (id: string) =>
  db.bill.findUnique({
    where: { id },
    select: { period: true, salesUser: { select: { displayName: true } } },
  }),
);

export const getSalesBillTitleRef = cache(
  async (id: string, salesUserId: string) =>
    // 所有权写进 where，与销售月账单查询一致：不先读进来再判断。
    db.agentMonthlyBill.findUnique({
      where: { id, agentUserId: salesUserId },
      select: { period: true },
    }),
);

export const getCsPeriodTitleRef = cache(async (id: string) =>
  db.salaryPeriod.findUnique({
    where: { id },
    select: { periodStart: true, csUser: { select: { displayName: true } } },
  }),
);

export const getOutsourceTitleRef = cache(async (id: string) =>
  db.outsourceOrder.findUnique({
    where: { id },
    select: { supplierName: true, order: { select: { orderNo: true } } },
  }),
);
