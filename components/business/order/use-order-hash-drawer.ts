'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DRAWER_HISTORY_KEY = '__orderDrawer';

type OrderIdentity = { orderNo: string };

export type OrderHashDrawerState<T extends OrderIdentity> = {
  openOrderNo: string | null;
  openOrder: T | null;
  loading: boolean;
  error: string;
  showOrder: (orderNo: string) => void;
  retryOrder: () => void;
  closeOrder: () => void;
};

type DrawerRemoteResult<T> = {
  orderNo: string;
  order?: T;
  error?: string;
};

export function resolveOrderHashDrawerView<T extends OrderIdentity>({
  openOrderNo,
  pageOrder,
  remoteResult,
  alwaysFetchDetail,
}: {
  openOrderNo: string | null;
  pageOrder: T | null;
  remoteResult: DrawerRemoteResult<T> | null;
  alwaysFetchDetail: boolean;
}): { openOrder: T | null; loading: boolean; error: string } {
  const matchingRemoteResult =
    remoteResult?.orderNo === openOrderNo ? remoteResult : null;
  const error = matchingRemoteResult?.error ?? '';
  const loading = Boolean(
    openOrderNo &&
      !matchingRemoteResult &&
      (alwaysFetchDetail || !pageOrder),
  );
  const openOrder = error
    ? null
    : matchingRemoteResult?.order ?? (loading ? null : pageOrder);
  return { openOrder, loading, error };
}

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
  const [remoteResult, setRemoteResult] =
    useState<DrawerRemoteResult<T> | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const requestGenerationRef = useRef(0);
  const pageOrder = useMemo(
    () => pageOrders.find((order) => order.orderNo === openOrderNo) ?? null,
    [openOrderNo, pageOrders],
  );
  const { openOrder, loading, error } = resolveOrderHashDrawerView({
    openOrderNo,
    pageOrder,
    remoteResult,
    alwaysFetchDetail,
  });

  useEffect(() => {
    const syncFromLocation = () => {
      const nextOrderNo = orderNoFromHash(window.location.hash);
      requestGenerationRef.current += 1;
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
    const requestGeneration = ++requestGenerationRef.current;
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
        if (requestGenerationRef.current !== requestGeneration) return;
        setRemoteResult({ orderNo: openOrderNo, order: payload.order });
      })
      .catch((reason: unknown) => {
        if (
          controller.signal.aborted ||
          requestGenerationRef.current !== requestGeneration
        ) {
          return;
        }
        setRemoteResult({
          orderNo: openOrderNo,
          error: reason instanceof Error ? reason.message : fallbackError,
        });
      });
    return () => {
      if (requestGenerationRef.current === requestGeneration) {
        requestGenerationRef.current += 1;
      }
      controller.abort();
    };
  }, [
    alwaysFetchDetail,
    detailEndpoint,
    fallbackError,
    openOrderNo,
    pageOrder,
    retryVersion,
  ]);

  const showOrder = useCallback((orderNo: string) => {
    requestGenerationRef.current += 1;
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

  const retryOrder = useCallback(() => {
    if (!openOrderNo) return;
    requestGenerationRef.current += 1;
    setRemoteResult(null);
    setRetryVersion((current) => current + 1);
  }, [openOrderNo]);

  const closeOrder = useCallback(() => {
    requestGenerationRef.current += 1;
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
    loading,
    error,
    showOrder,
    retryOrder,
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
