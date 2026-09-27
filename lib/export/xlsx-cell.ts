import { xlsxColumnName } from './xlsx-column';
import { escapeXmlText } from './xml-text';

export type XlsxCellValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

export function xlsxCellXml(
  value: XlsxCellValue,
  row: number,
  column: number,
): string {
  const ref = `${xlsxColumnName(column)}${row}`;
  if (value === null || value === undefined) return `<c r="${ref}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="2"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(text)}</t></is></c>`;
}
