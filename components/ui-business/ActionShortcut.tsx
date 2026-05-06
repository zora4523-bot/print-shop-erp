import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_ICON_BOX, type Tone } from './_tones';

// 快捷操作卡——首页&ldquo;快捷操作&rdquo;那 4 个色块卡（新建工单 / 添加工艺 / 等）。
//
// 视觉契约：tinted icon + 主标签 + 副描述，整张卡可点。grid-friendly：
// 父容器 grid-cols-2 / 4 即可。本组件只关心单卡视觉。
//
// **server component 安全**——`<Link>` 在 server 也能渲染。

export type ActionShortcutProps = {
  href: string;
  icon: LucideIcon;
  label: string;
  description?: string;
  tone?: Tone;
  className?: string;
};

export function ActionShortcut({
  href,
  icon: Icon,
  label,
  description,
  tone = 'primary',
  className,
}: ActionShortcutProps) {
  return (
    <Link
      href={href}
      data-slot="action-shortcut"
      data-tone={tone}
      className={cn(
        'group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors',
        'hover:border-primary/40 hover:bg-muted/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          TONE_ICON_BOX[tone],
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
