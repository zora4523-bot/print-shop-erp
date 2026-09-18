import type { ReactNode } from 'react';
import { RECEIPT_KEYS, type Receipt, type ReceiptKey } from '@/lib/admin/receipt';
import { cn } from '@/lib/utils';
import { ActionNotice, type ActionNoticeTone } from './ActionNotice';
import { ReceiptUrlCleanup } from './ReceiptUrlCleanup';

export type ReceiptMessage = {
  tone?: ActionNoticeTone;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
};

/** 返回 null 表示该 key 不单独播报（如 markedPaid 只是 marked 的附属值）。 */
export type ReceiptMessageResolver = (
  value: string,
  receipt: Receipt,
) => ReceiptMessage | null;

export type ReceiptNoticeProps = {
  /** `readReceipt(searchParams)` 的结果 */
  receipt: Receipt;
  /** 业务名词：created → 「<noun>已创建」，updated → 「<noun>已保存」 */
  noun?: string;
  /** 逐 key 覆盖文案；没有默认文案的 key（issued / locked / paid …）必须在这里给 */
  messages?: Partial<Record<ReceiptKey, ReceiptMessageResolver>>;
  className?: string;
};

function defaultMessage(
  key: ReceiptKey,
  value: string,
  noun: string | undefined,
): ReceiptMessage | null {
  const subject = noun ?? (value === '1' ? '' : value);
  switch (key) {
    case 'created':
      return { title: `${subject}已创建` };
    case 'updated':
      return { title: `${subject}已保存` };
    default:
      return null;
  }
}

/**
 * 跳转后的页面级回执：Server Action 成功 → redirect → 目标页顶部用
 * `ActionNotice` 播报。服务端渲染、零 JS 可见；挂载后清掉地址栏里的回执参数。
 * 配合 `lib/admin/receipt.ts` 的 `appendReceipt` / `readReceipt` 使用。
 */
export function ReceiptNotice({
  receipt,
  noun,
  messages,
  className,
}: ReceiptNoticeProps) {
  const presentKeys = RECEIPT_KEYS.filter((key) => receipt[key] !== undefined);
  const notices = presentKeys.flatMap((key) => {
    const value = receipt[key];
    if (value === undefined) return [];
    const resolve = messages?.[key];
    const message = resolve
      ? resolve(value, receipt)
      : defaultMessage(key, value, noun);
    return message ? [{ key, message }] : [];
  });
  if (notices.length === 0) return null;

  return (
    <div data-slot="receipt-notice" className={cn('space-y-3', className)}>
      {notices.map(({ key, message }) => (
        <ActionNotice
          key={key}
          tone={message.tone ?? 'success'}
          title={message.title}
          description={message.description}
          action={message.action}
        />
      ))}
      <ReceiptUrlCleanup keys={presentKeys} />
    </div>
  );
}
