/**
 * 跳转后回执（redirect receipt）。
 *
 * Server Action 成功后 `redirect()` 到目标页时，`useActionState` 的状态随旧页面
 * 一起丢掉，目标页什么都不知道。这里把结果放进目标页的 query：action 用
 * `appendReceipt` 拼路径，目标页用 `readReceipt` 读出并交给
 * `components/ui-business/ReceiptNotice` 渲染 `ActionNotice`。
 *
 * 这是 docs/ui-规范.md §5.4「反馈就地、页内、可见」在 redirect 路径上的落地：
 * 服务端渲染、零 JS 也能看到；客户端挂载后 `ReceiptUrlCleanup` 再把回执参数
 * 从地址栏清掉，刷新 / 收藏 / 分享链接不会重复播报。
 *
 * key 是固定字典，页面按 key 决定文案。新增回执类型先在这里登记，不要各页自造。
 */
export const RECEIPT_KEYS = [
  /** 新建成功；值通常是 '1'，列表页可用它区分对象（如 'channel' / 'rule'） */
  'created',
  /** 编辑保存成功；值同上 */
  'updated',
  /** 账单已出账 */
  'issued',
  /** 计件结算已锁定：值是报工人姓名 */
  'locked',
  /** 当日计件批量锁定：值是新锁定人数 */
  'lockedCount',
  /** 计件工资已标记发放：值是报工人姓名 */
  'paid',
  /** 时薪月结发放标记已变更：值是师傅姓名 */
  'marked',
  /** 与 marked 配对：'1' 标记为已发放，'0' 撤销 */
  'markedPaid',
] as const;

export type ReceiptKey = (typeof RECEIPT_KEYS)[number];
export type Receipt = Partial<Record<ReceiptKey, string>>;

type SearchParamValue = string | string[] | undefined;

/** 把回执写进路径的 query（保留已有查询串和 hash；同名 key 覆盖）。 */
export function appendReceipt(path: string, receipt: Receipt): string {
  const hashIndex = path.indexOf('#');
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const beforeHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const [pathname, rawQuery = ''] = beforeHash.split('?', 2);
  const query = new URLSearchParams(rawQuery);
  for (const key of RECEIPT_KEYS) {
    const value = receipt[key];
    if (value !== undefined) query.set(key, value);
  }
  const search = query.toString();
  return `${pathname}${search ? `?${search}` : ''}${hash}`;
}

/** 从页面 `searchParams` 里只取字典内的 key；数组取第一个，空白视为不存在。 */
export function readReceipt(
  searchParams: Record<string, SearchParamValue> | null | undefined,
): Receipt {
  const receipt: Receipt = {};
  if (!searchParams) return receipt;
  for (const key of RECEIPT_KEYS) {
    const raw = searchParams[key];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) receipt[key] = value;
  }
  return receipt;
}

export function hasReceipt(receipt: Receipt): boolean {
  return RECEIPT_KEYS.some((key) => receipt[key] !== undefined);
}

/**
 * 表单里的 `returnTo` 只允许回到 `base` 本身、它的子路径或带查询串 / hash 的
 * 同一路径；其余（外站、协议相对、前缀相似的别的路由）一律回退到 `base`，
 * 防止开放重定向。
 */
export function safeReturnTo(
  value: FormDataEntryValue | null | undefined,
  base: string,
): string {
  if (typeof value !== 'string' || !value.startsWith(base)) return base;
  const next = value.charAt(base.length);
  return next === '' || next === '?' || next === '/' || next === '#'
    ? value
    : base;
}
