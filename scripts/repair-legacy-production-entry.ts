import 'dotenv/config';
import { db } from '../lib/db';
import { repairLegacyProductionEntry } from '../lib/production/legacy-entry';

// Default is read-only. Apply only to the explicitly reviewed order IDs; each order
// gets a fresh locked readiness check, keeps saved prices and produces an audit trail.
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const actorId = args.find(arg => arg.startsWith('--actor='))?.slice(8);
  const ids = args.find(arg => arg.startsWith('--ids='))?.slice(6).split(',').filter(Boolean);
  if (args.some(arg => arg !== '--apply' && !arg.startsWith('--actor=') && !arg.startsWith('--ids='))) throw new TypeError('未知参数；用法：--actor=<管理员ID> [--ids=<工单ID,工单ID>] [--apply]');
  if (!actorId || (apply && !ids?.length)) throw new TypeError('用法：--actor=<管理员ID> [--ids=<工单ID,工单ID>] [--apply]；应用时必须指定已检查的工单');
  const actor = await db.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, isActive: true } });
  if (actor.role !== 'ADMIN' || !actor.isActive) throw new Error('需要有效的管理员账号');
  let cursor: string | undefined;
  let failures = 0;
  const seen = new Set<string>();
  do {
    const orders = await db.order.findMany({ where: ids ? { id: { in: ids } } : { status: { in: ['PENDING_FACTORY', 'SUBMITTED', 'CONFIRMED'] } }, select: { id: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const order of orders) {
      seen.add(order.id);
      try { console.log(JSON.stringify(await repairLegacyProductionEntry(order.id, actor, apply))); }
      catch (error) { failures++; console.error(JSON.stringify({ orderId: order.id, error: error instanceof Error ? error.name : 'UnknownError', code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null, message: '本单事务已回滚，保留原数据；请根据错误类型核对工单资料后重试' })); }
    }
    cursor = orders.length === 100 ? orders.at(-1)!.id : undefined;
  } while (cursor);
  for (const id of new Set(ids ?? [])) if (!seen.has(id)) { failures++; console.error(JSON.stringify({ orderId: id, error: 'ORDER_NOT_FOUND' })); }
  if (failures) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof TypeError ? error.message : '执行失败，请检查管理员、参数及数据库配置'); process.exitCode = 1; }).finally(() => db.$disconnect());
