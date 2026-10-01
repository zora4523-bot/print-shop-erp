'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const PRINT_RECORDED_CHANNEL = 'order-print-recorded';
// 每个页面一个标识：本页自己发出的通知不再触发本页刷新（本页已直接刷新）。
const PAGE_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
const REFRESH_INTERVAL_MS = 1000;
let lastRefreshAt = 0;
let trailingRefresh: ReturnType<typeof setTimeout> | null = null;

type Refresher = { refresh: () => void };

/**
 * 页面级刷新协调：一秒内的多次请求合并；落在间隔内的请求不丢，安排一次尾随刷新——例如回到本页
 * 时先刷新了一次（记录尚未完成），随后到达的「已记录」通知仍会再刷新一次拿到新状态。
 */
export function refreshPageAfterPrint(router: Refresher): void {
  const wait = lastRefreshAt + REFRESH_INTERVAL_MS - Date.now();
  if (wait <= 0) {
    lastRefreshAt = Date.now();
    router.refresh();
    return;
  }
  if (trailingRefresh) return;
  trailingRefresh = setTimeout(() => {
    trailingRefresh = null;
    lastRefreshAt = Date.now();
    router.refresh();
  }, wait);
}

/** 打印记录成功后通知同一浏览器里的其他标签页（打印页通常开在新标签页）。 */
export function announcePrintRecorded(orderIds: readonly string[]): void {
  try {
    const channel = new BroadcastChannel(PRINT_RECORDED_CHANNEL);
    channel.postMessage({ orderIds: [...orderIds], source: PAGE_ID });
    channel.close();
  } catch {
    // 不支持时由「点过打印入口、回到本页时刷新」兜底。
  }
}

/**
 * 业主 2026-10-02：点「打印」即记已打印。打印在新标签页完成并记录后，本页刷新，待打印提示随之消失：
 * - 收到其他标签页的打印记录通知时刷新（本页在后台则等回到本页）；`orderId` 只关心这张工单，省略则任何工单。
 * - 返回的函数挂在打印入口的 onClick 上：点过打印入口，回到本页时也刷新（通知不可用时兜底）。
 */
export function useRefreshAfterPrint(orderId?: string): () => void {
  const router = useRouter();
  const armed = useRef(false);
  useEffect(() => {
    const onReturn = () => {
      if (!armed.current || document.visibilityState !== 'visible') return;
      armed.current = false;
      refreshPageAfterPrint(router);
    };
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(PRINT_RECORDED_CHANNEL);
      channel.onmessage = (event: MessageEvent<{ orderIds?: unknown; source?: unknown }>) => {
        if (event.data?.source === PAGE_ID) return;
        const ids = Array.isArray(event.data?.orderIds) ? event.data.orderIds : [];
        if (orderId && !ids.includes(orderId)) return;
        if (document.visibilityState === 'visible') refreshPageAfterPrint(router);
        else armed.current = true;
      };
    } catch {
      channel = null;
    }
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      channel?.close();
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [router, orderId]);
  return useCallback(() => { armed.current = true; }, []);
}
