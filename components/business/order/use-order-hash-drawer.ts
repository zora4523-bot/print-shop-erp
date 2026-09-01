'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const DRAWER_HISTORY_KEY = '__orderDrawer';

type OrderIdentity = { orderNo: string };

export type OrderHashDrawerState<T extends OrderIdentity> = {
  openOrderNo: string | null;
  openOrder: T | null;
  loading: boolean;
  error: string;
  showOrder: (orderNo: string) => void;
  closeOrder: () => void;
};

export function useOrderHashDrawer<T extends OrderIdentity>({
  pageOrders,
  detailEndpoint,
  fallbackError = '工单明细加载失败',
  alwaysFetchDetail = false,
}: {
  pageOrders: readonly T[];
  detailEndpoint: (orderNo: string) => string;
  fallbackError?: string;
  alwaysFetchDetail?: boolean;
}): OrderHashDrawerState<T> {
  const [openOrderNo, setOpenOrderNo] = useState<string | null>(null);
  const [remoteResult, setRemoteResult] = useState<{
    orderNo: string;
    order?: T;
    error?: string;
  } | null>(null);
  const pageOrder = useMemo(
    () => pageOrders.find((order) => order.orderNo === openOrderNo) ?? null,
    [openOrderNo, pageOrders],
  );
  const remoteOrder =
    remoteResult?.orderNo === openOrderNo ? remoteResult.order ?? null : null;
  const error =
    remoteResult?.orderNo === openOrderNo ? remoteResult.error ?? '' : '';
  const openOrder = remoteOrder ?? pageOrder;

  useEffect(() => {
    const syncFromLocation = () => {
      const nextOrderNo = orderNoFromHash(window.location.hash);
      setRemoteResult((current) =>
        current?.orderNo === nextOrderNo ? current : null,
      );
      setOpenOrderNo(nextOrderNo);
    };
    syncFromLocation();
    window.addEventListener('hashchange', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      window.removeEventListener('hashchange', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, []);

  useEffect(() => {
    if (!openOrderNo || (pageOrder && !alwaysFetchDetail)) return;
    const controller = new AbortController();
    void fetch(detailEndpoint(openOrderNo), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          order?: T;
          error?: string;
        };
        if (!response.ok || !payload.order) {
          throw new Error(payload.error || fallbackError);
        }
        if (payload.order.orderNo !== openOrderNo) {
          throw new Error('工单明细响应与请求不匹配');
        }
        setRemoteResult({ orderNo: openOrderNo, order: payload.order });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setRemoteResult({
          orderNo: openOrderNo,
          error: reason instanceof Error ? reason.message : fallbackError,
        });
      });
    return () => controller.abort();
  }, [alwaysFetchDetail, detailEndpoint, fallbackError, openOrderNo, pageOrder]);

  const showOrder = useCallback((orderNo: string) => {
    const url = new URL(window.location.href);
    url.hash = `wo=${encodeURIComponent(orderNo)}`;
    window.history.pushState(
      drawerHistoryState(window.history.state, orderNo),
      '',
      url,
    );
    setRemoteResult(null);
    setOpenOrderNo(orderNo);
  }, []);

  const closeOrder = useCallback(() => {
    if (drawerEntryOrderNo(window.history.state) === openOrderNo) {
      setOpenOrderNo(null);
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(window.history.state, '', url);
    setOpenOrderNo(null);
  }, [openOrderNo]);

  return {
    openOrderNo,
    openOrder,
    loading: Boolean(openOrderNo && !openOrder && !error),
    error,
    showOrder,
    closeOrder,
  };
}

export function orderNoFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const orderNo = params.get('wo')?.trim() ?? '';
  if (!orderNo || orderNo.length > 128) return null;
  return orderNo;
}

function drawerHistoryState(current: unknown, orderNo: string) {
  const base =
    current && typeof current === 'object' && !Array.isArray(current)
      ? current
      : {};
  return { ...base, [DRAWER_HISTORY_KEY]: orderNo };
}

function drawerEntryOrderNo(state: unknown): string | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const orderNo = (state as Record<string, unknown>)[DRAWER_HISTORY_KEY];
  return typeof orderNo === 'string' ? orderNo : null;
}
