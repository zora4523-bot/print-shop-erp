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
import { billAdjustmentKind, billOrderStatus } from './presentation';
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
  const cells: CsvCell[][] = [['账期', '状态', '金额口径', '工单数', '工单合计（元）', '抵扣 / 补收（元）', '账单金额（元）', '确认时间', '结清时间']];
  for (const bill of rows) cells.push([
    bill.period, SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].label,
    amountBasisLabel(bill.status), String(bill._count.items),
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
  const statusLabel = SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].label;
  const basis = amountBasisLabel(bill.status);
  const cells: CsvCell[][] = [['行类型', '账期', '账单状态', '金额口径', '工单号', '工单名称', '名称依据', '结算时状态', '纸单版本', '结算时间', '工单金额（元）', '加工费（元）', '其他费用明细']];
  for (const item of items) {
    const name = billItemName(item);
    const evidence = readBillSettlementDetail(item.settlementDetailSnapshot, item.settledFeeSnapshot);
    cells.push([
      '工单', bill.period, statusLabel, basis,
      item.orderNoSnapshot, name.name, name.current ? '当前名称' : '结算时名称', billOrderStatus(item.orderStatusSnapshot).label,
      String(item.workOrderVersionSnapshot), formatDateTimeShanghai(item.settledAtSnapshot), csvDecimal(item.settledFeeSnapshot),
      evidence ? csvDecimal(evidence.processingAmount) : null,
      evidence ? evidence.charges.map((charge) => `${charge.description}：${charge.amount} 元`).join('；') || '无其他费用' : '费用明细待补',
    ]);
  }
  const summaryRow = (kind: string, label: string, amount: CsvCell, note: string | null = null): CsvCell[] =>
    [kind, bill.period, statusLabel, basis, null, label, note, null, null, null, amount, null, null];
  if (parsed.data) {
    // 抵扣 / 补收与账单合计是整张账单的口径，不能冒充筛选结果之和。
    cells.push(summaryRow('说明', '筛选结果，非全账单', null, '抵扣 / 补收与账单合计请清除筛选后导出完整账单明细'));
  } else {
    for (const adjustment of bill.adjustments) {
      const source = adjustment.credit.sourceItem;
      const kind = billAdjustmentKind(adjustment.amount);
      cells.push([
        kind, bill.period, statusLabel, basis, source.orderNoSnapshot, kind, `来源：${source.bill.period} 货款账单`,
        null, null, null, csvDecimal(adjustment.amount), null, null,
      ]);
    }
    // 合计直接取账单冻结值，不在导出端重算。
    cells.push(summaryRow('合计', '工单合计', csvDecimal(bill.memberSubtotal)));
    cells.push(summaryRow('合计', '抵扣 / 补收', csvDecimal(bill.adjustmentAmount)));
    cells.push(summaryRow('合计', '账单金额', csvDecimal(bill.totalAmount)));
  }
  return { csv: csvDocument(cells), fileName: `my-bill-${bill.period}${parsed.data ? '-filtered' : ''}.csv` };
}

function amountBasisLabel(status: AgentMonthlyBillStatus): string {
  switch (status) {
    case AgentMonthlyBillStatus.DRAFT: return '暂计，金额未定稿';
    case AgentMonthlyBillStatus.CONFIRMED: return '已确认应付';
    case AgentMonthlyBillStatus.PAID: return '已结清';
    default: {
      const unreachable: never = status;
      throw new Error(`未知账单状态：${String(unreachable)}`);
    }
  }
}

function assertRowLimit(count: number) {
  if (count > EXPORT_ROW_LIMIT) throw new SalesBillExportInputError('导出结果超过 10,000 条，请缩小筛选范围后重试。');
}
