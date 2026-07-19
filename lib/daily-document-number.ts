import { db } from './db';

export type DailyDocumentKind =
  | 'PURCHASE_ORDER'
  | 'PURCHASE_RECEIPT'
  | 'STOCK_TRANSFER'
  | 'INVENTORY_COUNT';

type DocumentNumberSpec = {
  prefix: string;
  width: number;
  max: number;
  label: string;
};

const DOCUMENT_NUMBER_SPECS: Record<DailyDocumentKind, DocumentNumberSpec> = {
  PURCHASE_ORDER: { prefix: 'PO', width: 4, max: 9_999, label: '采购单' },
  PURCHASE_RECEIPT: { prefix: 'PR', width: 4, max: 9_999, label: '收货单' },
  STOCK_TRANSFER: { prefix: 'ST', width: 4, max: 9_999, label: '调拨单' },
  INVENTORY_COUNT: { prefix: 'IC', width: 4, max: 9_999, label: '盘点单' },
};

const BUSINESS_TIMEZONE = 'Asia/Shanghai';
const DATE_PREFIX_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export class DailyDocumentNumberExhaustedError extends Error {
  constructor(kind: DailyDocumentKind, businessDate: string) {
    const spec = DOCUMENT_NUMBER_SPECS[kind];
    super(`${businessDate} 当日${spec.label}号已达上限 ${spec.max} 条`);
    this.name = 'DailyDocumentNumberExhaustedError';
  }
}

export function formatBusinessDateKey(date: Date): string {
  const parts = DATE_PREFIX_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error(`无法生成上海业务日期：${date.toISOString()}`);
  }
  return `${year}${month}${day}`;
}

export async function nextDailyDocumentNumber(
  kind: DailyDocumentKind,
  date: Date = new Date(),
): Promise<string> {
  const spec = DOCUMENT_NUMBER_SPECS[kind];
  const businessDate = formatBusinessDateKey(date);
  const sequenceKey = `${kind}:${businessDate}`;
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "DailyDocumentSequence" ("key", "value", "updatedAt")
    VALUES (${sequenceKey}, 1, NOW())
    ON CONFLICT ("key") DO UPDATE
       SET "value" = "DailyDocumentSequence"."value" + 1,
           "updatedAt" = NOW()
     WHERE "DailyDocumentSequence"."value" < ${spec.max}
    RETURNING "value"
  `;

  const value = rows[0]?.value;
  if (value === undefined) {
    throw new DailyDocumentNumberExhaustedError(kind, businessDate);
  }
  return `${spec.prefix}${businessDate}-${String(value).padStart(spec.width, '0')}`;
}
