import { PageHeader, StatusBadge, type PageHeaderProps } from '@/components/ui-business';
import { ScopedPageHeader } from '@/components/business/form/FormPendingScope';
import { cn } from '@/lib/utils';
import type { RuleCenterEffect } from '@/lib/navigation/rule-center';
import { RULE_CENTER_EFFECT_REGISTRY } from '@/lib/ui/status-registry';

export type RuleCenterPageHeaderProps = {
  title: string;
  titleId?: string;
  subtitle?: React.ReactNode;
  scope?: string;
  /**
   * 作用域胶囊的强调：计价口径与相邻分区不同（如「元 / 单」整单总价）时用
   * primary 提醒，不用红色（红色只表示危险 / 失败，ui-规范 §8.2）。
   */
  scopeEmphasis?: boolean;
  effect?: RuleCenterEffect;
  back?: PageHeaderProps['back'];
  status?: PageHeaderProps['status'];
  actions?: React.ReactNode;
  className?: string;
  /** 在 FormPendingScope 内使用时，表单提交中锁住返回入口。 */
  lockBackWhilePending?: boolean;
};

export function RuleCenterEffectBadge({
  effect,
  className,
}: {
  effect: RuleCenterEffect;
  className?: string;
}) {
  const definition = RULE_CENTER_EFFECT_REGISTRY[effect];

  return (
    <StatusBadge
      tone={definition.tone}
      dot={definition.dot}
      className={className}
    >
      {definition.label}
    </StatusBadge>
  );
}

/**
 * 规则中心页头：PageHeader 的薄封装，只把「作用域」胶囊
 * 放进 eyebrow 槽（ui-规范 §8.3：所有页面标题经 PageHeader）。
 */
export function RuleCenterPageHeader({
  title,
  titleId,
  subtitle,
  scope,
  scopeEmphasis = false,
  back,
  status,
  actions,
  className,
  lockBackWhilePending = false,
}: RuleCenterPageHeaderProps) {
  const Header = lockBackWhilePending ? ScopedPageHeader : PageHeader;
  return (
    <Header
      title={title}
      titleId={titleId}
      subtitle={subtitle}
      back={back}
      status={status}
      actions={actions}
      className={className}
      eyebrow={
        scope ? (
          <>
            {scope ? (
              <span
                data-emphasis={scopeEmphasis ? 'primary' : undefined}
                className={cn(
                  'inline-flex h-6 items-center rounded-md border px-2 text-xs font-semibold text-foreground',
                  scopeEmphasis && 'border-primary/40 bg-primary/10 text-primary',
                )}
              >
                {scope}
              </span>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}
