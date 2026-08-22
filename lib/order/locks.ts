// Order 级 advisory lock key —— 单一出口。
//
// 硬不变量：**所有** Order.status 写入路径（submit/cancel/ship/finish/
// scheduleOrder/worker cascade/外协创建/设计图登记删除）必须持同一把
// per-order 锁互相串行，否则并发状态转换会双写日志或跳过状态机校验。
//
// 此前该 key 以字符串字面量分散在 5 处（lib/order.ts、lib/production.ts
// ×2、lib/outsource.ts、lib/order-design.ts）——不变量靠"5 处都没打错字"
// 维持。收敛到这里后，新写入路径 import 本函数即自动入队。
//
// 用法（tx 内）：
//   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(orderId)}))`;
export function orderCascadeLockKey(orderId: string): string {
  return `print-shop-erp:order-cascade:${orderId}`;
}
