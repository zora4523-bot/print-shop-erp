'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LinkPendingHint } from './LinkPendingHint';

/**
 * GET 筛选表单的「清除筛选」。筛选表单走 next/form 软导航，字段是非受控的
 * （defaultValue）；表单 key 只随已应用的查询值变化。若清除前后已应用值相同
 * （例如填了日期但还没提交），key 不变、表单不重建，未提交的输入会残留并在下次
 * 提交时生效。这里在导航真正发生时 reset 目标表单：字段回到 defaultValue（当前
 * 已应用值），随后的导航再清空已应用值。
 *
 * 重置放在 `onNavigate` 而不是 `onClick`：Cmd/Ctrl/中键在新标签打开时当前页不
 * 导航，不应丢弃当前页的输入（Codex 2026-09-29）。
 */
export function FilterClearLink({
  href,
  formId,
  className,
  scroll = false,
  pendingHint = true,
  children = '清除筛选',
}: {
  href: string;
  /** 要重置的筛选 `<form>` / `<Form>` 的 id。 */
  formId: string;
  className?: string;
  scroll?: boolean;
  pendingHint?: boolean;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      scroll={scroll}
      onNavigate={() => {
        const form = document.getElementById(formId);
        if (form instanceof HTMLFormElement) form.reset();
      }}
      className={cn(className, pendingHint && 'relative')}
    >
      {children}
      {pendingHint ? <LinkPendingHint /> : null}
    </Link>
  );
}
