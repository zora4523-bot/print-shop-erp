'use client';

import { useLinkStatus } from 'next/link';

/**
 * 点击 Link 后 0ms 的即时反馈（审查 #37）：pending 期间在被点项上叠一圈
 * 细描边，无动画、不占布局。不替代 300ms 后出现的加载图标（OrderQueuePending
 * 等），两者互补——描边告诉用户「点到了」，图标告诉用户「还在加载」。
 *
 * 必须放在 `<Link>` 内部（useLinkStatus 只读最近祖先 Link 的状态），且父级
 * Link 需要 `relative` 定位。
 */
export function LinkPendingHint() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden="true"
      data-link-pending="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-primary/60"
    />
  );
}
