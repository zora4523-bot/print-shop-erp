import Decimal from 'decimal.js';

// 金额展示的唯一入口。
//
// 为什么要有这个文件：此前 40 多处直接用 `String(decimalValue)` 渲染金额，
// 而 Prisma 的 Decimal 转字符串**不保留尾随零**——数据库里的 5000.00 会
// 渲染成 "5000"，5000.50 渲染成 "5000.5"。这些列多数是 `text-right
// tabular-nums`，等宽数字右对齐的前提是小数位数一致，于是同一列里
// 「5000」「5000.5」「4999.99」的小数点全都对不齐，老板扫账时很容易看错
// 数量级。同一个页面里还常和 `toFixed(2)` 混用，两种写法紧挨着出现。
//
// 口径（与 lib/format/unit-price.ts 的 formatUnitPrice 保持同族）：
//   - 一律 2 位小数（金额是 Decimal(12,2)，单价才是 4 位，那个走 unit-price）
//   - 千分位分组
//   - 货币符号紧贴数字，中文排版惯例不加空格（此前全仓 100 处带空格 /
//     71 处不带，7 个文件内部自相矛盾）
//   - 全程走 decimal.js，不经过 IEEE-754

export type MoneyInput = Decimal.Value | null | undefined;

function group(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `¥1,234.50`。null/undefined/非法值返回 placeholder（默认 `—`）。 */
export function formatMoney(
  value: MoneyInput,
  options?: { placeholder?: string; withSymbol?: boolean },
): string {
  const placeholder = options?.placeholder ?? '—';
  if (value === null || value === undefined || value === '') return placeholder;

  let fixed: string;
  try {
    fixed = new Decimal(value).toFixed(2);
  } catch {
    return placeholder;
  }

  const negative = fixed.startsWith('-');
  const [integer = '0', fraction = '00'] = (
    negative ? fixed.slice(1) : fixed
  ).split('.');
  const body = `${negative ? '-' : ''}${group(integer)}.${fraction}`;
  return options?.withSymbol === false ? body : `¥${body}`;
}

/** 不带货币符号的金额数字，用于已经在表头/单位列标了「元」的场景。 */
export function formatMoneyAmount(
  value: MoneyInput,
  options?: { placeholder?: string },
): string {
  return formatMoney(value, {
    placeholder: options?.placeholder,
    withSymbol: false,
  });
}
