'use client';

import { useEffect } from 'react';

/**
 * 回执已经由服务端渲染出来了，这里只负责把回执参数从地址栏清掉，
 * 让刷新 / 收藏 / 分享链接不会再次播报。
 *
 * 用原生 `history.replaceState` 而不是 `router.replace`：Next 会把它同步进
 * `useSearchParams`，但不会再向服务端要一次 RSC；没有 JS 时回执照常显示，
 * 只是参数留在地址栏。与 `OrderListNavigationState` 的写法一致。
 */
export function ReceiptUrlCleanup({ keys }: { keys: readonly string[] }) {
  const joined = keys.join(',');
  useEffect(() => {
    if (!joined) return;
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of joined.split(',')) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(window.history.state, '', url);
  }, [joined]);
  return null;
}
