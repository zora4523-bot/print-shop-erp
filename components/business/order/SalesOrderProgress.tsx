import type { OrderStatus } from '@/generated/prisma/enums';
import { salesOrderProgressPresentation } from '@/lib/order/sales-list-presentation';
import { cn } from '@/lib/utils';

export function SalesOrderProgress({ status }: { status: OrderStatus }) {
  const progress = salesOrderProgressPresentation(status);
  if (progress.currentStep === null) {
    return <p className="text-sm text-muted-foreground">{progress.message}</p>;
  }
  const steps = ['已提交', '工厂处理', '生产', '发货', '完成'];
  return (
    <ol aria-label="工单进度" className="grid grid-cols-5">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === progress.currentStep ? 'step' : undefined}
          className={cn(
            'relative text-center text-xs text-muted-foreground before:mx-auto before:mb-1.5 before:block before:size-2.5 before:rounded-full before:border before:border-muted-foreground/30 before:bg-muted after:absolute after:left-[calc(50%+0.45rem)] after:right-[calc(-50%+0.45rem)] after:top-[0.28rem] after:h-px after:bg-border last:after:hidden',
            index < progress.currentStep &&
              'text-foreground before:border-foreground before:bg-foreground after:bg-foreground',
            index === progress.currentStep &&
              'font-medium text-primary before:border-primary before:bg-primary',
          )}
        >
          {step}
        </li>
      ))}
    </ol>
  );
}
