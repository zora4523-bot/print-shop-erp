import { db } from '@/lib/db';
import { currentDispatchTargets } from '@/lib/production/dispatch-targets';
import { operationTypeForReporterAccount } from '@/lib/production/reporter-operation-lane';
import { progressCraftIdsForReporter } from '@/lib/production/progress-reporter-lane';

type Client = typeof db;

export type DispatchPageTask = {
  key: string;
  label: string;
  quantity: string;
  workerId: string;
  locked: boolean;
  options: { id: string; name: string }[];
};

export type DispatchPageOrder = {
  id: string;
  name: string;
  revision: number;
  version: number;
  tasks: DispatchPageTask[];
};

/**
 * 「安排生产师傅」页的数据：每张工单当前版本的派工目标、已有派工、以及按工序或
 * 进度工艺筛出的可选师傅。原先直接写在 app/(admin)/orders/production/page.tsx
 * 里（页面层直连 db，违反 CLAUDE.md §3 的调用方向），2026-09-29 下沉到 lib。
 */
export async function loadDispatchPageOrders(ids: string[], client: Client = db): Promise<DispatchPageOrder[]> {
  const workers = await client.user.findMany({
    where: { role: 'WORKER', isActive: true, workerType: { not: 'PACKER' } },
    orderBy: { displayName: 'asc' },
  });
  const workerCrafts = new Map<string, string[]>();
  for (const worker of workers) workerCrafts.set(worker.id, await progressCraftIdsForReporter(client, worker));

  const rows: DispatchPageOrder[] = [];
  for (const id of ids) {
    const { order, targets } = await currentDispatchTargets(client, id);
    const jobs = await client.productionJob.findMany({ where: { orderId: id, workOrderVersion: order.workOrderVersion } });
    rows.push({
      id,
      name: order.customName || order.orderNo,
      revision: order.revision,
      version: order.workOrderVersion,
      tasks: targets.map((target) => {
        const job = jobs.find((candidate) => candidate.sourceKey === target.key);
        const options = workers
          .filter((worker) => target.operationType
            ? operationTypeForReporterAccount(worker) === target.operationType
            : workerCrafts.get(worker.id)?.includes(target.craftId!))
          .map((worker) => ({ id: worker.id, name: worker.displayName }));
        if (job && !options.some((worker) => worker.id === job.workerId)) {
          options.push({ id: job.workerId, name: `${job.workerName}（原生产师傅）` });
        }
        return {
          key: target.key,
          label: target.label,
          quantity: job?.plannedQty.toString() ?? target.quantity,
          workerId: job?.workerId ?? '',
          locked: !!job && job.status !== 'PENDING',
          options,
        };
      }),
    });
  }
  return rows;
}
