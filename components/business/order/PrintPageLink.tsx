'use client';

import type { ComponentProps } from 'react';
import { useRefreshAfterPrint } from './use-refresh-after-print';

/**
 * 打开工单浏览器打印页的统一入口（业主 2026-10-02 点打印即记已打印）：在新标签页打印并记录，
 * 记录后或回到本页时刷新本页的打印记录与待办。
 */
export function PrintPageLink({ orderId, onClick, ...props }: Omit<ComponentProps<'a'>, 'href' | 'target' | 'rel'> & { orderId: string }) {
  const armRefresh = useRefreshAfterPrint(orderId);
  return (
    <a
      {...props}
      href={`/print/orders/${encodeURIComponent(orderId)}?autoprint=1`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => { armRefresh(); onClick?.(event); }}
    />
  );
}
