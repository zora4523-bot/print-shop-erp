'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export const PENDING_BUNDLE_POLL_MS = 3_000;
export const PENDING_BUNDLE_POLL_TIMEOUT_MS = 120_000;

/**
 * 最近下载包里仍有 PENDING 时，每 3 秒刷新一次页面，直到这批包全部结束
 * （READY / FAILED 后签名变空，轮询自然停止）。同一批待生成包最多轮询
 * 120 秒；后台 worker 卡住时停下，避免整页无限重渲，用户可点「刷新进度」。
 */
export function PendingBundleRefresher({
  pendingSignature,
}: {
  pendingSignature: string;
}) {
  const router = useRouter();
  const [pausedSignature, setPausedSignature] = useState<string | null>(null);
  const active = pendingSignature !== '' && pausedSignature !== pendingSignature;

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), PENDING_BUNDLE_POLL_MS);
    const stop = window.setTimeout(() => {
      window.clearInterval(timer);
      setPausedSignature(pendingSignature);
    }, PENDING_BUNDLE_POLL_TIMEOUT_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [active, pendingSignature, router]);

  return null;
}
