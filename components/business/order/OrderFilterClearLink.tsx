'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { LinkPendingHint } from '@/components/ui-business';
import { cn } from '@/lib/utils';

/** 工单工作台筛选表单的 id，供表单外的「清除筛选」（列表空态）定位。 */
export const ORDER_FILTER_FORM_ID = 'admin-order-filters';

/**
 * 工单工作台「清除筛选」。筛选表单的 key 只跟已应用的可见筛选值走（见
 * `appliedFilterFormKey`），切队列时保留未应用输入；但已应用值本就为空时，
 * 清除后 key 不变、表单不重建，未提交的输入会残留并在下次提交时生效。
 * 点击时显式 reset 筛选表单：字段回到 defaultValue（即当前已应用值），
 * 随后的软导航再把已应用值清空。队列切换不经过这里，语义不变。
 */
export function OrderFilterClearLink({
  href,
  className,
  scroll = false,
  pendingHint = true,
  children = '清除筛选',
}: {
  href: string;
  className: string;
  scroll?: boolean;
  pendingHint?: boolean;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      scroll={scroll}
      onClick={() => {
        const form = document.getElementById(ORDER_FILTER_FORM_ID);
        if (form instanceof HTMLFormElement) form.reset();
      }}
      className={cn(className, pendingHint && 'relative')}
    >
      {children}
      {pendingHint ? <LinkPendingHint /> : null}
    </Link>
  );
}
