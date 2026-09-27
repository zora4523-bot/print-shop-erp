import { ProductionReportEntryType } from '../../generated/prisma/enums';
import { db } from '../db';

/**
 * 报工页默认批次号：本人在该工序 / 无计件进度步骤上已落库的报工条数。
 *
 * 页面把它固定进地址栏（`?reportBatch=N`），所以刷新同一地址仍沿用同一批次、重提被去重；
 * 报成功后重新扫码、从列表进入或点“再报一批”，条数已加一，得到新的批次，同量的第二批照常入账。
 * 按推导批次写入的报工，写入后条数必然大于该批次号，所以之后推导出的批次不会与已入账的批次相撞。
 */
export async function defaultReportBatch(
  kind: 'operation' | 'progress',
  targetId: string,
  reporterId: string,
): Promise<number> {
  return kind === 'operation'
    ? db.productionReport.count({
        where: { operationId: targetId, reporterId, entryType: ProductionReportEntryType.REPORT },
      })
    : db.productionProgressReport.count({ where: { progressStepId: targetId, reporterId } });
}
