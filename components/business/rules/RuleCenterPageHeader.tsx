import { PageHeader, StatusBadge, type PageHeaderProps } from '@/components/ui-business';
import { ScopedPageHeader } from '@/components/business/form/FormPendingScope';
import type { RuleCenterEffect } from '@/lib/navigation/rule-center';
import { RULE_CENTER_EFFECT_REGISTRY } from '@/lib/ui/status-registry';

export type RuleCenterPageHeaderProps = {
  title: string;
  subtitle?: React.ReactNode;
  scope?: string;
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
 * 规则中心页头：PageHeader 的薄封装，只把「作用域」胶囊与生效方式
 * 徽标放进 eyebrow 槽（ui-规范 §8.3：所有页面标题经 PageHeader）。
 */
export function RuleCenterPageHeader({
  title,
  subtitle,
  scope,
  effect,
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
      subtitle={subtitle}
      back={back}
      status={status}
      actions={actions}
      className={className}
      eyebrow={
        scope || effect ? (
          <>
            {scope ? (
              <span className="inline-flex h-6 items-center rounded-md border px-2 text-xs font-semibold text-foreground">
                {scope}
              </span>
            ) : null}
            {effect ? <RuleCenterEffectBadge effect={effect} /> : null}
          </>
        ) : undefined
      }
    />
  );
}
