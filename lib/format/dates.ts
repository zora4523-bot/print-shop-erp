// 上海时区日期格式化 —— 全应用统一出口。
//
// 此前 14 个文件各自定义 formatDateShanghai / formatDateTimeShanghai /
// formatDateTime，其中 app/(admin)/orders/[id] 的一份用服务器本地时区
// （已知技术债：服务器时区 ≠ Asia/Shanghai 时显示漂移），本模块统一为
// Asia/Shanghai 口径。
//
// Intl.DateTimeFormat 构造成本高（ICU 初始化），这里用模块级缓存实例；
// 列表页在循环里逐行格式化时差异明显。
//
// null/undefined 统一返回占位符（默认 '—'，打印视图传 '-'），调用方
// 不必再各写一份判空。

const SHANGHAI_DATE = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const SHANGHAI_DATETIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const SHANGHAI_DATE_INPUT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY/MM/DD（Asia/Shanghai）。null/undefined → fallback。 */
export function formatDateShanghai(
  d: Date | null | undefined,
  fallback = '—',
): string {
  if (!d) return fallback;
  return SHANGHAI_DATE.format(d);
}

/** YYYY/MM/DD HH:mm（Asia/Shanghai）。null/undefined → fallback。 */
export function formatDateTimeShanghai(
  d: Date | null | undefined,
  fallback = '—',
): string {
  if (!d) return fallback;
  return SHANGHAI_DATETIME.format(d);
}

/** YYYY-MM-DD（Asia/Shanghai），用于 HTML date input。 */
export function formatDateInputShanghai(
  d: Date | null | undefined,
  fallback = '',
): string {
  if (!d) return fallback;
  return SHANGHAI_DATE_INPUT.format(d);
}
