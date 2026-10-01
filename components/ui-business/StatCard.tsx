import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_ICON_BOX, type Tone } from './_tones';

// KPI 卡片——主页 dashboard 4 张卡的视觉契约（参考截图：
// icon 圆角方 + 标签 + 大号数字 + delta 同比指示）。
//
// **server component 安全**：纯展示，无状态。
//
// `data-slot="dashboard-kpi"` 沿用 components/business/dashboard/StatCard
// 的 E2E hook 命名，让两套 StatCard 在迁移期共存（Phase D 滚动重构会替换
// 旧的，届时统一收口到本组件）。

export type StatDelta = {
  // 同比方向：'up' / 'down' / 'flat'。'up' 不天然＝&ldquo;好&rdquo;——业务侧自己判断
  // 上行是好还是坏（如&ldquo;待处理工单&rdquo; ↑ 是坏事）；component 只负责画箭头，
  // tone 由调用方传 deltaTone 决定语义色。
  direction: 'up' | 'down' | 'flat';
  // 显示文本（如 `15%` / `¥120`）。component 不格式化数字，避免和业务侧
  // 的 lib/dashboard/format 重复职责。
  label: string;
  // 同比是否&ldquo;好的方向&rdquo;。会驱动箭头颜色（success / warning / neutral）。
  // 默认 'neutral'：不强制业务侧定义&ldquo;好坏&rdquo;。
  goodDirection?: 'up' | 'down';
};

export type StatCardProps = {
  label: string;
  value: string;
  // tinted icon 容器里画的 icon。用 lucide-react 类型保证 tree-shaking。
  icon?: LucideIcon;
  tone?: Tone;
  delta?: StatDelta;
  hint?: React.ReactNode;
  className?: string;
};

const DELTA_ICON = {
  up: ArrowUp,
  down: ArrowDown,
  flat: ArrowRight,
} as const;

function deltaTone(d: StatDelta): Tone {
  if (d.direction === 'flat') return 'neutral';
  if (!d.goodDirection) return 'neutral';
  return d.direction === d.goodDirection ? 'success' : 'warning';
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
  delta,
  hint,
  className,
}: StatCardProps) {
  const DeltaIcon = delta ? DELTA_ICON[delta.direction] : null;
  const dTone = delta ? deltaTone(delta) : 'neutral';

  // 卡片本身是容器：窄于 10rem 内容宽时图标叠到数值上方，把整行宽度留给数值。
  // 数值不用 break-words——它会在放不下时把「¥ 15,395.29」从数字中间折开
  // （2026-10-01 在 768 宽的月账单页实测折成三行）；只允许在「¥」后的空格处换行。
  return (
    <div
      data-slot="dashboard-kpi"
      data-tone={tone}
      className={cn(
        '@container rounded-xl border bg-card p-4 shadow-sm',
        className,
      )}
    >
      <div className="flex flex-col items-start gap-2 @min-[10rem]:flex-row @min-[10rem]:gap-3">
      {Icon ? (
        <div
          aria-hidden
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            TONE_ICON_BOX[tone],
          )}
        >
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 font-sans tabular-nums text-xl font-semibold tracking-tight">
          {value}
        </div>
        {delta && DeltaIcon ? (
          <div
            data-tone={dTone}
            className={cn(
              'mt-1 inline-flex items-center gap-1 text-xs',
              dTone === 'success'
                ? 'text-success-foreground'
                : dTone === 'warning'
                  ? 'text-warning-foreground'
                  : 'text-muted-foreground',
            )}
          >
            <DeltaIcon className="size-3" aria-hidden />
            <span>{delta.label}</span>
          </div>
        ) : null}
        {hint ? (
          <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </div>
      </div>
    </div>
  );
}
