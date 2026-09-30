import 'server-only';
import { z } from 'zod';
import { AgentMonthlyBillStatus, Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { csvDecimal, csvDocument, type CsvCell } from '@/lib/export/csv';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { isAgentBillPeriod } from './period';
import { agentBillWhere } from './list-filter';
import { billItemName, filterBillItems } from './item-list';
import { getSalesMonthlyBill } from './sales-query';
import { billOrderStatus } from './presentation';
import { readBillSettlementDetail } from './settlement-detail';

type Actor = { id: string; role: Role };
const filtersSchema = z.object({
  period: z.string().refine(isAgentBillPeriod).optional(),
  status: z.enum(AgentMonthlyBillStatus).optional(),
});
const searchSchema = z.string().trim().max(100);
const EXPORT_ROW_LIMIT = 10_000;

export class SalesBillExportInputError extends Error {}
export class SalesBillExportNotFoundError extends Error {}

function salesScope(actor: Actor) {
  if (actor.role !== Role.SALES) throw new SalesBillExportNotFoundError();
  return { agentUserId: actor.id };
}

export async function exportSalesBillList(actor: Actor, params: URLSearchParams) {
  const scope = salesScope(actor);
  const parsed = filtersSchema.safeParse({
    period: params.get('period') || undefined,
    status: params.get('status') || undefined,
  });
  if (!parsed.success) throw new SalesBillExportInputError('账期或状态不合法，请重新筛选后导出。');
  const rows = await db.agentMonthlyBill.findMany({
    where: { ...agentBillWhere(parsed.data), ...scope },
    select: {
      period: true, status: true, memberSubtotal: true, adjustmentAmount: true,
      totalAmount: true, confirmedAt: true, paidAt: true, _count: { select: { items: true } },
    },
    orderBy: [{ period: 'desc' }, { id: 'desc' }],
    take: EXPORT_ROW_LIMIT + 1,
  });
  assertRowLimit(rows.length);
  const cells: CsvCell[][] = [['账期', '状态', '金额口径', '工单数', '工单合计（元）', '抵扣金额（元）', '账单金额（元）', '确认时间', '结清时间']];
  for (const bill of rows) cells.push([
    bill.period, SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].label,
    bill.status === 'DRAFT' ? '暂计，金额未定稿' : '已确认应付', String(bill._count.items),
    csvDecimal(bill.memberSubtotal), csvDecimal(bill.adjustmentAmount), csvDecimal(bill.totalAmount),
    formatDateTimeShanghai(bill.confirmedAt, ''), formatDateTimeShanghai(bill.paidAt, ''),
  ]);
  return { csv: csvDocument(cells), fileName: `my-bills-${parsed.data.period ?? 'all'}.csv` };
}

export async function exportSalesBillItems(actor: Actor, id: string, params: URLSearchParams) {
  salesScope(actor);
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new SalesBillExportNotFoundError();
  const parsed = searchSchema.safeParse(params.get('q') ?? '');
  if (!parsed.success) throw new SalesBillExportInputError('搜索内容过长，请缩短后重新导出。');
  const bill = await getSalesMonthlyBill(actor, id);
  if (!bill) throw new SalesBillExportNotFoundError();
  const items = filterBillItems(bill.items, parsed.data);
  assertRowLimit(items.length);
  const cells: CsvCell[][] = [['账期', '账单状态', '金额口径', '工单号', '工单名称', '名称依据', '结算时状态', '纸单版本', '结算时间', '结算金额（元）', '加工费（元）', '其他费用明细']];
  for (const item of items) {
    const name = billItemName(item);
    const evidence = readBillSettlementDetail(item.settlementDetailSnapshot, item.settledFeeSnapshot);
    cells.push([
      bill.period, SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].label,
      bill.status === 'DRAFT' ? '暂计，金额未定稿' : '已确认应付',
      item.orderNoSnapshot, name.name, name.current ? '当前名称' : '结算时名称', billOrderStatus(item.orderStatusSnapshot).label,
      String(item.workOrderVersionSnapshot), formatDateTimeShanghai(item.settledAtSnapshot), csvDecimal(item.settledFeeSnapshot),
      evidence ? csvDecimal(evidence.processingAmount) : null,
      evidence ? evidence.charges.map((charge) => `${charge.description}：${charge.amount} 元`).join('；') || '无其他费用' : '费用明细待补',
    ]);
  }
  return { csv: csvDocument(cells), fileName: `my-bill-${bill.period}${parsed.data ? '-filtered' : ''}.csv` };
}

function assertRowLimit(count: number) {
  if (count > EXPORT_ROW_LIMIT) throw new SalesBillExportInputError('导出结果超过 10,000 条，请缩小筛选范围后重试。');
}
