import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_ICON_BOX, type Tone } from './_tones';

// 导航卡——比 ActionShortcut 更&ldquo;列表化&rdquo;的入口（截图&ldquo;管理员后台&rdquo;那 4 行）。
// 区别：行布局 + 右侧 chevron + 更紧凑的 padding，适合垂直堆叠。
//
// 与 ActionShortcut 的取舍：grid 排布用 ActionShortcut，列表排布用 NavCard。
// 视觉契约不互通——两个组件可独立演化（比如 NavCard 未来加&ldquo;徽章数字&rdquo;
// 像&ldquo;消息 12&rdquo;时不影响 ActionShortcut）。

export type NavCardProps = {
  href: string;
  icon: LucideIcon;
  label: string;
  description?: string;
  tone?: Tone;
  // 右侧附加内容：徽章数字 / 状态标记 / 时间戳等。
  trailing?: React.ReactNode;
  className?: string;
};

export function NavCard({
  href,
  icon: Icon,
  label,
  description,
  tone = 'primary',
  trailing,
  className,
}: NavCardProps) {
  return (
    <Link
      href={href}
      data-slot="nav-card"
      data-tone={tone}
      className={cn(
        'group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors',
        'hover:border-primary/40 hover:bg-muted/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          TONE_ICON_BOX[tone],
        )}
      >
        <Icon className="size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? (
          <div className="admin-wrap-anywhere mt-0.5 text-xs text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <div className="shrink-0 text-xs text-muted-foreground">{trailing}</div>
      ) : null}
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
