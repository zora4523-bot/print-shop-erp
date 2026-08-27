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
import { ConfirmActionDialog } from '@/components/ui-business';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

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

export function orderChangeApprovalImpactItems(
  preview: OrderChangePricingPreview,
): string[] {
  const addedCount = preview.items.filter(
    (item) => item.operation === 'ADD',
  ).length;
  const updatedCount = preview.items.length - addedCount;
  const changeSummary = [
    updatedCount > 0 ? `修改 ${updatedCount} 项` : null,
    addedCount > 0 ? `新增 ${addedCount} 项` : null,
  ]
    .filter((item): item is string => item !== null)
    .join('、');
  const pricingSummary =
    preview.newTotal === null || preview.delta === null
      ? `计价预览不完整：当前总额 ${money(preview.oldTotal)}，新总额和差额暂无法计算。`
      : `计价预览：${money(preview.oldTotal)} → ${money(preview.newTotal)}（差额 ${deltaMoney(preview.delta)}）。`;
  const itemChanges = preview.items.map((item) => {
    const itemLabel =
      item.operation === 'ADD'
        ? `新增款式“${externalPriceBusinessText(item.name)}”`
        : `修改款式“${externalPriceBusinessText(item.previousName ?? item.name)}”${item.previousName && item.previousName !== item.name ? ` → “${externalPriceBusinessText(item.name)}”` : ''}`;
    const subtotal = `${item.oldSubtotal === null ? '新增' : money(item.oldSubtotal)} → ${item.newSubtotal === null ? '待补全规则' : money(item.newSubtotal)}`;
    const pricingImpact =
      item.priceImpact === 'UNCHANGED'
        ? '不影响计价'
        : item.priceImpact === 'QUOTED'
          ? '已按当前规则计价'
          : '当前无法计价';
    const errors =
      item.errors.length > 0
        ? `；计价提示：${item.errors.join('；')}`
        : '';
    return `${itemLabel}：${item.quantity.toLocaleString('zh-CN')} 个，款式小计 ${subtotal}，${pricingImpact}${errors}。`;
  });

  return [
    `申请基于工单第 ${preview.baseRevision} 版，共 ${preview.items.length} 项款式变更${changeSummary ? `（${changeSummary}）` : ''}。`,
    ...itemChanges,
    `${pricingSummary}批准时会按最新规则重新报价，预览金额可能变化。`,
    '批准后会更新相关款式、数量、待开工任务和工单应收。',
  ];
}

export function orderChangeRejectionImpactItems(): string[] {
  return [
    '该修改申请会标记为已拒绝，并保存当前已填审核备注（如有）。',
    '现有工单的款式、数量、计价与生产任务保持不变。',
    '已拒绝的申请不能再次审批；如仍需修改，需要重新发起申请。',
  ];
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
          批准时会按最新规则重新报价，当前预览仅供核对。
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
          当前规则无法得出新价格。若需沿用原成交价，请填写原因；批准时仍会重新报价。
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
                {item.operation === 'ADD' ? '新增' : '修改'} ·{' '}
                {externalPriceBusinessText(item.name)}
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
  const approvalImpactItems = preview
    ? orderChangeApprovalImpactItems(preview)
    : [];
  const rejectionImpactItems = orderChangeRejectionImpactItems();
  const approveDisabled =
    pending ||
    previewPending ||
    preview === null ||
    (approvalNeedsRemark && reviewRemark.trim() === '');

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending || previewPending}
      className="space-y-2"
    >
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
          拒绝时选填；批准时若需沿用原成交价，此项必填。
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ConfirmActionDialog
          level="L2"
          disabled={approveDisabled}
          trigger={
            <Button type="button" className="min-h-11">
              {pending
                ? '处理中…'
                : approvalNeedsRemark
                  ? '填写沿用说明并批准（将再次报价）'
                  : '批准并按最新规则同步工单'}
            </Button>
          }
          title="批准这项工单修改申请？"
          description="请核对计价预览和审核备注。批准时会按最新规则重新报价。"
          impactItems={approvalImpactItems}
          confirmLabel="确认批准并同步工单"
          onConfirm={() => submit('APPROVE')}
        />
        <ConfirmActionDialog
          level="L2"
          disabled={pending}
          trigger={
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
            >
              拒绝申请
            </Button>
          }
          title="拒绝这项工单修改申请？"
          description="拒绝后不会改动工单内容。如需说明原因，可在上方填写审核备注；拒绝时不强制填写。"
          impactItems={rejectionImpactItems}
          confirmLabel="确认拒绝申请"
          onConfirm={() => submit('REJECT')}
        />
      </div>
    </form>
  );
}
