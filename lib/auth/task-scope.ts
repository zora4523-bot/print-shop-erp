import { OrderStatus, Role } from '../../generated/prisma/enums';

// 与 ./order-scope 同构的纯 helper —— 无 session / auth 依赖，测试可直接
// import，不会把 next-auth 拉进编译图。
//
// 返回一段 ProductionTask 查询用的 `where` 片段：
//   - ADMIN：全部可见
//   - 其他角色：只能看分配给自己、且所属工单已离开 SUBMITTED 排产草稿态
//     的任务（部分排产会先建出 PENDING 任务，但整单仍是草稿，
//     见 DECISIONS「scheduling draft boundary」）
export function getWorkerTaskScopeFilter(actor: { id: string; role: Role }) {
  if (actor.role === Role.ADMIN) {
    return {};
  }
  return {
    workerId: actor.id,
    orderItem: { order: { status: { not: OrderStatus.SUBMITTED } } },
  };
}
