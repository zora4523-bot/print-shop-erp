import { db } from '@/lib/db';

/**
 * 师傅端「生产登记」详情：只读本人名下的生产任务及本人提成。
 * 从 components/business/production/WorkerCompletionDetail 迁出（components 不得直连数据库）。
 */
export function getWorkerCompletionJob(id: string, workerId: string) {
  return db.productionJob.findFirst({
    where: { id, workerId },
    include: {
      order: { select: { id: true, orderNo: true, customName: true, workOrderVersion: true, remark: true } },
      wages: { where: { workerId } },
    },
  });
}
