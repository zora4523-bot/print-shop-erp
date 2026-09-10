import { StatusBadge } from '@/components/ui-business';
import type { RuleCenterEffect } from '@/lib/navigation/rule-center';
import { RULE_CENTER_EFFECT_REGISTRY } from '@/lib/ui/status-registry';
import { cn } from '@/lib/utils';

export type RuleCenterPageHeaderProps = {
  title: string;
  subtitle?: React.ReactNode;
  scope?: string;
  effect?: RuleCenterEffect;
  actions?: React.ReactNode;
  className?: string;
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
 * 规则中心的紧凑标题区。规则页比普通管理列表更需要
 * 明确“作用域”和“何时生效”，因此在同一层级展示这些信息。
 */
export function RuleCenterPageHeader({
  title,
  subtitle,
  scope,
  effect,
  actions,
  className,
}: RuleCenterPageHeaderProps) {
  return (
    <header
      data-slot="rule-center-page-header"
      className={cn('min-w-0 border-b pb-4', className)}
    >
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {scope || effect ? (
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
              {scope ? (
                <span className="inline-flex h-6 items-center rounded-md border px-2 text-xs font-semibold tracking-wide text-foreground">
                  {scope}
                </span>
              ) : null}
              {effect ? <RuleCenterEffectBadge effect={effect} /> : null}
            </div>
          ) : null}
          <h1 className="admin-wrap-anywhere text-xl font-bold tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="admin-wrap-anywhere mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
