'use client';

import {
  useActionState,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  previewOrderChangeRequestPricingAction,
  reviewOrderChangeRequestAction,
} from '@/actions/order';
import type {
  PreviewOrderChangeRequestPricingResult,
  ReviewOrderChangeRequestMutationResult,
} from '@/actions/order.types';
import type { OrderChangePricingPreview } from '@/lib/order/change-request';
import { Button } from '@/components/ui/button';

type Props = {
  requestId: string;
};

function money(value: string): string {
  return `¥${value}`;
}

function deltaMoney(value: string): string {
  if (value.startsWith('-')) return `-¥${value.slice(1)}`;
  if (value === '0.00') return '¥0.00';
  return `+¥${value}`;
}

export function OrderChangePricingPreviewPanel({
  preview,
}: {
  preview: OrderChangePricingPreview;
}) {
  return (
    <section
      aria-label="审批计价预览"
      className="space-y-3 rounded-lg border bg-muted/20 p-3"
    >
      <div>
        <h3 className="text-sm font-semibold">审批计价预览（只读）</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          批准时服务器会在事务内按最新规则再次报价；此预览不作为提交金额。
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">旧总额</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {money(preview.oldTotal)}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">新总额</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {preview.newTotal === null ? '待补全价格规则' : money(preview.newTotal)}
          </dd>
        </div>
        <div className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">差额</dt>
          <dd className="mt-1 font-sans font-semibold tabular-nums">
            {preview.delta === null ? '暂无法计算' : deltaMoney(preview.delta)}
          </dd>
        </div>
      </dl>

      {preview.requiresReviewRemark ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          当前规则无法得出新价格，因此不展示新总额和差额。系统不会自动沿用原成交价；只有填写审核备注并批准后，服务器再次报价仍不完整时，才会按该备注沿用原成交价。
        </p>
      ) : null}

      <ul className="space-y-2">
        {preview.items.map((item) => (
          <li
            key={`${item.changeIndex}-${item.sourceItemId}`}
            className="min-w-0 rounded-md border bg-background p-2 text-xs"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <p className="admin-wrap-anywhere min-w-0 font-medium">
                {item.operation === 'ADD' ? '新增' : '修改'} · {item.name}
                <span className="ml-2 font-normal text-muted-foreground">
                  {item.quantity.toLocaleString('zh-CN')} 个
                </span>
              </p>
              <span
                className={
                  item.priceImpact === 'INCOMPLETE'
                    ? 'font-medium text-destructive'
                    : 'text-muted-foreground'
                }
              >
                {item.priceImpact === 'UNCHANGED'
                  ? '不影响计价'
                  : item.priceImpact === 'QUOTED'
                    ? '已按当前规则计价'
                    : '无法计价'}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">
              款式小计：{item.oldSubtotal === null ? '新增' : money(item.oldSubtotal)}{' '}
              → {item.newSubtotal === null ? '待补全规则' : money(item.newSubtotal)}
            </p>
            {item.priceImpact === 'QUOTED' ? (
              <p className="mt-1 text-muted-foreground">
                建议单价 {money(item.suggestedUnitPrice as string)} · 每款一次性费用{' '}
                {money(item.suggestedFixedFee as string)}
              </p>
            ) : null}
            {item.errors.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-destructive">
                {item.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OrderChangeReviewForm({ requestId }: Props) {
  const router = useRouter();
  const [state, action] = useActionState<
    ReviewOrderChangeRequestMutationResult | null,
    unknown
  >(reviewOrderChangeRequestAction, null);
  const [previewState, previewAction] = useActionState<
    PreviewOrderChangeRequestPricingResult | null,
    unknown
  >(previewOrderChangeRequestPricingAction, null);
  const [pending, startTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();
  const [reviewRemark, setReviewRemark] = useState('');

  useEffect(() => {
    if (state?.status === 'success') router.refresh();
  }, [router, state]);

  const loadPreview = useCallback(() => {
    startPreviewTransition(() => previewAction({ requestId }));
  }, [previewAction, requestId]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  function submit(decision: 'APPROVE' | 'REJECT') {
    startTransition(() =>
      action({
        requestId,
        decision,
        reviewRemark: reviewRemark || null,
      }),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  const error =
    state?.status === 'error'
      ? state.message
      : state?.status === 'invalid'
        ? Object.values(state.fieldErrors).flat()[0]
        : null;
  const previewError =
    previewState?.status === 'error'
      ? previewState.message
      : previewState?.status === 'invalid'
        ? Object.values(previewState.fieldErrors).flat()[0]
        : null;
  const preview =
    previewState?.status === 'success' ? previewState.preview : null;
  const approvalNeedsRemark = preview?.requiresReviewRemark ?? false;
  const approveDisabled =
    pending ||
    previewPending ||
    preview === null ||
    (approvalNeedsRemark && reviewRemark.trim() === '');

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {preview ? <OrderChangePricingPreviewPanel preview={preview} /> : null}
      {previewPending && !preview ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在按当前价格规则生成审批预览…
        </p>
      ) : null}
      {previewError ? (
        <div className="space-y-2 rounded-md border border-destructive/40 p-2">
          <p role="alert" className="text-sm text-destructive">
            计价预览失败：{previewError}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={previewPending}
            onClick={loadPreview}
          >
            重新加载计价预览
          </Button>
        </div>
      ) : null}
      <label className="block space-y-1 text-sm">
        <span>审核备注</span>
        <textarea
          aria-describedby={`change-review-remark-help-${requestId}`}
          value={reviewRemark}
          onChange={(event) => setReviewRemark(event.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-md border bg-background px-3 py-2"
        />
        <span
          id={`change-review-remark-help-${requestId}`}
          className="block text-xs text-muted-foreground"
        >
          拒绝时可选。批准时会重新报价；若届时规则仍不完整、需明确沿用原成交价，此备注必填。
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={approveDisabled}
          onClick={() => submit('APPROVE')}
          className="min-h-11"
        >
          {pending
            ? '处理中…'
            : approvalNeedsRemark
              ? '填写沿用说明并批准（将再次报价）'
              : '批准并按最新规则同步工单'}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => submit('REJECT')}
          className="min-h-11"
        >
          拒绝申请
        </Button>
      </div>
    </form>
  );
}
