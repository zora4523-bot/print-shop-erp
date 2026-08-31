import { Inbox, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type TableEmptyStateBaseProps = {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
};

type TableRowEmptyStateProps = TableEmptyStateBaseProps & {
  variant?: 'table';
  /** table 形态必须覆盖当前表格的全部列。 */
  colSpan: number;
};

type CompactEmptyStateProps = TableEmptyStateBaseProps & {
  variant: 'compact';
  colSpan?: never;
};

export type TableEmptyStateProps =
  | TableRowEmptyStateProps
  | CompactEmptyStateProps;

/**
 * 表格专用空态。table 形态返回合法 tr/td；compact 形态供移动卡片或局部
 * 列表使用，避免复用全页 EmptyState 造成嵌套边框和过大留白。
 */
export function TableEmptyState(props: TableEmptyStateProps) {
  const content = (
    <EmptyContent
      title={props.title}
      description={props.description}
      action={props.action}
      icon={props.icon}
    />
  );

  if (props.variant === 'compact') {
    return (
      <div
        data-slot="table-empty-state"
        data-variant="compact"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={props.title}
        className={cn(
          'rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5',
          props.className,
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <tr
      data-slot="table-empty-state"
      data-variant="table"
      className={props.className}
    >
      <td colSpan={props.colSpan} className="px-4 py-8">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={props.title}
        >
          {content}
        </div>
      </td>
    </tr>
  );
}

function EmptyContent({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: Omit<TableEmptyStateBaseProps, 'className'>) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <Icon aria-hidden className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <div className="max-w-md text-xs text-muted-foreground">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
