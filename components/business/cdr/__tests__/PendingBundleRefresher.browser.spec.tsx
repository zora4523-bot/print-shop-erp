import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

import {
  PENDING_BUNDLE_POLL_MS,
  PENDING_BUNDLE_POLL_TIMEOUT_MS,
  PendingBundleRefresher,
} from '../PendingBundleRefresher';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function render(pendingSignature: string) {
  act(() => root.render(<PendingBundleRefresher pendingSignature={pendingSignature} />));
}

it('刷新到待生成的下载包结束为止，结束后不再整页重渲', () => {
  render('bundle-1');
  act(() => vi.advanceTimersByTime(PENDING_BUNDLE_POLL_MS * 2));
  expect(refresh).toHaveBeenCalledTimes(2);

  // 后台任务完成：刷新带回的最近列表里已没有 PENDING。
  render('');
  act(() => vi.advanceTimersByTime(PENDING_BUNDLE_POLL_MS * 5));
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('没有待生成的下载包时从不轮询', () => {
  render('');
  act(() => vi.advanceTimersByTime(PENDING_BUNDLE_POLL_TIMEOUT_MS));
  expect(refresh).not.toHaveBeenCalled();
});

it('同一批待生成包最多轮询 120 秒，新一批重新开始', () => {
  render('bundle-1');
  act(() => vi.advanceTimersByTime(PENDING_BUNDLE_POLL_TIMEOUT_MS + PENDING_BUNDLE_POLL_MS * 5));
  const capped = refresh.mock.calls.length;
  expect(capped).toBe(PENDING_BUNDLE_POLL_TIMEOUT_MS / PENDING_BUNDLE_POLL_MS);

  render('bundle-1');
  act(() => vi.advanceTimersByTime(PENDING_BUNDLE_POLL_MS * 3));
  expect(refresh).toHaveBeenCalledTimes(capped);

  render('bundle-1,bundle-2');
  act(() => vi.advanceTimersByTime(PENDING_BUNDLE_POLL_MS));
  expect(refresh).toHaveBeenCalledTimes(capped + 1);
});
