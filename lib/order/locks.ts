// Order 级 advisory lock key —— 单一出口。
//
// 硬不变量：**所有** Order.status 写入路径（submit/cancel/ship/finish/
// 工序物化/worker cascade/外协创建/设计图登记删除）必须持同一把
// per-order 锁互相串行，否则并发状态转换会双写日志或跳过状态机校验。
//
// 该 key 曾以字符串字面量分散在多个写入路径。收敛到这里后，
// 新写入路径 import 本函数即自动入队。
//
// 用法（tx 内）：
//   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(orderId)}))`;
export function orderCascadeLockKey(orderId: string): string {
  return `print-shop-erp:order-cascade:${orderId}`;
}
