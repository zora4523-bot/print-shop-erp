import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Inbox, SearchX, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  EMPTY_NO_ACCESS_ACTION,
  EMPTY_NO_ACCESS_DESCRIPTION,
  EMPTY_NO_ACCESS_HOME_HREF,
  EMPTY_NO_ACCESS_TITLE,
  EMPTY_NO_RESULT_DESCRIPTION,
  emptyNoDataDescription,
  emptyNoDataTitle,
  emptyNoResultTitle,
} from './empty-state-copy';

export type EmptyStateKind = 'no-data' | 'no-result' | 'no-access';

type EmptyStateKindProps = {
  kind: EmptyStateKind;
  noun?: string;
  onClear?: React.ReactNode;
  onCreate?: React.ReactNode;
  homeHref?: string;
  className?: string;
  icon?: never;
  title?: never;
  description?: never;
  action?: never;
};

type EmptyStateLegacyProps = {
  kind?: undefined;
  noun?: never;
  onClear?: never;
  onCreate?: never;
  homeHref?: never;
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export type EmptyStateProps = EmptyStateKindProps | EmptyStateLegacyProps;

const KIND_ICONS: Record<EmptyStateKind, LucideIcon> = {
  'no-data': Inbox,
  'no-result': SearchX,
  'no-access': ShieldOff,
};

function copyForKind(
  kind: EmptyStateKind,
  noun: string,
): { title: string; description: string } {
  if (kind === 'no-access') {
    return {
      title: EMPTY_NO_ACCESS_TITLE,
      description: EMPTY_NO_ACCESS_DESCRIPTION,
    };
  }
  if (kind === 'no-result') {
    return {
      title: emptyNoResultTitle(noun),
      description: EMPTY_NO_RESULT_DESCRIPTION,
    };
  }
  return {
    title: emptyNoDataTitle(noun),
    description: emptyNoDataDescription(noun),
  };
}

export function EmptyState(props: EmptyStateProps) {
  if (props.kind) {
    const noun = props.noun ?? '记录';
    const copy = copyForKind(props.kind, noun);
    const Icon = KIND_ICONS[props.kind];
    const action =
      props.kind === 'no-access' ? (
        <Button
          render={
            <Link href={props.homeHref ?? EMPTY_NO_ACCESS_HOME_HREF} prefetch={false} />
          }
          nativeButton={false}
          className="min-h-11 min-w-11 px-3"
        >
          {EMPTY_NO_ACCESS_ACTION}
        </Button>
      ) : props.kind === 'no-result' ? (
        props.onClear
      ) : (
        props.onCreate
      );
    return (
      <EmptyFrame
        icon={Icon}
        title={copy.title}
        description={copy.description}
        action={action}
        className={props.className}
        kind={props.kind}
      />
    );
  }

  return (
    <EmptyFrame
      icon={props.icon}
      title={props.title}
      description={props.description}
      action={props.action}
      className={props.className}
    />
  );
}

function EmptyFrame({
  icon: Icon,
  title,
  description,
  action,
  className,
  kind,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  kind?: EmptyStateKind;
}) {
  return (
    <section
      data-slot="empty-state"
      data-kind={kind}
      aria-label={title}
      aria-live={kind === 'no-result' ? 'polite' : undefined}
      aria-atomic={kind === 'no-result' ? 'true' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" aria-hidden />
        </div>
      ) : null}
      {kind === 'no-access' ? (
        <h1 className="text-sm font-medium text-foreground">{title}</h1>
      ) : (
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      )}
      {description ? (
        <div className="max-w-sm text-xs text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
