'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const PRINT_RECORDED_CHANNEL = 'order-print-recorded';
let lastRefreshAt = 0;

/** 打印记录成功后通知同一浏览器里的其他标签页（打印页通常开在新标签页）。 */
export function announcePrintRecorded(orderIds: readonly string[]): void {
  try {
    const channel = new BroadcastChannel(PRINT_RECORDED_CHANNEL);
    channel.postMessage({ orderIds: [...orderIds] });
    channel.close();
  } catch {
    // 不支持时由「点过打印入口、回到本页时刷新」兜底。
  }
}

/**
 * 业主 2026-10-02：点「打印」即记已打印。打印在新标签页完成并记录后，本页刷新，待打印提示随之消失：
 * - 收到打印记录通知时刷新（本页在后台则等回到本页）；`orderId` 只关心这张工单，省略则任何工单。
 * - 返回的函数挂在打印入口的 onClick 上：点过打印入口，回到本页时也刷新一次（通知不可用时兜底）。
 * 同一页面多个入口共用，一秒内只刷新一次。
 */
export function useRefreshAfterPrint(orderId?: string): () => void {
  const router = useRouter();
  const armed = useRef(false);
  useEffect(() => {
    const refresh = () => {
      if (Date.now() - lastRefreshAt < 1000) return;
      lastRefreshAt = Date.now();
      router.refresh();
    };
    const onReturn = () => {
      if (!armed.current || document.visibilityState !== 'visible') return;
      armed.current = false;
      refresh();
    };
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(PRINT_RECORDED_CHANNEL);
      channel.onmessage = (event: MessageEvent<{ orderIds?: unknown }>) => {
        const ids = Array.isArray(event.data?.orderIds) ? event.data.orderIds : [];
        if (orderId && !ids.includes(orderId)) return;
        if (document.visibilityState === 'visible') refresh();
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
