'use client';

import { useLayoutEffect, useRef, type ComponentProps } from 'react';

/**
 * 工单列表上方的单行横向滚动条（看板、队列、快捷筛选；审查 L-8）。滚动只发生在条内，
 * 页面不横向溢出；断点由调用方的 className 决定，宽容器照旧铺开。
 *
 * 选中项（aria-current）不在可见范围时，把条自身的 scrollLeft 移到它居中——不用
 * scrollIntoView，避免带动页面滚动（切换链接都是 scroll={false}）。activeKey 变化时重算。
 */
export function AdminOrderScrollStrip({
  activeKey,
  ...props
}: ComponentProps<'div'> & { activeKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = ref.current;
    const active = strip?.querySelector<HTMLElement>('[aria-current]');
    if (!strip || !active) return;
    const stripBox = strip.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    if (activeBox.left >= stripBox.left && activeBox.right <= stripBox.right) return;
    strip.scrollLeft += activeBox.left - stripBox.left - (stripBox.width - activeBox.width) / 2;
  }, [activeKey]);
  return <div ref={ref} data-slot="admin-order-scroll-strip" {...props} />;
}
