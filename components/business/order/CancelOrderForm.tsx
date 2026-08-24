'use client';

import { useActionState, useId } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cancelOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  ConfirmActionDialog,
  FormErrorSummary,
  type FormErrorSummaryItem,
} from '@/components/ui-business';
import { cn } from '@/lib/utils';

export type CancelOrderImpact = {
  label: string;
  value: string;
};

/** 对话框只展示订单详情页已查到的真实影响，不在客户端补数。 */
export function cancelOrderImpactItems(
  impact: readonly CancelOrderImpact[],
): string[] {
  return impact.map((row) => `${row.label}：${row.value}`);
}

export function CancelOrderForm({
  orderId,
  orderNo,
  impact = [],
  compact = false,
}: {
  orderId: string;
  orderNo?: string;
  impact?: CancelOrderImpact[];
  compact?: boolean;
}) {
  const bound = cancelOrderAction.bind(null, orderId);
  const [state, formAction, pending] = useActionState<
    OrderMutationResult | null,
    FormData
  >(bound, null);
  const id = useId();
  const formId = `${id}-cancel-form`;
  const triggerId = `${id}-cancel-trigger`;
  const impactItems = cancelOrderImpactItems(impact);
  const fieldErrors = state?.status === 'invalid' ? state.fieldErrors : {};
  const errorSummary: FormErrorSummaryItem[] = Object.entries(fieldErrors).flatMap(
    ([field, messages]) =>
      messages.map((message) => ({
        // reason 在对话框内由 ConfirmActionDialog 生成稳定 id。对话框
        // 关闭后错误摘要先把焦点还给触发器，用户可立即重新打开修正。
        fieldId: triggerId,
        label: field === 'reason' ? '取消原因' : field,
        message,
      })),
  );
  const feedbackVisible = !pending && state !== null;

  return (
    <div
      data-risk-level="L3"
      className={cn('min-w-0', compact && 'max-sm:w-full')}
    >
      <form
        id={formId}
        action={formAction}
        aria-busy={pending}
        noValidate
      />

      <ConfirmActionDialog
        level="L3"
        formId={formId}
        disabled={pending || impactItems.length === 0}
        trigger={
          <Button
            id={triggerId}
            type="button"
            size={compact ? 'sm' : 'default'}
            variant="outline"
            aria-busy={pending}
            className={cn(
              'border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive',
              compact && 'max-sm:w-full',
            )}
          >
            {pending ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : null}
            {pending ? '正在取消…' : '取消工单'}
          </Button>
        }
        title={orderNo ? `取消工单 ${orderNo}？` : '取消这张工单？'}
        description="工单会进入 CANCELLED 终态，不再参与排产、生产与账单归集，且不能恢复。已发生的成本与工资不会被冲销。"
        impactItems={impactItems}
        confirmLabel="填写原因并取消工单"
        reasonLabel="取消原因"
        reasonPlaceholder="例如：客户书面确认取消订单"
      />

      {impactItems.length === 0 ? (
        <ActionNotice
          tone="warning"
          title="暂不能确认取消"
          description="订单影响数据未传入，为避免在未知影响下执行高风险操作，请刷新订单详情后重试。"
          className="mt-2 max-w-sm"
        />
      ) : null}

      {feedbackVisible && state?.status === 'invalid' ? (
        <FormErrorSummary errors={errorSummary} className="mt-2 max-w-sm" />
      ) : null}

      {feedbackVisible && state?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="工单未取消"
          description={state.message}
          className="mt-2 max-w-sm"
        />
      ) : null}

      {feedbackVisible && state?.status === 'success' ? (
        <ActionNotice
          tone="success"
          title="工单已取消"
          description="终态已更新，取消原因与操作人已留存在修改日志。"
          className="mt-2 max-w-sm"
        />
      ) : null}
    </div>
  );
}
