'use client';

import { useEffect } from 'react';

/**
 * 回执已经由服务端渲染出来了，这里只负责把回执参数从地址栏清掉，
 * 让刷新 / 收藏 / 分享链接不会再次播报。
 *
 * 用原生 `history.replaceState` 而不是 `router.replace`：Next 会把它同步进
 * 路由的 canonical URL 与 `useSearchParams`，但不会再向服务端要一次 RSC；
 * 没有 JS 时回执照常显示，只是参数留在地址栏。
 *
 * state 必须传 `null`：Next 的 history 包装层看到带 `__NA` 的 state 会当成
 * 自己的内部调用而跳过 URL 同步，之后 `router.refresh()` / 下一次 Server
 * Action 会用旧的 `?created=1` 把回执带回来。传 `null` 时 Next 自己会把
 * `__NA` / 内部 tree 复制进去（`copyNextJsInternalHistoryState`）。
 */
export function ReceiptUrlCleanup({
  keys,
  renderId,
}: {
  keys: readonly string[];
  /**
   * 每次服务端渲染都不同。同一页连续两次带回执的操作（连续给两个人标记
   * 发放）时组件保持挂载、keys 不变，没有它 effect 不会重跑，第二张回执
   * 会留在地址栏。
   */
  renderId: string;
}) {
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
    if (changed) window.history.replaceState(null, '', url);
  }, [joined, renderId]);
  return null;
}
