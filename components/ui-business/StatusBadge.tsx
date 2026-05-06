import { cn } from '@/lib/utils';
import { TONE_BADGE_SOFT, type Tone } from './_tones';

// 状态徽章——工单 / 任务 / 账单等状态的通用视觉。截图里的&ldquo;生产中&rdquo;
// &ldquo;待审核&rdquo;&ldquo;已完成&rdquo;&ldquo;已发货&rdquo;&ldquo;已取消&rdquo;就是它。
//
// 设计原则：组件不感知具体业务枚举（OrderStatus / BillStatus / 等
// 多套），调用方传 `tone` + label。配套 `orderStatusToBadge()` 等
// helper 在调用方一侧做枚举 → tone/label 映射，让 StatusBadge 跨领域复用。

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
      data-slot="status-badge"
      data-tone={tone}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
        TONE_BADGE_SOFT[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            tone === 'primary'
              ? 'bg-primary'
              : tone === 'warning'
                ? 'bg-warning'
                : tone === 'info'
                  ? 'bg-info'
                  : tone === 'success'
                    ? 'bg-success'
                    : 'bg-muted-foreground',
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

// 工单状态 → tone/label 映射。集中在这里方便维护——状态机变了改一处。
// 注意：业务方仍然通过 `<StatusBadge tone={...}>` 调用，这个 helper 只
// 是&ldquo;别名层&rdquo;，不强制使用。
export const ORDER_STATUS_TO_BADGE: Record<
  string,
  { tone: Tone; label: string; dot?: boolean }
> = {
  DRAFT: { tone: 'neutral', label: '草稿' },
  SUBMITTED: { tone: 'info', label: '待审核' },
  SCHEDULED: { tone: 'info', label: '已排产', dot: true },
  IN_PRODUCTION: { tone: 'primary', label: '生产中', dot: true },
  COMPLETED: { tone: 'success', label: '已完成' },
  SHIPPED: { tone: 'success', label: '已发货' },
  FINISHED: { tone: 'success', label: '已结案' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};
