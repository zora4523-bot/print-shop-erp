'use client';

import type { ReactNode } from 'react';
import { FilterClearLink } from '@/components/ui-business';

/** 工单工作台筛选表单的 id，供表单外的「清除筛选」（列表空态）定位。 */
export const ORDER_FILTER_FORM_ID = 'admin-order-filters';

/**
 * 工单工作台「清除筛选」：筛选表单的 key 只跟已应用的可见筛选值走（见
 * `appliedFilterFormKey`），切队列时保留未应用输入；清除时由 FilterClearLink
 * 在导航发生时 reset 该表单。队列切换不经过这里，语义不变。
 */
export function OrderFilterClearLink(props: {
  href: string;
  className: string;
  scroll?: boolean;
  pendingHint?: boolean;
  children?: ReactNode;
}) {
  return <FilterClearLink {...props} formId={ORDER_FILTER_FORM_ID} />;
}
