const PARENTHESIZED_SOURCE_RANGE =
  /[ \t]*[\uff08(]\s*[A-Z]{1,3}\d+:[A-Z]{1,3}\d+\s*[)\uff09]/gi;
const PARENTHESIZED_SHEET_CELLS =
  /[ \t]*[\uff08(]\s*(?:'[^'\r\n]{1,64}'|[^()\uff08\uff09!\r\n]{1,64})!\s*\$?[A-Z]{1,3}\$?\d+(?:(?:\s*:\s*|\s*\/\s*)\$?[A-Z]{1,3}\$?\d+)*\s*[)\uff09]/giu;
const INLINE_SHEET_CELLS =
  /(^|[\s\uff0c,\u3002\uff1b;\uff1a:\u3001])(?:'[^'\r\n]{1,64}'|[\p{L}\p{N}_-]{1,64})!\s*\$?[A-Z]{1,3}\$?\d+(?:(?:\s*:\s*|\s*\/\s*)\$?[A-Z]{1,3}\$?\d+)*/giu;
const TRAILING_BARE_SOURCE_RANGE =
  /\s+[A-Z]{1,3}\d+:[A-Z]{1,3}\d+\s*$/i;

/** Remove imported workbook coordinates from business-facing text. */
export function externalPriceBusinessText(text: string): string {
  return text
    .replace(PARENTHESIZED_SHEET_CELLS, '')
    .replace(INLINE_SHEET_CELLS, '$1')
    .replace(PARENTHESIZED_SOURCE_RANGE, '')
    .replace(TRAILING_BARE_SOURCE_RANGE, '')
    .replace(/(\d+)\s*个锚点/g, '$1 个')
    .replace(/外部销售/g, '客户')
    .replace(/内部兼容/g, '内部直单')
    .replace(/(?:价格|计价|报价)快照/g, '已保存价格')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Convert a persisted external-price rule name into business-facing text. */
export function externalPriceRuleDisplayName(name: string): string {
  return externalPriceBusinessText(name) || '未命名收费项目';
}
