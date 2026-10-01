import Decimal from 'decimal.js';

type CsvDecimal = Readonly<{ kind: 'csv-decimal'; value: string }>;
export type CsvCell = string | CsvDecimal | null | undefined;

/** Only validated decimal values may bypass spreadsheet formula protection. */
export function csvDecimal(value: Decimal.Value): CsvDecimal {
  const amount = new Decimal(value);
  if (!amount.isFinite()) throw new Error('CSV 金额不合法');
  return { kind: 'csv-decimal', value: amount.toFixed(2) };
}

export function csvDocument(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function csvCell(value: CsvCell): string {
  let text = typeof value === 'object' && value !== null ? value.value : value ?? '';
  if (typeof value === 'string' && (/^[\s\p{Cc}]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))) {
    text = "'" + text;
  }
  return '"' + text.replaceAll('"', '""') + '"';
}
