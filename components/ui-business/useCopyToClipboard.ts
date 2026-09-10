'use client';

import { useCallback, useState } from 'react';

export type CopyFeedback = {
  tone: 'success' | 'error';
  message: string;
};

export type CopyOptions = {
  /** 复制多个值时的数量，播报「已复制 N 个X」。 */
  count?: number;
};

const VALUE_PREVIEW_LENGTH = 24;

/** 「已复制工单号 GD-2601…」 / 「已复制 2 个工单号」 / 失败给出可行动下一步（docs/ui-规范.md §5.9）。 */
export function copyFeedbackMessage(
  label: string,
  value: string,
  ok: boolean,
  count?: number,
): string {
  if (!ok) return `${label}复制失败，请手动选择复制或检查浏览器剪贴板权限`;
  if (count !== undefined && count > 1) return `已复制 ${count} 个${label}`;
  const preview =
    value.length > VALUE_PREVIEW_LENGTH
      ? `${value.slice(0, VALUE_PREVIEW_LENGTH)}…`
      : value;
  return `已复制${label} ${preview}`;
}

/**
 * 共享复制反馈。调用方只负责渲染 `feedback`（一个作用域只放一个
 * `role="status" aria-live="polite"`），文案与失败路径由这里统一。
 */
export function useCopyToClipboard() {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);

  const copy = useCallback(
    async (value: string, label: string, options: CopyOptions = {}) => {
      let ok = false;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(value);
        ok = true;
      } catch {
        ok = false;
      }
      setFeedback({
        tone: ok ? 'success' : 'error',
        message: copyFeedbackMessage(label, value, ok, options.count),
      });
      return ok;
    },
    [],
  );

  const reset = useCallback(() => setFeedback(null), []);

  return { feedback, copy, reset };
}
