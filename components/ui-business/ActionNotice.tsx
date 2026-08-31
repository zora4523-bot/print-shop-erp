import { useId } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_BADGE_SOFT, TONE_TEXT, type Tone } from './_tones';

export type ActionNoticeTone = 'success' | 'info' | 'warning' | 'error';

export type ActionNoticeProps = {
  tone: ActionNoticeTone;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

const NOTICE_CONFIG: Record<
  ActionNoticeTone,
  {
    icon: LucideIcon;
    semanticTone: Tone;
    role: 'alert' | 'status';
    live: 'assertive' | 'polite';
  }
> = {
  success: {
    icon: CircleCheck,
    semanticTone: 'success',
    role: 'status',
    live: 'polite',
  },
  info: {
    icon: Info,
    semanticTone: 'info',
    role: 'status',
    live: 'polite',
  },
  warning: {
    icon: TriangleAlert,
    semanticTone: 'warning',
    role: 'status',
    live: 'polite',
  },
  error: {
    icon: CircleAlert,
    semanticTone: 'danger',
    role: 'alert',
    live: 'assertive',
  },
};

/**
 * 一次操作完成后的统一反馈。成功、信息和业务提醒礼貌播报；只有技术错误或
 * 确定失败才使用 assertive alert 与 destructive token。
 */
export function ActionNotice({
  tone,
  title,
  description,
  action,
  className,
}: ActionNoticeProps) {
  const titleId = useId();
  const config = NOTICE_CONFIG[tone];
  const Icon = config.icon;

  return (
    <div
      data-slot="action-notice"
      data-tone={tone}
      role={config.role}
      aria-live={config.live}
      aria-atomic="true"
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 items-start gap-3 rounded-xl border p-4',
        TONE_BADGE_SOFT[config.semanticTone],
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'mt-0.5 size-5 shrink-0',
          TONE_TEXT[config.semanticTone],
        )}
      />
      <div className="min-w-0 flex-1">
        <p id={titleId} data-slot="action-notice-title" className="font-medium">
          {title}
        </p>
        {description ? (
          <div
            data-slot="action-notice-description"
            className="mt-1 text-sm text-current"
          >
            {description}
          </div>
        ) : null}
        {action ? (
          <div data-slot="action-notice-action" className="mt-3">
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}
