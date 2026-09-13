import Decimal from 'decimal.js';
import { formatMoney } from '@/lib/dashboard/format';
import { formatOrderLogChanges, type LogChangeRow } from './log-format';

const MONEY_LABELS: Record<string, string> = {
  totalAmount: '对客应收总额', confirmedFee: '确认金额', quotedFee: '提交报价', settledFee: '结算金额',
};
const INTERNAL_FIELDS = new Set(['quotedPricingRevisionId']);
const PRIMARY_FIELDS = new Set(['status', 'confirmedFee', 'totalAmount', 'shipmentStatus']);

function decimal(value: unknown): Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try { const amount = new Decimal(value); return amount.isFinite() ? amount : null; } catch { return null; }
}

export function presentActivityChanges(raw: unknown): {
  primary: LogChangeRow[]; details: LogChangeRow[]; unavailable: boolean;
} {
  const primary: LogChangeRow[] = [];
  const details: LogChangeRow[] = [];
  let unavailable = false;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { primary, details, unavailable: raw != null };
  for (const row of formatOrderLogChanges(raw)) {
    if (INTERNAL_FIELDS.has(row.field)) continue;
    const entry = (raw as Record<string, { before?: unknown; after?: unknown }>)[row.field];
    if (!entry) continue;
    const moneyLabel = Object.hasOwn(MONEY_LABELS, row.field) ? MONEY_LABELS[row.field] : undefined;
    if (moneyLabel) {
      const before = decimal(entry.before);
      const after = decimal(entry.after);
      if (before && after && before.eq(after)) continue;
      if ((entry.before != null && !before) || (entry.after != null && !after)) { unavailable = true; continue; }
      if (entry.before === entry.after) continue;
      row.label = moneyLabel;
      row.before = before ? formatMoney(before) : '未记录';
      row.after = after ? formatMoney(after) : '已清空';
    } else {
      if (row.label === '其他变更' || row.before === '未识别变更内容' || row.after === '未识别变更内容') { unavailable = true; continue; }
      // Only exact raw scalar equality can suppress non-money changes.
      if (entry.before === entry.after && (entry.before == null || typeof entry.before !== 'object')) continue;
      if (row.before === '—') row.before = '未记录';
      if (row.after === '—') row.after = '已清空';
    }
    (PRIMARY_FIELDS.has(row.field) ? primary : details).push(row);
  }
  return { primary, details, unavailable };
}

export type OrderActivityEvent = {
  id: string; at: string; date: string; time: string; title: string; actor: string;
  remark: string | null; changes: ReturnType<typeof presentActivityChanges>;
};
export type ActivityCursor = { at: string; id: string };
export type OrderActivityPage = { events: OrderActivityEvent[]; nextCursor: ActivityCursor | null };
