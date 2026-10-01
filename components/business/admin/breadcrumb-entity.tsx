'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

// 面包屑要显示业务名称 / 编号，但 AdminBreadcrumb 在 layout 里、详情页在
// children 里 —— RSC 里数据只能往下流，页面没法把编号交给祖先。
// 这里用一条 client context 通道：值来自页面已经查过的实体，
// 不产生任何额外请求。
//
// ⚠️ 不要改成模块级变量当 store：服务端是长驻 Node 进程，模块级
// 状态会跨请求串到别的用户身上。必须是 React state。

type BreadcrumbEntityContextValue = {
  label: string | null;
  setLabel: Dispatch<SetStateAction<string | null>>;
  parentHref: string | null;
  setParentHref: Dispatch<SetStateAction<string | null>>;
  /** 正在提交、要求锁住父级的作用域个数；各作用域只增减自己那一份，互不解锁。 */
  parentPendingCount: number;
  setParentPendingCount: Dispatch<SetStateAction<number>>;
};

const BreadcrumbEntityContext =
  createContext<BreadcrumbEntityContextValue | null>(null);

export function BreadcrumbEntityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [label, setLabel] = useState<string | null>(null);
  const [parentHref, setParentHref] = useState<string | null>(null);
  const [parentPendingCount, setParentPendingCount] = useState(0);
  const value = useMemo(
    () => ({ label, setLabel, parentHref, setParentHref, parentPendingCount, setParentPendingCount }),
    [label, parentHref, parentPendingCount],
  );
  // Provider 本身不渲染任何 DOM，插进 SidebarInset 不影响 flex 布局。
  return (
    <BreadcrumbEntityContext.Provider value={value}>
      {children}
    </BreadcrumbEntityContext.Provider>
  );
}

export function useBreadcrumbEntityLabel(): string | null {
  return useContext(BreadcrumbEntityContext)?.label ?? null;
}

export function useBreadcrumbParent(): { href: string | null; pending: boolean } {
  const context = useContext(BreadcrumbEntityContext);
  return { href: context?.parentHref ?? null, pending: (context?.parentPendingCount ?? 0) > 0 };
}

/**
 * 二级页的唯一返回入口是顶栏面包屑父级（ui-规范 §8.3，业主 2026-10-02「请保持一致性」）。
 * 原先页头返回链接多带的行为由页面经它交给父级，自身不渲染任何内容：
 * - `href`：回到同一父级页面时带上列表上下文（筛选、页码、returnTo）。路径必须与父级
 *   一致，只允许多出查询串 / hash，否则面包屑忽略它（见 resolveBreadcrumbParentHref）。
 * - `pending`：表单提交中锁住父级链接（语义同 PendingLink），避免中途离开丢失回执。
 * 与 BreadcrumbEntity 一样只在 hydrate 后生效：无 JS 时父级回到不带上下文的列表。
 */
export function BreadcrumbParent({
  href,
  pending = false,
}: {
  href?: string | null;
  pending?: boolean;
}) {
  const context = useContext(BreadcrumbEntityContext);
  const setParentHref = context?.setParentHref;
  const setParentPendingCount = context?.setParentPendingCount;
  useEffect(() => {
    if (!setParentHref || !href) return;
    setParentHref(href);
    // 同 BreadcrumbEntity：软导航时新页先 mount，只清自己写的值。
    return () => setParentHref((cur) => (cur === href ? null : cur));
  }, [href, setParentHref]);
  useEffect(() => {
    if (!setParentPendingCount || !pending) return;
    // 只撤回自己加的一份：另一个作用域仍在提交时，父级继续锁住。
    setParentPendingCount((count) => count + 1);
    return () => setParentPendingCount((count) => Math.max(0, count - 1));
  }, [pending, setParentPendingCount]);
  return null;
}

/**
 * 详情页渲染它，把业务名称 / 编号交给顶栏面包屑。自身不渲染任何内容。
 * SSR 首帧面包屑显示占位（「详情」/「工单详情」），hydrate 后换成真名称。
 * 空名称（未命名工单）不交，面包屑保持占位。
 */
export function BreadcrumbEntity({ label: rawLabel }: { label: string | null | undefined }) {
  const setLabel = useContext(BreadcrumbEntityContext)?.setLabel;
  const label = rawLabel?.trim() || null;
  useEffect(() => {
    if (!setLabel || !label) return;
    setLabel(label);
    // 软导航 A→B 时 B 先 mount、A 后 unmount；无条件清空会把 B 的值
    // 抹掉，所以只在「当前值还是我写的」时才清。
    return () => setLabel((cur) => (cur === label ? null : cur));
  }, [label, setLabel]);
  return null;
}
