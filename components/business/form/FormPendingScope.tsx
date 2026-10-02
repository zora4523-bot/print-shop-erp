'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { PageHeader, type PageHeaderProps } from '@/components/ui-business';
import { BreadcrumbParent } from '@/components/business/admin/breadcrumb-entity';

// 「页头 + 表单」分处服务端页面的不同位置时，用这个作用域把表单的
// useActionState pending 传给返回入口：提交中锁住顶栏面包屑父级（二级页唯一的
// 返回入口）以及仍保留的页头返回（如「返回原录入」），避免中途离开丢失回执
// （ui-规范 §8.3）。SSR / 零 JS 下 pending 恒为 false，不影响原生提交。

type Scope = { pending: boolean; setPending: (pending: boolean) => void };

const FormPendingContext = createContext<Scope | null>(null);

export function FormPendingScope({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(false);
  return (
    <FormPendingContext.Provider value={{ pending, setPending }}>
      <BreadcrumbParent pending={pending} />
      {children}
    </FormPendingContext.Provider>
  );
}

/** 表单内调用：把 pending 上报给最近的 FormPendingScope；没有作用域时是空操作。 */
export function useReportFormPending(pending: boolean) {
  const setPending = useContext(FormPendingContext)?.setPending;
  useEffect(() => {
    if (!setPending) return;
    setPending(pending);
    return () => setPending(false);
  }, [pending, setPending]);
}

/** PageHeader 的作用域版本：back 自动带上当前表单的 pending。 */
export function ScopedPageHeader(props: PageHeaderProps) {
  const pending = useContext(FormPendingContext)?.pending ?? false;
  return (
    <PageHeader
      {...props}
      back={props.back ? { ...props.back, pending } : undefined}
    />
  );
}
