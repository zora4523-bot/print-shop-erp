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

// 面包屑要显示业务编号，但 AdminBreadcrumb 在 layout 里、详情页在
// children 里 —— RSC 里数据只能往下流，页面没法把编号交给祖先。
// 这里用一条 client context 通道：值来自页面已经查过的实体，
// 不产生任何额外请求。
//
// ⚠️ 不要改成模块级变量当 store：服务端是长驻 Node 进程，模块级
// 状态会跨请求串到别的用户身上。必须是 React state。

type BreadcrumbEntityContextValue = {
  label: string | null;
  setLabel: Dispatch<SetStateAction<string | null>>;
};

const BreadcrumbEntityContext =
  createContext<BreadcrumbEntityContextValue | null>(null);

export function BreadcrumbEntityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [label, setLabel] = useState<string | null>(null);
  const value = useMemo(() => ({ label, setLabel }), [label]);
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

/**
 * 详情页渲染它，把业务编号交给顶栏面包屑。自身不渲染任何内容。
 * SSR 首帧面包屑显示占位「详情」，hydrate 后换成真编号。
 */
export function BreadcrumbEntity({ label }: { label: string }) {
  const setLabel = useContext(BreadcrumbEntityContext)?.setLabel;
  useEffect(() => {
    if (!setLabel) return;
    setLabel(label);
    // 软导航 A→B 时 B 先 mount、A 后 unmount；无条件清空会把 B 的值
    // 抹掉，所以只在「当前值还是我写的」时才清。
    return () => setLabel((cur) => (cur === label ? null : cur));
  }, [label, setLabel]);
  return null;
}
