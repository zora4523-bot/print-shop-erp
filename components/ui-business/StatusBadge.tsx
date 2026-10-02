import { cn } from '@/lib/utils';
import { TONE_BADGE_SOFT, TONE_DOT, type Tone } from './_tones';

// 状态徽章——工单 / 任务 / 账单等状态的通用视觉。截图里的&ldquo;生产中&rdquo;
// &ldquo;待审核&rdquo;&ldquo;已完成&rdquo;&ldquo;已发货&rdquo;&ldquo;已取消&rdquo;就是它。
//
// 设计原则：组件不感知具体业务枚举（OrderStatus / BillStatus / 等
// 多套），调用方传 `tone` + label。业务枚举映射集中在
// lib/ui/status-registry.ts，让 StatusBadge 保持跨领域复用。

export type StatusBadgeProps = {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  // 可选 dot：在 label 前面画一个同色实心圆点，部分状态视觉更鲜明
  // （特别是&ldquo;运行中&rdquo;这类需要&ldquo;脉冲感&rdquo;的状态）。
  dot?: boolean;
};

export function StatusBadge({
  tone,
  children,
  className,
  dot,
}: StatusBadgeProps) {
  return (
    <span
      // `data-slot="badge"` 沿用 shadcn Badge 的 slot 命名，让 E2E 已有
      // 的 `[data-slot="badge"]` 选择器在迁移后继续命中（多种 badge 共
      // 存时配合 .filter({ hasText: ... }) 文本筛选已成项目惯例）。
      data-slot="badge"
      data-tone={tone}
      className={cn(
        'inline-flex h-6 w-fit shrink-0 items-center whitespace-nowrap gap-1.5 rounded-full border px-2.5 text-xs font-medium',
        TONE_BADGE_SOFT[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])}
        />
      ) : null}
      {children}
    </span>
  );
}
