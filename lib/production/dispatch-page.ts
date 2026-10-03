import { db } from '@/lib/db';
import { currentDispatchTargets } from '@/lib/production/dispatch-targets';
import { operationTypeForReporterAccount } from '@/lib/production/reporter-operation-lane';
import { progressCraftIdsForReporter } from '@/lib/production/progress-reporter-lane';
import { DispatchPlanValidationError } from './dispatch-plan-error';

type Client = typeof db;

type DispatchPageTask = {
  key: string;
  label: string;
  quantity: string;
  workerId: string;
  locked: boolean;
  options: { id: string; name: string }[];
};

type DispatchPageOrder = {
  id: string;
  name: string;
  revision: number;
  version: number;
  tasks: DispatchPageTask[];
  issues?: string[];
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
    let current;
    try {
      current = await currentDispatchTargets(client, id);
    } catch (error) {
      if (!(error instanceof DispatchPlanValidationError)) throw error;
      rows.push({ ...error.order, tasks: [], issues: error.issues });
      continue;
    }
    const { order, targets } = current;
    if (!targets.length) {
      rows.push({ id, name: order.customName || order.orderNo, revision: order.revision, version: order.workOrderVersion, tasks: [],
        issues: [order.purpose === 'SAMPLE_SHIPMENT' ? '寄样工单无需安排生产师傅，请在工单中处理发货。' : '此工单没有需要分配师傅的厂内任务，请在工单中处理外协、包装或发货。'] });
      continue;
    }
    const issues: string[] = [];
    if (order.status === 'CONFIRMED' && !['AUTO_CONFIRMED', 'ADMIN_CONFIRMED'].includes(order.pricingStatus)) issues.push('历史报价缺少完整核价依据，请先核对费用。');
    if (!['PENDING_FACTORY', 'SUBMITTED', 'CONFIRMED', 'RELEASED', 'FOILING', 'PACKING'].includes(order.status)) issues.push('当前状态不能安排生产，请返回工单处理。');
    if (await client.orderChangeRequest.count({ where: { orderId: id, status: 'PENDING' } })) issues.push('有待审批的工单修改，请先处理变更。');
    if (!order.simpleProduction && (await client.productionOperation.count({ where: { orderId: id, OR: [{ reports: { some: {} } }, { workOrderProgress: { some: {} } }, { carriedCompletedQty: { gt: 0 } }, { carriedWorkOrderProgressQty: { gt: 0 } }] } })
      || await client.productionProgressStep.count({ where: { orderId: id, OR: [{ reports: { some: {} } }, { carriedCompletedQty: { gt: 0 } }] } })
      || await client.productionTask.count({ where: { orderItem: { orderId: id }, OR: [{ status: { in: ['IN_PROGRESS', 'COMPLETED'] } }, { completedQty: { gt: 0 } }, { pieceworkAmount: { gt: 0 } }] } }))) issues.push('已有历史报工，请继续按原工序登记。');
    if (issues.length) {
      rows.push({ id, name: order.customName || order.orderNo, revision: order.revision, version: order.workOrderVersion, tasks: [], issues });
      continue;
    }
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
